import { NextResponse } from "next/server";
import { getMeeting } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const meeting = await getMeeting(id);

  if (!meeting) {
    return NextResponse.json({ error: "회의를 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json(meeting);
}
