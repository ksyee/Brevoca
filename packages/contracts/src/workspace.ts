export const workspaceMemberRoles = ["owner", "member"] as const;

export type WorkspaceMemberRole = (typeof workspaceMemberRoles)[number];

export interface CurrentUser {
  id: string;
  email: string | null;
  defaultWorkspaceId: string | null;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  role: WorkspaceMemberRole;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMemberRecord {
  userId: string;
  email: string | null;
  displayName: string;
  role: WorkspaceMemberRole;
  joinedAt: string;
}

export interface WorkspaceInvitationRecord {
  id: string;
  email: string;
  role: WorkspaceMemberRole;
  invitedByUserId: string;
  createdAt: string;
}

export interface WorkspaceDetailResponse {
  workspace: WorkspaceRecord;
  members: WorkspaceMemberRecord[];
  invitations: WorkspaceInvitationRecord[];
}

export interface CurrentUserResponse {
  user: CurrentUser;
  workspaces: WorkspaceRecord[];
  currentWorkspaceId: string | null;
}

export interface CreateWorkspaceResponse {
  workspace: WorkspaceRecord;
  currentWorkspaceId: string;
}
