"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { CurrentUser, CurrentUserResponse, WorkspaceRecord } from "@brevoca/contracts";
import type { Session } from "@supabase/supabase-js";
import { authedFetch, setCurrentWorkspaceId as syncWorkspaceId } from "@/lib/client/authed-fetch";
import { getBrowserSupabaseClient } from "@/lib/supabase/client";

type SessionStatus = "loading" | "authenticated" | "unauthenticated";

interface AppSessionContextValue {
  status: SessionStatus;
  user: CurrentUser | null;
  workspaces: WorkspaceRecord[];
  currentWorkspace: WorkspaceRecord | null;
  refresh: () => Promise<void>;
  createWorkspace: (name: string) => Promise<WorkspaceRecord>;
  selectWorkspace: (workspaceId: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AppSessionContext = createContext<AppSessionContextValue | null>(null);

export function AppSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getBrowserSupabaseClient();
    void refreshFromSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_, session) => {
      void refreshFromSession(session);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function refreshFromSession(sessionOverride?: Session | null) {
    const session =
      sessionOverride ??
      (
        await getBrowserSupabaseClient().auth.getSession()
      ).data.session;

    if (!session?.access_token) {
      setStatus("unauthenticated");
      setUser(null);
      setWorkspaces([]);
      setCurrentWorkspaceId(null);
      return;
    }

    const response = await authedFetch("/api/me", {
      accessToken: session.access_token,
      cache: "no-store",
    });

    if (response.status === 401) {
      setStatus("unauthenticated");
      setUser(null);
      setWorkspaces([]);
      setCurrentWorkspaceId(null);
      return;
    }

    if (!response.ok) {
      console.error("Failed to load current user state", await getResponseError(response));
      setStatus("authenticated");
      setUser({
        id: session.user.id,
        email: session.user.email ?? null,
        defaultWorkspaceId: null,
      });
      setWorkspaces([]);
      setCurrentWorkspaceId(null);
      return;
    }

    const payload = (await response.json()) as CurrentUserResponse;
    setStatus("authenticated");
    setUser(payload.user);
    setWorkspaces(payload.workspaces);
    setCurrentWorkspaceId(payload.currentWorkspaceId);
  }

  async function createWorkspace(name: string) {
    const response = await authedFetch("/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      throw new Error(await getResponseError(response));
    }

    const payload = (await response.json()) as { workspace: WorkspaceRecord; currentWorkspaceId: string };
    setWorkspaces((current) => [...current, payload.workspace]);
    setCurrentWorkspaceId(payload.currentWorkspaceId);
    if (user) {
      setUser({
        ...user,
        defaultWorkspaceId: payload.currentWorkspaceId,
      });
    }
    return payload.workspace;
  }

  async function selectWorkspace(workspaceId: string) {
    const response = await authedFetch("/api/me", {
      method: "PATCH",
      body: JSON.stringify({ defaultWorkspaceId: workspaceId }),
    });

    if (!response.ok) {
      throw new Error(await getResponseError(response));
    }

    const payload = (await response.json()) as CurrentUserResponse;
    setUser(payload.user);
    setWorkspaces(payload.workspaces);
    setCurrentWorkspaceId(payload.currentWorkspaceId);
  }

  async function signOut() {
    const supabase = getBrowserSupabaseClient();
    await supabase.auth.signOut();
    setStatus("unauthenticated");
    setUser(null);
    setWorkspaces([]);
    setCurrentWorkspaceId(null);
  }

  useEffect(() => {
    syncWorkspaceId(currentWorkspaceId);
  }, [currentWorkspaceId]);

  const currentWorkspace = workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null;

  const value: AppSessionContextValue = {
    status,
    user,
    workspaces,
    currentWorkspace,
    refresh: refreshFromSession,
    createWorkspace,
    selectWorkspace,
    signOut,
  };

  return <AppSessionContext.Provider value={value}>{children}</AppSessionContext.Provider>;
}

export function useAppSession() {
  const value = useContext(AppSessionContext);
  if (!value) {
    throw new Error("useAppSession must be used inside AppSessionProvider");
  }
  return value;
}

async function getResponseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}
