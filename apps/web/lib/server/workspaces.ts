import "server-only";

import {
  type CreateWorkspaceResponse,
  type CurrentUserResponse,
  type WorkspaceDetailResponse,
  type WorkspaceInvitationRecord,
  type WorkspaceMemberRecord,
  type WorkspaceMemberRole,
  type WorkspaceRecord,
} from "@brevoca/contracts";
import { getSupabaseAdmin } from "./supabase";

interface ProfileRow {
  id: string;
  email: string | null;
  default_workspace_id: string | null;
  created_at: string;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceMembershipRow {
  workspace_id: string;
  user_id: string;
  role: WorkspaceMemberRole;
  created_at: string;
  updated_at: string;
}

interface WorkspaceInvitationRow {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceMemberRole;
  invited_by_user_id: string;
  accepted_by_user_id: string | null;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

interface UserIdentity {
  id: string;
  email: string | null;
}

interface MembershipProfileRow {
  id: string;
  email: string | null;
}

function mapWorkspace(row: WorkspaceRow, role: WorkspaceMemberRole): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapInvitation(row: WorkspaceInvitationRow): WorkspaceInvitationRecord {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    invitedByUserId: row.invited_by_user_id,
    createdAt: row.created_at,
  };
}

function buildDisplayName(email: string | null): string {
  if (!email) {
    return "알 수 없는 사용자";
  }

  const localPart = email.split("@")[0]?.trim();
  return localPart || email;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function requireSingle<T>(
  promise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  context: string,
): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`${context}: no data returned`);
  }
  return data;
}

export async function ensureProfile(user: UserIdentity): Promise<ProfileRow> {
  const supabase = getSupabaseAdmin();
  return requireSingle<ProfileRow>(
    supabase
      .from("profiles")
      .upsert(
        {
          id: user.id,
          email: user.email,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" },
      )
      .select("*")
      .single(),
    "Failed to upsert profile",
  );
}

export async function getCurrentUserState(user: UserIdentity): Promise<CurrentUserResponse> {
  const supabase = getSupabaseAdmin();
  const profile = await ensureProfile(user);
  await acceptPendingInvitations(user);
  const { data: membershipRows, error: membershipError } = await supabase
    .from("workspace_memberships")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw new Error(`Failed to load workspace memberships: ${membershipError.message}`);
  }

  const memberships = (membershipRows ?? []) as WorkspaceMembershipRow[];
  if (memberships.length === 0) {
    return {
      user: {
        id: user.id,
        email: profile.email,
        defaultWorkspaceId: null,
      },
      workspaces: [],
      currentWorkspaceId: null,
    };
  }

  const workspaceIds = memberships.map((membership) => membership.workspace_id);
  const { data: workspaceRows, error: workspaceError } = await supabase
    .from("workspaces")
    .select("*")
    .in("id", workspaceIds)
    .order("created_at", { ascending: true });

  if (workspaceError) {
    throw new Error(`Failed to load workspaces: ${workspaceError.message}`);
  }

  const roleByWorkspaceId = new Map(memberships.map((membership) => [membership.workspace_id, membership.role]));
  const workspaces = ((workspaceRows ?? []) as WorkspaceRow[])
    .map((workspace) => {
      const role = roleByWorkspaceId.get(workspace.id);
      return role ? mapWorkspace(workspace, role) : null;
    })
    .filter((workspace): workspace is WorkspaceRecord => workspace !== null);

  const currentWorkspaceId = resolveCurrentWorkspaceId(profile.default_workspace_id, workspaces);
  if (currentWorkspaceId !== profile.default_workspace_id) {
    await updateDefaultWorkspace(user.id, currentWorkspaceId);
  }

  return {
    user: {
      id: user.id,
      email: profile.email,
      defaultWorkspaceId: currentWorkspaceId,
    },
    workspaces,
    currentWorkspaceId,
  };
}

export async function createWorkspaceForUser(
  user: UserIdentity,
  name: string,
): Promise<CreateWorkspaceResponse> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Workspace name is required");
  }

  const supabase = getSupabaseAdmin();
  const profile = await ensureProfile(user);
  const workspace = await requireSingle<WorkspaceRow>(
    supabase
      .from("workspaces")
      .insert({
        name: trimmedName,
        owner_id: user.id,
      })
      .select("*")
      .single(),
    "Failed to create workspace",
  );

  await requireSingle(
    supabase
      .from("workspace_memberships")
      .insert({
        workspace_id: workspace.id,
        user_id: user.id,
        role: "owner",
      })
      .select("workspace_id")
      .single(),
    "Failed to create workspace membership",
  );

  const nextCurrentWorkspaceId = workspace.id;
  await updateDefaultWorkspace(user.id, nextCurrentWorkspaceId);

  return {
    workspace: mapWorkspace(workspace, "owner"),
    currentWorkspaceId: nextCurrentWorkspaceId,
  };
}

export async function updateDefaultWorkspace(userId: string, workspaceId: string | null): Promise<void> {
  const supabase = getSupabaseAdmin();

  if (workspaceId) {
    const membership = await requireSingle<WorkspaceMembershipRow>(
      supabase
        .from("workspace_memberships")
        .select("*")
        .eq("user_id", userId)
        .eq("workspace_id", workspaceId)
        .single(),
      "Failed to verify workspace membership",
    );

    if (!membership) {
      throw new Error("Workspace membership not found");
    }
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      default_workspace_id: workspaceId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (error) {
    throw new Error(`Failed to update default workspace: ${error.message}`);
  }
}

export async function getWorkspaceDetailForUser(
  user: UserIdentity,
  workspaceId: string,
): Promise<WorkspaceDetailResponse> {
  const supabase = getSupabaseAdmin();
  const membership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    "Failed to verify workspace membership",
  );

  const workspace = await requireSingle<WorkspaceRow>(
    supabase
      .from("workspaces")
      .select("*")
      .eq("id", workspaceId)
      .single(),
    "Failed to load workspace",
  );

  const { data: membershipRows, error: membershipError } = await supabase
    .from("workspace_memberships")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw new Error(`Failed to load workspace members: ${membershipError.message}`);
  }

  const memberships = (membershipRows ?? []) as WorkspaceMembershipRow[];
  const userIds = memberships.map((item) => item.user_id);
  const { data: profileRows, error: profileError } = await supabase
    .from("profiles")
    .select("id, email")
    .in("id", userIds);

  if (profileError) {
    throw new Error(`Failed to load member profiles: ${profileError.message}`);
  }

  const profileByUserId = new Map(
    ((profileRows ?? []) as MembershipProfileRow[]).map((profile) => [profile.id, profile]),
  );

  const members: WorkspaceMemberRecord[] = memberships.map((item) => {
    const profile = profileByUserId.get(item.user_id);
    const email = profile?.email ?? null;
    return {
      userId: item.user_id,
      email,
      displayName: buildDisplayName(email),
      role: item.role,
      joinedAt: item.created_at,
    };
  });

  const { data: invitationRows, error: invitationError } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });

  if (invitationError) {
    throw new Error(`Failed to load workspace invitations: ${invitationError.message}`);
  }

  return {
    workspace: mapWorkspace(workspace, membership.role),
    members,
    invitations:
      membership.role === "owner"
        ? ((invitationRows ?? []) as WorkspaceInvitationRow[]).map(mapInvitation)
        : [],
  };
}

export async function renameWorkspaceForUser(
  user: UserIdentity,
  workspaceId: string,
  name: string,
): Promise<WorkspaceRecord> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Workspace name is required");
  }

  const supabase = getSupabaseAdmin();
  const membership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    "Failed to verify workspace membership",
  );

  if (membership.role !== "owner") {
    throw new Error("Only workspace owners can rename the workspace");
  }

  const workspace = await requireSingle<WorkspaceRow>(
    supabase
      .from("workspaces")
      .update({
        name: trimmedName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", workspaceId)
      .select("*")
      .single(),
    "Failed to update workspace",
  );

  return mapWorkspace(workspace, membership.role);
}

export async function inviteMemberToWorkspace(
  user: UserIdentity,
  workspaceId: string,
  email: string,
): Promise<WorkspaceInvitationRecord> {
  const supabase = getSupabaseAdmin();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw new Error("Invitation email is required");
  }

  const membership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    "Failed to verify workspace membership",
  );

  if (membership.role !== "owner") {
    throw new Error("Only workspace owners can invite members");
  }

  const { data: existingProfile, error: existingProfileError } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingProfileError) {
    throw new Error(`Failed to verify invitation target: ${existingProfileError.message}`);
  }

  if (existingProfile?.id) {
    const { data: existingMembership, error: existingMembershipError } = await supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", existingProfile.id)
      .maybeSingle();

    if (existingMembershipError) {
      throw new Error(`Failed to verify existing membership: ${existingMembershipError.message}`);
    }

    if (existingMembership) {
      throw new Error("That user is already a workspace member");
    }
  }

  const { data: existingInvitation, error: existingInvitationError } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("email", normalizedEmail)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .maybeSingle();

  if (existingInvitationError) {
    throw new Error(`Failed to verify pending invitations: ${existingInvitationError.message}`);
  }

  if (existingInvitation) {
    throw new Error("A pending invitation already exists for that email");
  }

  const invitation = await requireSingle<WorkspaceInvitationRow>(
    supabase
      .from("workspace_invitations")
      .insert({
        workspace_id: workspaceId,
        email: normalizedEmail,
        role: "member",
        invited_by_user_id: user.id,
      })
      .select("*")
      .single(),
    "Failed to create invitation",
  );

  return mapInvitation(invitation);
}

export async function revokeInvitationForWorkspace(
  user: UserIdentity,
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const membership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    "Failed to verify workspace membership",
  );

  if (membership.role !== "owner") {
    throw new Error("Only workspace owners can revoke invitations");
  }

  const { error } = await supabase
    .from("workspace_invitations")
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", invitationId)
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null);

  if (error) {
    throw new Error(`Failed to revoke invitation: ${error.message}`);
  }
}

export async function updateWorkspaceMemberRoleForOwner(
  user: UserIdentity,
  workspaceId: string,
  memberUserId: string,
  role: WorkspaceMemberRole,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const ownerMembership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    "Failed to verify workspace membership",
  );

  if (ownerMembership.role !== "owner") {
    throw new Error("Only workspace owners can update member roles");
  }

  if (memberUserId === user.id) {
    throw new Error("You cannot change your own role");
  }

  const targetMembership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", memberUserId)
      .single(),
    "Failed to load target membership",
  );

  if (targetMembership.role === role) {
    return;
  }

  if (targetMembership.role === "owner" && role !== "owner") {
    const ownerCount = await countWorkspaceOwners(workspaceId);
    if (ownerCount < 2) {
      throw new Error("At least one workspace owner must remain");
    }
  }

  const { error } = await supabase
    .from("workspace_memberships")
    .update({
      role,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId)
    .eq("user_id", memberUserId);

  if (error) {
    throw new Error(`Failed to update member role: ${error.message}`);
  }
}

export async function removeWorkspaceMemberForOwner(
  user: UserIdentity,
  workspaceId: string,
  memberUserId: string,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const ownerMembership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", user.id)
      .single(),
    "Failed to verify workspace membership",
  );

  if (ownerMembership.role !== "owner") {
    throw new Error("Only workspace owners can remove members");
  }

  if (memberUserId === user.id) {
    throw new Error("You cannot remove yourself from the workspace");
  }

  const targetMembership = await requireSingle<WorkspaceMembershipRow>(
    supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("user_id", memberUserId)
      .single(),
    "Failed to load target membership",
  );

  if (targetMembership.role === "owner") {
    const ownerCount = await countWorkspaceOwners(workspaceId);
    if (ownerCount < 2) {
      throw new Error("At least one workspace owner must remain");
    }
  }

  const { error } = await supabase
    .from("workspace_memberships")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", memberUserId);

  if (error) {
    throw new Error(`Failed to remove workspace member: ${error.message}`);
  }
}

async function acceptPendingInvitations(user: UserIdentity): Promise<void> {
  const normalizedEmail = normalizeEmail(user.email ?? "");
  if (!normalizedEmail) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { data: invitationRows, error: invitationError } = await supabase
    .from("workspace_invitations")
    .select("*")
    .eq("email", normalizedEmail)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });

  if (invitationError) {
    throw new Error(`Failed to load pending invitations: ${invitationError.message}`);
  }

  for (const invitation of (invitationRows ?? []) as WorkspaceInvitationRow[]) {
    const { data: existingMembership, error: membershipError } = await supabase
      .from("workspace_memberships")
      .select("*")
      .eq("workspace_id", invitation.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (membershipError) {
      throw new Error(`Failed to verify accepted invitation membership: ${membershipError.message}`);
    }

    if (!existingMembership) {
      const { error: insertError } = await supabase
        .from("workspace_memberships")
        .insert({
          workspace_id: invitation.workspace_id,
          user_id: user.id,
          role: invitation.role === "owner" ? "owner" : "member",
        });

      if (insertError) {
        throw new Error(`Failed to accept invitation: ${insertError.message}`);
      }
    }

    const { error: invitationUpdateError } = await supabase
      .from("workspace_invitations")
      .update({
        accepted_at: new Date().toISOString(),
        accepted_by_user_id: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", invitation.id);

    if (invitationUpdateError) {
      throw new Error(`Failed to finalize invitation acceptance: ${invitationUpdateError.message}`);
    }
  }
}

async function countWorkspaceOwners(workspaceId: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("workspace_memberships")
    .select("user_id")
    .eq("workspace_id", workspaceId)
    .eq("role", "owner");

  if (error) {
    throw new Error(`Failed to count workspace owners: ${error.message}`);
  }

  return data?.length ?? 0;
}

function resolveCurrentWorkspaceId(
  defaultWorkspaceId: string | null,
  workspaces: WorkspaceRecord[],
): string | null {
  if (!workspaces.length) {
    return null;
  }

  if (defaultWorkspaceId && workspaces.some((workspace) => workspace.id === defaultWorkspaceId)) {
    return defaultWorkspaceId;
  }

  return workspaces[0].id;
}
