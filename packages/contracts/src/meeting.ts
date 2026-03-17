import type { PromptTemplateId } from "./prompts";
import type { JobRecord } from "./job";

export const meetingStatuses = [
  "uploaded",
  "transcribing",
  "summarizing",
  "completed",
  "failed",
] as const;

export const meetingSourceTypes = ["upload", "browser_recording"] as const;

export interface ActionItem {
  content: string;
  assignee: string | null;
  dueDate: string | null;
}

export interface MeetingSummary {
  markdown: string;
  overview: string;
  decisions: string[];
  actionItems: ActionItem[];
  openQuestions: string[];
  risks: string[];
}

export type MeetingStatus = (typeof meetingStatuses)[number];
export type MeetingSourceType = (typeof meetingSourceTypes)[number];

export interface MeetingRecord {
  id: string;
  jobId: string;
  title: string;
  status: MeetingStatus;
  sourceType: MeetingSourceType;
  language: string;
  durationSec: number | null;
  createdAt: string;
  updatedAt: string;
  promptTemplateId: PromptTemplateId;
  tags: string[];
}

export interface MeetingDetail extends MeetingRecord {
  transcriptText: string | null;
  summary: MeetingSummary | null;
  fileName: string | null;
  errorMessage?: string | null;
}

export interface MeetingListResponse {
  items: MeetingRecord[];
}

export interface MeetingCreateResponse {
  meetingId: string;
  jobId: string;
  status: MeetingStatus;
}

export interface MeetingWithJob {
  meeting: MeetingDetail;
  job: JobRecord;
}
