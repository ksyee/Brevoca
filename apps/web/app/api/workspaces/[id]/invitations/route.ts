import { NextResponse } from "next/server";
import { requireRequestUser } from "@/lib/server/auth";
import { inviteMemberToWorkspace } from "@/lib/server/workspaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const body = (await request.json()) as { email?: string };
    const invitation = await inviteMemberToWorkspace(user, id, body.email ?? "");
    return NextResponse.json({ invitation }, { status: 201 });
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
