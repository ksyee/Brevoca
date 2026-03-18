import "server-only";

import { promptTemplateIds, type ProcessingErrorType } from "@brevoca/contracts";
import { summarizeTranscript, transcribeAudioFile, type TranscribeProgressCallback } from "./openai";
import {
  completeProcessing,
  downloadMeetingAudio,
  getJob,
  getStoredMeetingByJob,
  markStageStarted,
  resetJobForRetry,
  setProcessingCanceled,
  setProcessingFailure,
  updateJob,
} from "./store";

type ActiveJob = {
  controller: AbortController;
  promise: Promise<void>;
};

const activeJobs = new Map<string, ActiveJob>();

interface StartMeetingProcessingOptions {
  uploadedAudio?: {
    fileBuffer: Buffer;
  };
}

export function startMeetingProcessing(jobId: string, options?: StartMeetingProcessingOptions): void {
  if (activeJobs.has(jobId)) {
    return;
  }

  const controller = new AbortController();
  const promise = processMeeting(jobId, controller.signal, options).finally(() => {
    activeJobs.delete(jobId);
  });

  activeJobs.set(jobId, { controller, promise });
  void promise;
}

export async function retryMeetingProcessing(jobId: string): Promise<void> {
  await resetJobForRetry(jobId);
  startMeetingProcessing(jobId);
}

export async function cancelMeetingProcessing(jobId: string): Promise<void> {
  const activeJob = activeJobs.get(jobId);
  if (activeJob) {
    activeJob.controller.abort(new Error("Processing canceled by user"));
    await activeJob.promise.catch(() => {});
    return;
  }

  await setProcessingCanceled(jobId);
}

async function processMeeting(jobId: string, signal: AbortSignal, options?: StartMeetingProcessingOptions): Promise<void> {
  const storedMeeting = await getStoredMeetingByJob(jobId);
  if (!storedMeeting) {
    throw new Error(`Meeting for job ${jobId} not found`);
  }

  const promptTemplateId = promptTemplateIds.includes(storedMeeting.promptTemplateId as (typeof promptTemplateIds)[number])
    ? storedMeeting.promptTemplateId
    : promptTemplateIds[0];
  let stage: "transcribe" | "summarize" = "transcribe";

  try {
    await markStageStarted(jobId, "transcribing", "transcribe", 15, "전사 준비를 시작합니다");

    if (!options?.uploadedAudio?.fileBuffer && !storedMeeting.storageKey) {
      throw new Error("Meeting audio is missing from storage.");
    }

    let fileBuffer: Buffer;
    if (options?.uploadedAudio?.fileBuffer) {
      fileBuffer = options.uploadedAudio.fileBuffer;
      await appendJobLog(jobId, "업로드된 오디오를 사용해 Storage 다운로드를 생략합니다");
    } else {
      await appendJobLog(jobId, "Storage에서 회의 오디오 다운로드를 시작합니다");
      fileBuffer = await downloadMeetingAudio(storedMeeting.storageKey!);
      await appendJobLog(jobId, "Storage에서 회의 오디오 다운로드를 완료했습니다", 20);
    }

    const onTranscribeProgress: TranscribeProgressCallback = (progress, message) =>
      appendJobLog(jobId, message, progress);

    const transcript = await transcribeAudioFile({
      fileBuffer,
      fileName: storedMeeting.fileName || `${storedMeeting.id}.webm`,
      language: storedMeeting.language,
      durationSec: storedMeeting.durationSec,
      signal,
      onProgress: onTranscribeProgress,
    });

    throwIfAborted(signal);
    await appendJobLog(jobId, "전사 완료", 55);

    await markStageStarted(jobId, "summarizing", "summarize", 70, "OpenAI 요약을 시작합니다");
    stage = "summarize";

    const summary = await summarizeTranscript({
      title: storedMeeting.title,
      language: storedMeeting.language,
      transcriptText: transcript.transcriptText,
      transcriptChunks: transcript.transcriptChunks,
      promptTemplateId,
      signal,
    });

    throwIfAborted(signal);
    await completeProcessing(jobId, transcript.transcriptText, transcript.transcriptSegments, summary);
  } catch (error) {
    if (isAbortError(error)) {
      await setProcessingCanceled(jobId);
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    await setProcessingFailure(jobId, stage, message, classifyError(message, stage));
  }
}

function classifyError(message: string, stage: "transcribe" | "summarize"): ProcessingErrorType {
  const lower = message.toLowerCase();

  if (lower.includes("timeout") || lower.includes("http 408") || message.includes("시간 안에 완료되지")) {
    return "timeout";
  }

  if (
    lower.includes("network") ||
    lower.includes("bad gateway") ||
    lower.includes("gateway") ||
    lower.includes("http 502") ||
    lower.includes("http 504") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up") ||
    lower.includes("failed to download meeting audio") ||
    message.includes("네트워크 오류") ||
    message.includes("연결에 실패") ||
    message.includes("연결이 재설정") ||
    message.includes("연결을 종료")
  ) {
    return "network_error";
  }

  if (
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("quota") ||
    lower.includes("http 4") ||
    lower.includes("http 5") ||
    lower.includes("the server had an error processing your request") ||
    lower.includes("help.openai.com") ||
    lower.includes("please include the request id") ||
    lower.includes("request id") ||
    lower.includes("server had an error")
  ) {
    return "provider_error";
  }

  return stage === "transcribe" ? "transcription_failed" : "summary_failed";
}

async function appendJobLog(jobId: string, message: string, progress?: number): Promise<void> {
  const job = await getJob(jobId);
  if (!job) {
    throw new Error(`Job ${jobId} not found`);
  }

  await updateJob(jobId, {
    stage: job.stage,
    status: job.status,
    progress: typeof progress === "number" ? progress : job.progress,
    logs: [...job.logs, message],
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Processing canceled by user");
  }
}

function isAbortError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.toLowerCase().includes("canceled");
  }

  return false;
}
