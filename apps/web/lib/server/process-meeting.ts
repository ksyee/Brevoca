import "server-only";

import { promptTemplateIds, type ProcessingErrorType } from "@brevoca/contracts";
import { summarizeTranscript, transcribeAudioFile } from "./openai";
import {
  completeProcessing,
  downloadMeetingAudio,
  getStoredMeetingByJob,
  markStageStarted,
  resetJobForRetry,
  setProcessingFailure,
  updateJob,
} from "./store";

const activeJobs = new Set<string>();

export function startMeetingProcessing(jobId: string): void {
  if (activeJobs.has(jobId)) {
    return;
  }

  activeJobs.add(jobId);
  void processMeeting(jobId).finally(() => {
    activeJobs.delete(jobId);
  });
}

export async function retryMeetingProcessing(jobId: string): Promise<void> {
  await resetJobForRetry(jobId);
  startMeetingProcessing(jobId);
}

async function processMeeting(jobId: string): Promise<void> {
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

    const fileBuffer = await downloadMeetingAudio(storedMeeting.storageKey);

    const transcriptText = await transcribeAudioFile({
      fileBuffer,
      fileName: storedMeeting.fileName || `${storedMeeting.id}.webm`,
      language: storedMeeting.language,
    });

    await updateJob(jobId, {
      stage: "transcribe",
      status: "processing",
      progress: 55,
      logs: [`오디오 업로드 완료: ${storedMeeting.fileName ?? storedMeeting.id}`, "OpenAI 전사를 시작합니다", "전사 완료"],
    });

    await markStageStarted(jobId, "summarizing", "summarize", 70, "OpenAI 요약을 시작합니다");
    stage = "summarize";

    const summary = await summarizeTranscript({
      title: storedMeeting.title,
      language: storedMeeting.language,
      transcriptText,
      promptTemplateId,
    });

    await completeProcessing(jobId, transcriptText, summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setProcessingFailure(jobId, stage, message, classifyError(message, stage));
  }
}

function classifyError(message: string, stage: "transcribe" | "summarize"): ProcessingErrorType {
  const lower = message.toLowerCase();

  if (lower.includes("timeout")) {
    return "timeout";
  }

  if (lower.includes("network")) {
    return "network_error";
  }

  if (lower.includes("api key") || lower.includes("unauthorized") || lower.includes("quota")) {
    return "provider_error";
  }

  return stage === "transcribe" ? "transcription_failed" : "summary_failed";
}
