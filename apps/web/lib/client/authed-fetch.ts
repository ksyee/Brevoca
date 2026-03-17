"use client";

import { getBrowserSupabaseClient } from "@/lib/supabase/client";

let _currentWorkspaceId: string | null = null;

export function setCurrentWorkspaceId(workspaceId: string | null) {
  _currentWorkspaceId = workspaceId;
}

export function getCurrentWorkspaceId(): string | null {
  return _currentWorkspaceId;
}

interface AuthedFetchOptions extends RequestInit {
  accessToken?: string;
}

export async function authedFetch(input: RequestInfo | URL, init: AuthedFetchOptions = {}) {
  const accessToken = init.accessToken ?? (await getStoredAccessToken());
  if (!accessToken) {
    throw new Error("로그인이 필요합니다.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);

  if (_currentWorkspaceId && !headers.has("X-Workspace-Id")) {
    headers.set("X-Workspace-Id", _currentWorkspaceId);
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(input, {
    ...init,
    headers,
  });
}

async function getStoredAccessToken() {
  const supabase = getBrowserSupabaseClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return session?.access_token ?? null;
}
