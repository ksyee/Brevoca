import { NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/server/auth";
import { getCurrentUserState, updateDefaultWorkspace } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const payload = await getCurrentUserState(user);
    return NextResponse.json(payload);
  } catch (error) {
    return unauthorizedResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as { defaultWorkspaceId?: string | null };
    await updateDefaultWorkspace(user.id, normalizeWorkspaceId(body.defaultWorkspaceId));
    const payload = await getCurrentUserState(user);
    return NextResponse.json(payload);
  } catch (error) {
    return unauthorizedResponse(error);
  }
}

function normalizeWorkspaceId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function unauthorizedResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json(
    { error: message === "Unauthorized" ? "인증이 필요합니다." : message },
    { status: message === "Unauthorized" ? 401 : 400 },
  );
}
