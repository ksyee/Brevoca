import { NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/server/auth";
import { getWorkspaceDetailForUser, renameWorkspaceForUser } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const payload = await getWorkspaceDetailForUser(user, id);
    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const body = (await request.json()) as { name?: string };
    const workspace = await renameWorkspaceForUser(user, id, body.name ?? "");
    return NextResponse.json({ workspace });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const status = message === "Unauthorized" ? 401 : message.includes("verify workspace membership") ? 403 : 400;
  return NextResponse.json(
    { error: message === "Unauthorized" ? "인증이 필요합니다." : message },
    { status },
  );
}
