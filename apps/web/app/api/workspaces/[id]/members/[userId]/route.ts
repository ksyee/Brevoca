import { NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/server/auth";
import { removeWorkspaceMemberForOwner, updateWorkspaceMemberRoleForOwner } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = await requireRequestUser(request);
    const { id, userId } = await context.params;
    const body = (await request.json()) as { role?: "owner" | "member" };
    if (body.role !== "owner" && body.role !== "member") {
      return NextResponse.json({ error: "유효한 역할이 필요합니다." }, { status: 400 });
    }
    await updateWorkspaceMemberRoleForOwner(user, id, userId, body.role);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; userId: string }> },
) {
  try {
    const user = await requireRequestUser(request);
    const { id, userId } = await context.params;
    await removeWorkspaceMemberForOwner(user, id, userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const status =
    message === "Unauthorized" ? 401 :
    message.startsWith("Only workspace owners") ? 403 :
    400;

  return NextResponse.json(
    { error: message === "Unauthorized" ? "인증이 필요합니다." : message },
    { status },
  );
}
