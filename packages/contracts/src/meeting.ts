import type { PromptTemplateId } from "./prompts";
import type { JobRecord } from "./job";

export const meetingStatuses = [
  "uploaded",
  "transcribing",
  "summarizing",
  "completed",
  "failed",
  "canceled",
] as const;

export const meetingSourceTypes = ["upload", "browser_recording"] as const;

export interface ActionItem {
  content: string;
  assignee: string | null;
  dueDate: string | null;
}

export interface DiscussionTopic {
  title: string;
  points: string[];
}

export interface MeetingSummary {
  markdown: string;
  nextSteps: ActionItem[];
  topics: DiscussionTopic[];
}

export interface TranscriptSegment {
  speaker: string | null;
  startSec: number;
  endSec: number;
  text: string;
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
  transcriptSegments: TranscriptSegment[] | null;
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
