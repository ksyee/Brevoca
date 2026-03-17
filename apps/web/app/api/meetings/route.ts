import { NextResponse } from "next/server";
import { defaultPromptTemplateId, promptTemplateIds, type MeetingSourceType } from "@brevoca/contracts";
import { startMeetingProcessing } from "@/lib/server/process-meeting";
import { createMeeting, listMeetings } from "@/lib/server/store";

export const runtime = "nodejs";

export async function GET() {
  const items = await listMeetings();
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "오디오 파일이 필요합니다." }, { status: 400 });
  }

  const sourceType = normalizeSourceType(formData.get("sourceType"));
  const title = normalizeString(formData.get("title")) || stripFileExtension(file.name) || "제목 없는 회의";
  const language = normalizeString(formData.get("language")) || "ko";
  const durationSec = normalizeDuration(formData.get("durationSec"));
  const promptTemplateId = normalizePromptTemplate(formData.get("promptTemplateId"));
  const tags = normalizeTags(formData.get("tags"));

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const response = await createMeeting({
    fileBuffer,
    fileName: file.name || `${title}.webm`,
    title,
    language,
    sourceType,
    tags,
    promptTemplateId,
    durationSec,
  });

  startMeetingProcessing(response.jobId);

  return NextResponse.json(response, { status: 201 });
}

function normalizeString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDuration(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
}

function normalizeTags(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeSourceType(value: FormDataEntryValue | null): MeetingSourceType {
  return value === "browser_recording" ? "browser_recording" : "upload";
}

function normalizePromptTemplate(value: FormDataEntryValue | null) {
  if (typeof value !== "string") {
    return defaultPromptTemplateId;
  }

  return promptTemplateIds.find((item) => item === value) ?? defaultPromptTemplateId;
}

function stripFileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot > 0 ? fileName.slice(0, lastDot) : fileName;
}
