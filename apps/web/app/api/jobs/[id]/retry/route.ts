import { NextResponse } from "next/server";
import { retryMeetingProcessing } from "@/lib/server/process-meeting";
import { getJob } from "@/lib/server/store";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const job = await getJob(id);

  if (!job) {
    return NextResponse.json({ error: "작업을 찾을 수 없습니다." }, { status: 404 });
  }

  await retryMeetingProcessing(id);
  return NextResponse.json({ ok: true });
}
