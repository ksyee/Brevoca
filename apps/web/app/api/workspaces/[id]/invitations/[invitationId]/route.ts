import { NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/server/auth";
import { revokeInvitationForWorkspace } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; invitationId: string }> },
) {
  try {
    const user = await requireRequestUser(request);
    const { id, invitationId } = await context.params;
    await revokeInvitationForWorkspace(user, id, invitationId);
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
