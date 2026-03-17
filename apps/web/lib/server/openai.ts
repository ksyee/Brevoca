import "server-only";

import { execFile } from "child_process";
import { promises as fs } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import path from "path";
import { promisify } from "util";
import {
  defaultPromptTemplateId,
  promptTemplates,
  type MeetingSummary,
  type PromptTemplateId,
} from "@brevoca/contracts";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

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

const WHISPER_MAX_SIZE = 24 * 1024 * 1024; // 24MB (25MB 제한에 여유분)
const CHUNK_DURATION_SEC = 600; // 10분 단위 분할

export async function transcribeAudioFile(options: {
  fileBuffer: Buffer;
  fileName: string;
  language: string;
}): Promise<string> {
  if (options.fileBuffer.length <= WHISPER_MAX_SIZE) {
    return transcribeSingleFile(options.fileBuffer, options.fileName, options.language);
  }

  return transcribeChunked(options.fileBuffer, options.fileName, options.language);
}

async function transcribeSingleFile(
  fileBuffer: Buffer,
  fileName: string,
  language: string,
  prompt?: string,
): Promise<string> {
  const model = getRequiredEnv("BREVOCA_TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe");
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: getMimeType(fileName) });

  formData.append("model", model);
  formData.append("language", language);
  formData.append("file", blob, fileName);

  if (prompt) {
    formData.append("prompt", prompt);
  }

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

/** 이전 청크 전사 결과에서 마지막 ~200자를 prompt로 추출 */
function extractPromptFromPrevious(text: string): string {
  const tail = text.slice(-500);
  // 마지막 문장 경계("." "?" "!" 또는 한국어 종결) 이후를 잘라서 완전한 문장만 포함
  const lastSentenceEnd = Math.max(
    tail.lastIndexOf("."),
    tail.lastIndexOf("?"),
    tail.lastIndexOf("!"),
    tail.lastIndexOf("다."),
    tail.lastIndexOf("요."),
  );
  return lastSentenceEnd > 0 ? tail.slice(0, lastSentenceEnd + 1).trim() : tail.trim();
}

async function transcribeChunked(
  fileBuffer: Buffer,
  fileName: string,
  language: string,
): Promise<string> {
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "brevoca-chunk-"));

  try {
    const ext = path.extname(fileName) || ".webm";
    const inputPath = path.join(workDir, `input${ext}`);
    await fs.writeFile(inputPath, fileBuffer);

    const chunkPaths = await splitAudio(inputPath, workDir, ext);

    const transcripts: string[] = [];
    let previousPrompt: string | undefined;
    for (const chunkPath of chunkPaths) {
      const chunkBuffer = await fs.readFile(chunkPath);
      const chunkName = path.basename(chunkPath);
      const text = await transcribeSingleFile(chunkBuffer, chunkName, language, previousPrompt);
      transcripts.push(text);
      previousPrompt = extractPromptFromPrevious(text);
    }

    return transcripts.join("\n\n");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getFFmpegPath(): Promise<string> {
  const envPath = process.env.FFMPEG_PATH?.trim();
  if (envPath) {
    try {
      await fs.access(envPath);
      return envPath;
    } catch {
      throw new Error(`FFMPEG_PATH is configured but the binary was not found: ${envPath}`);
    }
  }

  const importedPath = await loadFfmpegStaticPath();
  if (importedPath) {
    return importedPath;
  }

  const resolvedPath = resolveFfmpegFromNodeModules();
  if (resolvedPath) {
    return resolvedPath;
  }

  throw new Error("ffmpeg 바이너리 경로를 찾을 수 없습니다. ffmpeg-static 또는 FFMPEG_PATH를 확인하세요.");
}

async function loadFfmpegStaticPath(): Promise<string | null> {
  try {
    const imported = await import("ffmpeg-static");
    const ffmpegPath = imported.default as unknown as string | null;
    if (!ffmpegPath) {
      return null;
    }

    await fs.access(ffmpegPath);
    return ffmpegPath;
  } catch {
    return null;
  }
}

function resolveFfmpegFromNodeModules(): string | null {
  try {
    const packageJsonPath = require.resolve("ffmpeg-static/package.json");
    const packageDir = path.dirname(packageJsonPath);
    const candidate = path.join(packageDir, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
    require("fs").accessSync(candidate);
    return candidate;
  } catch {
    return null;
  }
}

async function splitAudio(inputPath: string, workDir: string, _ext: string): Promise<string[]> {
  const ffmpegPath = await getFFmpegPath();

  // 항상 opus/ogg로 재인코딩하여 크기를 예측 가능하게 만듦
  // opus 96kbps ≈ 10분 → ~7.2MB (24MB 제한 안전)
  const outExt = ".ogg";
  const outputPattern = path.join(workDir, `chunk_%03d${outExt}`);

  await execFileAsync(ffmpegPath, [
    "-i", inputPath,
    "-f", "segment",
    "-segment_time", String(CHUNK_DURATION_SEC),
    "-c:a", "libopus",
    "-b:a", "96k",
    "-vn",
    "-reset_timestamps", "1",
    "-y",
    outputPattern,
  ]);

  const files = await fs.readdir(workDir);
  const chunkFiles = files
    .filter((f) => f.startsWith("chunk_") && f.endsWith(outExt))
    .sort();

  if (chunkFiles.length === 0) {
    throw new Error("오디오 분할에 실패했습니다. 청크가 생성되지 않았습니다.");
  }

  // 각 청크가 Whisper 제한을 넘지 않는지 검증
  const chunkPaths = chunkFiles.map((f) => path.join(workDir, f));
  for (const chunkPath of chunkPaths) {
    const stat = await fs.stat(chunkPath);
    if (stat.size > WHISPER_MAX_SIZE) {
      throw new Error(
        `청크 ${path.basename(chunkPath)} 크기(${Math.round(stat.size / 1024 / 1024)}MB)가 ` +
        `Whisper 제한(${Math.round(WHISPER_MAX_SIZE / 1024 / 1024)}MB)을 초과합니다.`
      );
    }
  }

  return chunkPaths;
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
