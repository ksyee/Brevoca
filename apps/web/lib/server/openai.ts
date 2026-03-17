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
  type TranscriptSegment,
} from "@brevoca/contracts";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const WHISPER_MAX_SIZE = 24 * 1024 * 1024; // 24MB (25MB 제한에 여유분)
const DEFAULT_CHUNK_DURATION_SEC = 900; // 15분 단위 분할
const DEFAULT_TRANSCRIBE_CONCURRENCY = 4;
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe-diarize";
const DEFAULT_SUMMARY_MODEL = "gpt-5-mini";

const SUMMARY_JSON_SHAPE =
  '{"overview":string,"decisions":string[],"actionItems":[{"content":string,"assignee":string|null,"dueDate":string|null}],"openQuestions":string[],"risks":string[]}';

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

interface TranscriptionResult {
  transcriptText: string;
  transcriptSegments: TranscriptSegment[] | null;
  transcriptChunks: string[];
}

interface DiarizedSegmentPayload {
  speaker?: string | null;
  start?: number | null;
  end?: number | null;
  text?: string | null;
}

export async function transcribeAudioFile(options: {
  fileBuffer: Buffer;
  fileName: string;
  language: string;
  signal?: AbortSignal;
}): Promise<TranscriptionResult> {
  if (options.fileBuffer.length <= WHISPER_MAX_SIZE) {
    return transcribeSingleFile(options.fileBuffer, options.fileName, options.language, options.signal);
  }

  return transcribeChunked(options.fileBuffer, options.fileName, options.language, options.signal);
}

async function transcribeSingleFile(
  fileBuffer: Buffer,
  fileName: string,
  language: string,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const model = getRequiredEnv("BREVOCA_TRANSCRIBE_MODEL", DEFAULT_TRANSCRIBE_MODEL);
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(fileBuffer)], { type: getMimeType(fileName) });
  const includeDiarization = getBooleanEnv("BREVOCA_TRANSCRIBE_DIARIZATION", true);

  formData.append("model", model);
  formData.append("language", language);
  formData.append("file", blob, fileName);
  formData.append("response_format", includeDiarization ? "diarized_json" : "json");
  formData.append("chunking_strategy", "auto");

  const response = await fetch(`${OPENAI_BASE_URL}/audio/transcriptions`, {
    method: "POST",
    headers: getOpenAiHeaders(),
    signal,
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await getOpenAiErrorMessage(response));
  }

  const payload = (await response.json()) as {
    text?: string;
    segments?: DiarizedSegmentPayload[];
  };
  if (!payload.text && !payload.segments?.length) {
    throw new Error("OpenAI transcription response did not include text");
  }

  const transcriptSegments = normalizeTranscriptSegments(payload.segments, payload.text);
  return {
    transcriptText: formatTranscriptText(transcriptSegments, payload.text),
    transcriptSegments,
    transcriptChunks: [payload.text?.trim() || formatTranscriptText(transcriptSegments, payload.text)],
  };
}

async function transcribeChunked(
  fileBuffer: Buffer,
  fileName: string,
  language: string,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "brevoca-chunk-"));

  try {
    const ext = path.extname(fileName) || ".webm";
    const inputPath = path.join(workDir, `input${ext}`);
    await fs.writeFile(inputPath, fileBuffer);

    const chunkDurationSec = getChunkDurationSec();
    const chunkPaths = await splitAudio(inputPath, workDir, ext, chunkDurationSec, signal);

    const transcripts = await transcribeChunksInParallel(chunkPaths, language, chunkDurationSec, signal);

    return mergeTranscriptionResults(transcripts);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeChunksInParallel(
  chunkPaths: string[],
  language: string,
  chunkDurationSec: number,
  signal?: AbortSignal,
): Promise<TranscriptionResult[]> {
  const transcripts = new Array<TranscriptionResult>(chunkPaths.length);
  let nextIndex = 0;
  const concurrency = Math.min(getTranscribeConcurrency(), chunkPaths.length);

  const workers = Array.from(
    { length: concurrency },
    async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= chunkPaths.length) {
          return;
        }

        const chunkPath = chunkPaths[currentIndex];
        const chunkBuffer = await fs.readFile(chunkPath);
        const chunkName = path.basename(chunkPath);
        const chunkResult = await transcribeSingleFile(chunkBuffer, chunkName, language, signal);
        const chunkOffsetSec = currentIndex * chunkDurationSec;
        transcripts[currentIndex] = {
          transcriptText: chunkResult.transcriptText,
          transcriptSegments: offsetTranscriptSegments(chunkResult.transcriptSegments, chunkOffsetSec),
          transcriptChunks: chunkResult.transcriptChunks,
        };
      }
    },
  );

  await Promise.all(workers);

  return transcripts;
}

function offsetTranscriptSegments(
  segments: TranscriptSegment[] | null,
  chunkOffsetSec: number,
): TranscriptSegment[] | null {
  if (!segments?.length) {
    return segments;
  }

  return segments.map((segment) => ({
    ...segment,
    startSec: segment.startSec + chunkOffsetSec,
    endSec: segment.endSec + chunkOffsetSec,
  }));
}

function mergeTranscriptionResults(results: TranscriptionResult[]): TranscriptionResult {
  const allSegments = results.flatMap((result) => result.transcriptSegments ?? []);
  const transcriptChunks = results
    .flatMap((result) => result.transcriptChunks)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const transcriptText = formatTranscriptText(
    allSegments.length ? allSegments : null,
    results.map((result) => result.transcriptText).filter(Boolean).join("\n\n"),
  );

  return {
    transcriptText,
    transcriptSegments: allSegments.length ? allSegments : null,
    transcriptChunks,
  };
}

function normalizeTranscriptSegments(
  segments: DiarizedSegmentPayload[] | undefined,
  fallbackText?: string,
): TranscriptSegment[] | null {
  const normalized = (segments ?? [])
    .map((segment) => {
      const text = segment.text?.trim();
      if (!text) {
        return null;
      }

      return {
        speaker: segment.speaker?.trim() || null,
        startSec: typeof segment.start === "number" ? segment.start : 0,
        endSec: typeof segment.end === "number" ? segment.end : typeof segment.start === "number" ? segment.start : 0,
        text,
      } satisfies TranscriptSegment;
    })
    .filter((segment): segment is TranscriptSegment => segment !== null);

  if (normalized.length > 0) {
    return normalized;
  }

  const text = fallbackText?.trim();
  if (!text) {
    return null;
  }

  return [
    {
      speaker: null,
      startSec: 0,
      endSec: 0,
      text,
    },
  ];
}

function formatTranscriptText(
  segments: TranscriptSegment[] | null,
  fallbackText?: string,
): string {
  if (!segments?.length) {
    return fallbackText?.trim() || "";
  }

  const speakerLabels = new Map<string, string>();
  let speakerIndex = 0;

  return segments
    .map((segment) => {
      const text = segment.text.trim();
      if (!text) {
        return "";
      }

      const label = getSpeakerLabel(segment.speaker, speakerLabels, () => {
        speakerIndex += 1;
        return `화자 ${String.fromCharCode(64 + speakerIndex)}`;
      });

      return label ? `${label}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");
}

function getSpeakerLabel(
  speaker: string | null,
  labels: Map<string, string>,
  createLabel: () => string,
): string | null {
  if (!speaker) {
    return null;
  }

  const existing = labels.get(speaker);
  if (existing) {
    return existing;
  }

  const next = createLabel();
  labels.set(speaker, next);
  return next;
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

async function splitAudio(
  inputPath: string,
  workDir: string,
  _ext: string,
  chunkDurationSec: number,
  signal?: AbortSignal,
): Promise<string[]> {
  const ffmpegPath = await getFFmpegPath();

  // 항상 opus/ogg로 재인코딩하여 크기를 예측 가능하게 만듦
  // opus 96kbps ≈ 10분 → ~7.2MB (24MB 제한 안전)
  const outExt = ".ogg";
  const outputPattern = path.join(workDir, `chunk_%03d${outExt}`);

  await execFileAsync(
    ffmpegPath,
    [
      "-i", inputPath,
      "-f", "segment",
      "-segment_time", String(chunkDurationSec),
      "-c:a", "libopus",
      "-b:a", "96k",
      "-vn",
      "-reset_timestamps", "1",
      "-y",
      outputPattern,
    ],
    signal ? { signal } : undefined,
  );

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
  transcriptChunks?: string[];
  promptTemplateId: PromptTemplateId;
  signal?: AbortSignal;
}): Promise<MeetingSummary> {
  const promptTemplate = promptTemplates[options.promptTemplateId] ?? promptTemplates[defaultPromptTemplateId];
  const transcriptChunks = normalizeTranscriptChunks(options.transcriptChunks, options.transcriptText);

  if (transcriptChunks.length <= 1) {
    return summarizeFromText({
      title: options.title,
      language: options.language,
      promptTemplate,
      transcriptText: options.transcriptText,
      signal: options.signal,
    });
  }

  const chunkSummaries = await summarizeChunks(options.title, options.language, promptTemplate, transcriptChunks, options.signal);
  const summary = await mergeChunkSummaries(options.title, options.language, promptTemplate, chunkSummaries, options.signal);

  return {
    ...summary,
    markdown: buildMarkdown(summary),
  };
}

async function summarizeFromText(options: {
  title: string;
  language: string;
  promptTemplate: string;
  transcriptText: string;
  signal?: AbortSignal;
}): Promise<MeetingSummary> {
  const text = await requestSummaryText(
    buildTranscriptSummaryPrompt(
      options.title,
      options.language,
      options.promptTemplate,
      options.transcriptText,
    ),
    options.signal,
  );
  const summary = parseSummaryJson(text);

  return {
    ...summary,
    markdown: buildMarkdown(summary),
  };
}

async function summarizeChunks(
  title: string,
  language: string,
  promptTemplate: string,
  transcriptChunks: string[],
  signal?: AbortSignal,
): Promise<Array<Omit<MeetingSummary, "markdown">>> {
  const limit = Math.min(getSummaryChunkConcurrency(), transcriptChunks.length);
  const summaries = new Array<Omit<MeetingSummary, "markdown">>(transcriptChunks.length);
  let nextIndex = 0;

  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= transcriptChunks.length) {
        return;
      }

      const text = await requestSummaryText(
        buildChunkSummaryPrompt(title, language, promptTemplate, currentIndex + 1, transcriptChunks.length, transcriptChunks[currentIndex]),
        signal,
      );
      summaries[currentIndex] = parseSummaryJson(text);
    }
  });

  await Promise.all(workers);
  return summaries;
}

async function mergeChunkSummaries(
  title: string,
  language: string,
  promptTemplate: string,
  chunkSummaries: Array<Omit<MeetingSummary, "markdown">>,
  signal?: AbortSignal,
): Promise<Omit<MeetingSummary, "markdown">> {
  const chunkSummaryText = chunkSummaries
    .map((summary, index) =>
      [
        `Chunk ${index + 1}`,
        `Overview: ${summary.overview || "해당 없음"}`,
        `Decisions: ${summary.decisions.join(" | ") || "해당 없음"}`,
        `ActionItems: ${
          summary.actionItems.map((item) => `${item.content} / 담당: ${item.assignee ?? "미정"} / 기한: ${item.dueDate ?? "미정"}`).join(" | ") ||
          "해당 없음"
        }`,
        `OpenQuestions: ${summary.openQuestions.join(" | ") || "해당 없음"}`,
        `Risks: ${summary.risks.join(" | ") || "해당 없음"}`,
      ].join("\n"),
    )
    .join("\n\n");

  const text = await requestSummaryText(
    [
      "Return strict JSON only.",
      `Use this JSON shape: ${SUMMARY_JSON_SHAPE}.`,
      "Do not wrap the JSON in markdown fences.",
      "You are merging structured chunk summaries from one meeting transcript.",
      "Preserve only information that is supported by one or more chunk summaries.",
      "Deduplicate repeated points, keep only concrete decisions and action items, and leave unclear details as null or omit them.",
      "",
      "Meeting title:",
      title,
      "",
      "Language:",
      language,
      "",
      "Instructions:",
      promptTemplate.trim(),
      "",
      "Chunk summaries:",
      chunkSummaryText,
    ].join("\n"),
    signal,
  );

  return parseSummaryJson(text);
}

async function requestSummaryText(input: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${OPENAI_BASE_URL}/responses`, {
    method: "POST",
    headers: {
      ...getOpenAiHeaders(),
      "Content-Type": "application/json",
    },
    signal,
    body: JSON.stringify({
      model: getRequiredEnv("BREVOCA_SUMMARY_MODEL", DEFAULT_SUMMARY_MODEL),
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(await getOpenAiErrorMessage(response));
  }

  const payload = (await response.json()) as {
    output_text?: string;
    output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  };

  return extractResponseText(payload);
}

function buildTranscriptSummaryPrompt(
  title: string,
  language: string,
  promptTemplate: string,
  transcriptText: string,
): string {
  return [
    "Return strict JSON only.",
    `Use this JSON shape: ${SUMMARY_JSON_SHAPE}.`,
    "Do not wrap the JSON in markdown fences.",
    "The transcript may contain ASR noise or duplicated fragments. Focus on stable agenda, decisions, follow-ups, unresolved questions, and risks.",
    "Do not invent facts that are not supported by the transcript.",
    "",
    "Meeting title:",
    title,
    "",
    "Language:",
    language,
    "",
    "Instructions:",
    promptTemplate.trim(),
    "",
    "Transcript:",
    transcriptText,
  ].join("\n");
}

function buildChunkSummaryPrompt(
  title: string,
  language: string,
  promptTemplate: string,
  chunkIndex: number,
  totalChunks: number,
  transcriptText: string,
): string {
  return [
    "Return strict JSON only.",
    `Use this JSON shape: ${SUMMARY_JSON_SHAPE}.`,
    "Do not wrap the JSON in markdown fences.",
    "You are summarizing one chunk of a longer meeting transcript.",
    "The transcript may contain ASR noise, filler, and repeated phrases. Extract only stable information that would help create the final meeting minutes.",
    "If a field is not supported in this chunk, leave it empty.",
    "",
    "Meeting title:",
    title,
    "",
    "Language:",
    language,
    "",
    "Chunk:",
    `${chunkIndex} / ${totalChunks}`,
    "",
    "Instructions:",
    promptTemplate.trim(),
    "",
    "Transcript chunk:",
    transcriptText,
  ].join("\n");
}

function normalizeTranscriptChunks(transcriptChunks: string[] | undefined, transcriptText: string): string[] {
  const normalized = (transcriptChunks ?? []).map((chunk) => chunk.trim()).filter(Boolean);
  if (normalized.length > 0) {
    return normalized;
  }

  const fallback = transcriptText.trim();
  return fallback ? [fallback] : [];
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

function getChunkDurationSec(): number {
  return getPositiveIntegerEnv("BREVOCA_TRANSCRIBE_CHUNK_DURATION_SEC", DEFAULT_CHUNK_DURATION_SEC);
}

function getTranscribeConcurrency(): number {
  return getPositiveIntegerEnv("BREVOCA_TRANSCRIBE_CONCURRENCY", DEFAULT_TRANSCRIBE_CONCURRENCY);
}

function getSummaryChunkConcurrency(): number {
  return getPositiveIntegerEnv("BREVOCA_SUMMARY_CHUNK_CONCURRENCY", DEFAULT_TRANSCRIBE_CONCURRENCY);
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function getBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(raw)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(raw)) {
    return false;
  }

  return fallback;
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
