import { NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/server/auth";
import { createWorkspaceForUser, getCurrentUserState } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const payload = await getCurrentUserState(user);
    return NextResponse.json({ items: payload.workspaces, currentWorkspaceId: payload.currentWorkspaceId });
  } catch (error) {
    return unauthorizedResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as { name?: string };
    const result = await createWorkspaceForUser(user, body.name ?? "");
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return unauthorizedResponse(error);
  }
}

function unauthorizedResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return NextResponse.json(
    { error: message === "Unauthorized" ? "인증이 필요합니다." : message },
    { status: message === "Unauthorized" ? 401 : 400 },
  );
}
