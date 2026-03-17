export const jobStages = ["transcribe", "summarize"] as const;
export const jobStatuses = ["queued", "processing", "completed", "failed", "canceled"] as const;
export const processingErrorTypes = [
  "upload_failed",
  "transcription_failed",
  "summary_failed",
  "provider_error",
  "timeout",
  "network_error",
] as const;

export type JobStage = (typeof jobStages)[number];
export type JobStatus = (typeof jobStatuses)[number];
export type ProcessingErrorType = (typeof processingErrorTypes)[number];

export interface JobRecord {
  id: string;
  meetingId: string;
  stage: JobStage;
  status: JobStatus;
  progress: number;
  logs: string[];
  errorMessage?: string | null;
  errorType?: ProcessingErrorType | null;
  createdAt: string;
  updatedAt: string;
}
