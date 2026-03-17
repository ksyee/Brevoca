import "server-only";

import { promptTemplateIds, type ProcessingErrorType } from "@brevoca/contracts";
import { summarizeTranscript, transcribeAudioFile } from "./openai";
import {
  completeProcessing,
  downloadMeetingAudio,
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
    await markStageStarted(jobId, "transcribing", "transcribe", 15, "OpenAI 전사를 시작합니다");

    if (!storedMeeting.storageKey) {
      throw new Error("Meeting audio is missing from storage.");
    }

    const fileBuffer =
      options?.uploadedAudio?.fileBuffer ??
      await downloadMeetingAudio(storedMeeting.storageKey);

    const isChunked = fileBuffer.length > 24 * 1024 * 1024;
    if (isChunked) {
      await updateJob(jobId, {
        stage: "transcribe",
        status: "processing",
        progress: 20,
        logs: [
          `오디오 업로드 완료: ${storedMeeting.fileName ?? storedMeeting.id}`,
          "OpenAI 전사를 시작합니다",
          `파일 크기(${Math.round(fileBuffer.length / 1024 / 1024)}MB)가 크므로 분할 전사를 진행합니다`,
        ],
      });
    }

    const transcript = await transcribeAudioFile({
      fileBuffer,
      fileName: storedMeeting.fileName || `${storedMeeting.id}.webm`,
      language: storedMeeting.language,
      signal,
    });

    throwIfAborted(signal);

    await updateJob(jobId, {
      stage: "transcribe",
      status: "processing",
      progress: 55,
      logs: [
        `오디오 업로드 완료: ${storedMeeting.fileName ?? storedMeeting.id}`,
        "OpenAI 전사를 시작합니다",
        ...(isChunked ? [`분할 전사 완료 (${Math.round(fileBuffer.length / 1024 / 1024)}MB)`] : []),
        "전사 완료",
      ],
    });

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

  if (lower.includes("timeout")) {
    return "timeout";
  }

  if (
    lower.includes("network") ||
    lower.includes("bad gateway") ||
    lower.includes("gateway") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("socket hang up") ||
    lower.includes("failed to download meeting audio")
  ) {
    return "network_error";
  }

  if (
    lower.includes("api key") ||
    lower.includes("unauthorized") ||
    lower.includes("quota") ||
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
