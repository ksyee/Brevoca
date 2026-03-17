import "server-only";

import path from "path";
import {
  defaultPromptTemplateId,
  promptTemplates,
  type MeetingSummary,
  type PromptTemplateId,
} from "@brevoca/contracts";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

function getRequiredEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim() || fallback;
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function getOpenAiHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${getRequiredEnv("OPENAI_API_KEY")}`,
  };
}

export async function transcribeAudioFile(options: {
  fileBuffer: Buffer;
  fileName: string;
  language: string;
}): Promise<string> {
  const model = getRequiredEnv("BREVOCA_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe");
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(options.fileBuffer)], { type: getMimeType(options.fileName) });

  formData.append("model", model);
  formData.append("language", options.language);
  formData.append("file", blob, options.fileName);

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: getOpenAiHeaders(),
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getOpenAiErrorMessage(response));
  }

  const payload = (await response.json()) as { text?: string };
  if (!payload.text) {
    throw new Error("OpenAI transcription response did not include text");
  }

  return payload.text.trim();
}

export async function summarizeTranscript(options: {
  title: string;
  language: string;
  transcriptText: string;
  promptTemplateId: PromptTemplateId;
}): Promise<MeetingSummary> {
  const model = getRequiredEnv("BREVOCA_SUMMARY_MODEL", "gpt-5-mini");
  const promptTemplate = promptTemplates[options.promptTemplateId] ?? promptTemplates[defaultPromptTemplateId];
  const summaryPrompt = [
    "Return strict JSON only.",
    'Use this JSON shape: {"overview":string,"decisions":string[],"actionItems":[{"content":string,"assignee":string|null,"dueDate":string|null}],"openQuestions":string[],"risks":string[]}.',
    "Do not wrap the JSON in markdown fences.",
    "",
    "Meeting title:",
    options.title,
    "",
    "Language:",
    options.language,
    "",
    "Instructions:",
    promptTemplate.trim(),
    "",
    "Transcript:",
    options.transcriptText,
  ].join("\n");

  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      ...getOpenAiHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: summaryPrompt,
    }),
  });

  if (!response.ok) {
    throw new Error(await getOpenAiErrorMessage(response));
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };
  const text = extractResponseText(payload);
  const summary = parseSummaryJson(text);

  return {
    ...summary,
    markdown: buildMarkdown(summary),
  };
}

function extractResponseText(payload: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const content = payload.output?.flatMap((entry) => entry.content ?? []) ?? [];
  const text = content
    .filter((entry) => entry.type === "output_text" || entry.type === "text")
    .map((entry) => entry.text ?? "")
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("OpenAI summary response did not include output text");
  }

  return text;
}

function parseSummaryJson(raw: string): Omit<MeetingSummary, "markdown"> {
  const normalized = raw.replace(/^```json\s*|\s*```$/g, "").trim();
  const parsed = JSON.parse(normalized) as Partial<Omit<MeetingSummary, "markdown">>;

  return {
    overview: parsed.overview?.trim() || "해당 없음",
    decisions: normalizeStringArray(parsed.decisions),
    actionItems: normalizeActionItems(parsed.actionItems),
    openQuestions: normalizeStringArray(parsed.openQuestions),
    risks: normalizeStringArray(parsed.risks),
  };
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeActionItems(value: unknown): MeetingSummary["actionItems"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const content = typeof entry.content === "string" ? entry.content.trim() : "";
      if (!content) {
        return null;
      }

      return {
        content,
        assignee: typeof entry.assignee === "string" && entry.assignee.trim() ? entry.assignee.trim() : null,
        dueDate: typeof entry.dueDate === "string" && entry.dueDate.trim() ? entry.dueDate.trim() : null,
      };
    })
    .filter((entry): entry is MeetingSummary["actionItems"][number] => Boolean(entry));
}

function buildMarkdown(summary: Omit<MeetingSummary, "markdown">): string {
  const sections = [
    `## 회의 개요\n- ${summary.overview || "해당 없음"}`,
    `## 결정사항\n${toBullets(summary.decisions)}`,
    `## 액션아이템\n${toActionBullets(summary.actionItems)}`,
    `## 논의되었으나 미결정 사항\n${toBullets(summary.openQuestions)}`,
    `## 주요 이슈 및 리스크\n${toBullets(summary.risks)}`,
  ];

  return sections.join("\n\n");
}

function toBullets(values: string[]): string {
  if (values.length === 0) {
    return "- 해당 없음";
  }
  return values.map((value) => `- ${value}`).join("\n");
}

function toActionBullets(values: MeetingSummary["actionItems"]): string {
  if (values.length === 0) {
    return "- 해당 없음";
  }

  return values
    .map((item) => {
      const assignee = item.assignee ?? "미정";
      const dueDate = item.dueDate ?? "미정";
      return `- ${item.content} / 담당: ${assignee} / 기한: ${dueDate}`;
    })
    .join("\n");
}

function getMimeType(fileName: string): string {
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

async function getOpenAiErrorMessage(response: Response): Promise<string> {
  const body = await response.text();

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) {
      return parsed.error.message;
    }
  } catch {
    // Ignore invalid JSON error bodies and fall back to the raw text.
  }

  return body.trim() || `${response.status} ${response.statusText}`;
}
