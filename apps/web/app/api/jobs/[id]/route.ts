import { NextResponse } from "next/server";
import { requireRequestUser, requireWorkspaceId } from "@/lib/server/auth";
import { getJobForWorkspace, requireWorkspaceMembership } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let workspaceId;
  try {
    const user = await requireRequestUser(request);
    workspaceId = requireWorkspaceId(request);
    await requireWorkspaceMembership(user.id, workspaceId);
  } catch (error) {
    return authErrorResponse(error);
  }

  const { id } = await context.params;
  const job = await getJobForWorkspace(id, workspaceId);

  if (!job) {
    return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json(job);
}

function authErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  if (message === "Unauthorized") {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  if (message === "MissingWorkspace") {
    return NextResponse.json({ error: "워크스페이스를 선택해주세요." }, { status: 400 });
  }
  if (message === "Forbidden") {
    return NextResponse.json({ error: "이 워크스페이스에 대한 접근 권한이 없습니다." }, { status: 403 });
  }
  return NextResponse.json({ error: message }, { status: 400 });
}
