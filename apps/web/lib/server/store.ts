import "server-only";

import path from "path";
import { randomUUID } from "crypto";
import {
  defaultPromptTemplateId,
  type JobRecord,
  type JobStage,
  type MeetingCreateResponse,
  type MeetingDetail,
  type MeetingRecord,
  type MeetingSourceType,
  type MeetingStatus,
  type MeetingSummary,
  type ProcessingErrorType,
  type PromptTemplateId,
} from "@brevoca/contracts";
import { getMeetingAudioBucket, getSupabaseAdmin } from "./supabase";

interface CreateMeetingInput {
  fileBuffer: Buffer;
  fileName: string;
  title: string;
  language: string;
  sourceType: MeetingSourceType;
  tags: string[];
  promptTemplateId: PromptTemplateId;
  durationSec: number | null;
}

interface MeetingRow {
  id: string;
  job_id: string;
  title: string;
  status: MeetingStatus;
  source_type: MeetingSourceType;
  language: string;
  duration_sec: number | null;
  created_at: string;
  updated_at: string;
  prompt_template_id: PromptTemplateId;
  tags: string[] | null;
  transcript_text: string | null;
  summary: MeetingSummary | null;
  file_name: string | null;
  error_message: string | null;
  storage_key: string | null;
}

interface JobRow {
  id: string;
  meeting_id: string;
  stage: JobRecord["stage"];
  status: JobRecord["status"];
  progress: number;
  logs: string[] | null;
  error_message: string | null;
  error_type: JobRecord["errorType"];
  created_at: string;
  updated_at: string;
}

interface StoredMeeting extends MeetingDetail {
  storageKey: string | null;
}

function getAudioExtension(fileName: string): string {
  const parsed = path.extname(fileName).trim();
  return parsed || ".webm";
}

function getContentType(fileName: string): string {
  switch (path.extname(fileName).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg";
    case ".m4a":
      return "audio/mp4";
    case ".wav":
      return "audio/wav";
    case ".ogg":
      return "audio/ogg";
    case ".webm":
      return "audio/webm";
    default:
      return "application/octet-stream";
  }
}

function mapJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    stage: row.stage,
    status: row.status,
    progress: row.progress,
    logs: row.logs ?? [],
    errorMessage: row.error_message ?? null,
    errorType: row.error_type ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMeetingRecord(row: MeetingRow): MeetingRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    title: row.title,
    status: row.status,
    sourceType: row.source_type,
    language: row.language,
    durationSec: row.duration_sec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    promptTemplateId: row.prompt_template_id,
    tags: row.tags ?? [],
  };
}

function mapMeetingDetail(row: MeetingRow): StoredMeeting {
  return {
    ...mapMeetingRecord(row),
    transcriptText: row.transcript_text,
    summary: row.summary,
    fileName: row.file_name,
    errorMessage: row.error_message ?? null,
    storageKey: row.storage_key,
  };
}

async function requireSingle<T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>, context: string): Promise<T> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${context}: ${error.message}`);
  }
  if (!data) {
    throw new Error(`${context}: no data returned`);
  }
  return data;
}

export async function createMeeting(input: CreateMeetingInput): Promise<MeetingCreateResponse> {
  const supabase = getSupabaseAdmin();
  const meetingId = randomUUID();
  const jobId = randomUUID();
  const now = new Date().toISOString();
  const storageKey = `meetings/${meetingId}/original${getAudioExtension(input.fileName)}`;
  const bucket = getMeetingAudioBucket();

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storageKey, input.fileBuffer, {
      contentType: getContentType(input.fileName),
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Storage upload failed: ${uploadError.message}`);
  }

  try {
    await requireSingle(
      supabase
        .from("meetings")
        .insert({
          id: meetingId,
          job_id: jobId,
          title: input.title,
          status: "uploaded",
          source_type: input.sourceType,
          language: input.language,
          duration_sec: input.durationSec,
          prompt_template_id: input.promptTemplateId || defaultPromptTemplateId,
          tags: input.tags,
          transcript_text: null,
          summary: null,
          file_name: input.fileName,
          error_message: null,
          storage_key: storageKey,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single(),
      "Failed to insert meeting",
    );

    await requireSingle(
      supabase
        .from("jobs")
        .insert({
          id: jobId,
          meeting_id: meetingId,
          stage: "transcribe",
          status: "queued",
          progress: 5,
          logs: [`오디오 업로드 완료: ${input.fileName}`],
          error_message: null,
          error_type: null,
          created_at: now,
          updated_at: now,
        })
        .select()
        .single(),
      "Failed to insert job",
    );
  } catch (error) {
    await supabase.from("meetings").delete().eq("id", meetingId);
    await supabase.storage.from(bucket).remove([storageKey]);
    throw error;
  }

  return {
    meetingId,
    jobId,
    status: "uploaded",
  };
}

export async function listMeetings(): Promise<MeetingRecord[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("meetings")
    .select("id, job_id, title, status, source_type, language, duration_sec, created_at, updated_at, prompt_template_id, tags")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list meetings: ${error.message}`);
  }

  return (data as MeetingRow[]).map(mapMeetingRecord);
}

export async function getMeeting(meetingId: string): Promise<MeetingDetail | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("id", meetingId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load meeting: ${error.message}`);
  }

  return data ? mapMeetingDetail(data as MeetingRow) : null;
}

export async function getJob(jobId: string): Promise<JobRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load job: ${error.message}`);
  }

  return data ? mapJob(data as JobRow) : null;
}

export async function getStoredMeetingByJob(jobId: string): Promise<StoredMeeting | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("meetings")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load meeting by job: ${error.message}`);
  }

  return data ? mapMeetingDetail(data as MeetingRow) : null;
}

export async function downloadMeetingAudio(storageKey: string): Promise<Buffer> {
  const supabase = getSupabaseAdmin();
  const bucket = getMeetingAudioBucket();
  const { data, error } = await supabase.storage.from(bucket).download(storageKey);

  if (error) {
    throw new Error(`Failed to download meeting audio: ${error.message}`);
  }

  return Buffer.from(await data.arrayBuffer());
}

export async function updateJob(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
  const supabase = getSupabaseAdmin();
  const payload = {
    ...(patch.stage ? { stage: patch.stage } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(typeof patch.progress === "number" ? { progress: patch.progress } : {}),
    ...(patch.logs ? { logs: patch.logs } : {}),
    ...(patch.errorMessage !== undefined ? { error_message: patch.errorMessage } : {}),
    ...(patch.errorType !== undefined ? { error_type: patch.errorType } : {}),
    updated_at: new Date().toISOString(),
  };

  const row = await requireSingle<JobRow>(
    supabase.from("jobs").update(payload).eq("id", jobId).select().single(),
    "Failed to update job",
  );

  return mapJob(row);
}

export async function updateMeeting(
  meetingId: string,
  patch: Partial<StoredMeeting>,
): Promise<MeetingDetail> {
  const supabase = getSupabaseAdmin();
  const payload = {
    ...(patch.title ? { title: patch.title } : {}),
    ...(patch.status ? { status: patch.status } : {}),
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.durationSec !== undefined ? { duration_sec: patch.durationSec } : {}),
    ...(patch.promptTemplateId ? { prompt_template_id: patch.promptTemplateId } : {}),
    ...(patch.tags ? { tags: patch.tags } : {}),
    ...(patch.transcriptText !== undefined ? { transcript_text: patch.transcriptText } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.fileName !== undefined ? { file_name: patch.fileName } : {}),
    ...(patch.errorMessage !== undefined ? { error_message: patch.errorMessage } : {}),
    ...(patch.storageKey !== undefined ? { storage_key: patch.storageKey } : {}),
    updated_at: new Date().toISOString(),
  };

  const row = await requireSingle<MeetingRow>(
    supabase.from("meetings").update(payload).eq("id", meetingId).select().single(),
    "Failed to update meeting",
  );

  return mapMeetingDetail(row);
}

export async function setProcessingFailure(
  jobId: string,
  stage: JobStage,
  errorMessage: string,
  errorType: ProcessingErrorType,
): Promise<void> {
  const meeting = await getStoredMeetingByJob(jobId);
  const job = await getJob(jobId);
  if (!meeting || !job) {
    throw new Error(`Job ${jobId} not found`);
  }

  await updateJob(jobId, {
    stage,
    status: "failed",
    progress: Math.max(job.progress, stage === "transcribe" ? 25 : 75),
    errorMessage,
    errorType,
    logs: [...job.logs, `오류: ${errorMessage}`],
  });

  await updateMeeting(meeting.id, {
    status: "failed",
    errorMessage,
  });
}

export async function markStageStarted(
  jobId: string,
  meetingStatus: MeetingStatus,
  stage: JobStage,
  progress: number,
  log: string,
): Promise<void> {
  const meeting = await getStoredMeetingByJob(jobId);
  const job = await getJob(jobId);
  if (!meeting || !job) {
    throw new Error(`Job ${jobId} not found`);
  }

  await updateJob(jobId, {
    stage,
    status: "processing",
    progress,
    logs: [...job.logs, log],
    errorMessage: null,
    errorType: null,
  });

  await updateMeeting(meeting.id, {
    status: meetingStatus,
    errorMessage: null,
  });
}

export async function completeProcessing(
  jobId: string,
  transcriptText: string,
  summary: MeetingSummary,
): Promise<void> {
  const meeting = await getStoredMeetingByJob(jobId);
  const job = await getJob(jobId);
  if (!meeting || !job) {
    throw new Error(`Job ${jobId} not found`);
  }

  await updateJob(jobId, {
    stage: "summarize",
    status: "completed",
    progress: 100,
    logs: [...job.logs, "요약 완료", "처리 완료"],
    errorMessage: null,
    errorType: null,
  });

  await updateMeeting(meeting.id, {
    status: "completed",
    transcriptText,
    summary,
    errorMessage: null,
  });
}

export async function resetJobForRetry(jobId: string): Promise<JobRecord> {
  const meeting = await getStoredMeetingByJob(jobId);
  const job = await getJob(jobId);
  if (!meeting || !job) {
    throw new Error(`Job ${jobId} not found`);
  }

  await updateMeeting(meeting.id, {
    status: "uploaded",
    errorMessage: null,
  });

  return updateJob(jobId, {
    stage: "transcribe",
    status: "queued",
    progress: 5,
    logs: [...job.logs, "재처리 요청 접수"],
    errorMessage: null,
    errorType: null,
  });
}
