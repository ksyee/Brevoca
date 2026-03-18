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
const TRANSCRIBE_MAX_DURATION_SEC = 1400; // OpenAI transcribe 모델 최대 길이 제한
const DEFAULT_CHUNK_DURATION_SEC = 300; // 5분 단위 분할 (작은 청크 + 높은 병렬도)
const PREPROCESS_BITRATE = "48k"; // 음성 전사에 충분한 비트레이트
const DEFAULT_TRANSCRIBE_CONCURRENCY = 4;
const DEFAULT_TRANSCRIBE_MODEL = "gpt-4o-transcribe";
const DEFAULT_SUMMARY_MODEL = "gpt-5-mini";
const OPENAI_TRANSCRIBE_RETRY_DELAYS_MS = [500, 1000, 2000];
const OPENAI_RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const DEFAULT_GLOBAL_TRANSCRIBE_CONCURRENCY = 8;

// ── 타이밍 유틸 ──

function timedStep<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  return fn().then(
    (result) => {
      console.log(`[brevoca:perf] ${label} — ${(performance.now() - start).toFixed(0)}ms`);
      return result;
    },
    (err) => {
      console.log(`[brevoca:perf] ${label} — FAILED ${(performance.now() - start).toFixed(0)}ms`);
      throw err;
    },
  );
}

// ── 글로벌 전사 세마포어 ──

const globalTranscribeSemaphore = createSemaphore(getGlobalTranscribeConcurrency());

function createSemaphore(max: number) {
  let running = 0;
  const queue: Array<() => void> = [];

  return {
    async acquire(): Promise<void> {
      if (running < max) {
        running += 1;
        return;
      }
      await new Promise<void>((resolve) => queue.push(resolve));
    },
    release(): void {
      running -= 1;
      const next = queue.shift();
      if (next) {
        running += 1;
        next();
      }
    },
  };
}

function getGlobalTranscribeConcurrency(): number {
  return getPositiveIntegerEnv("BREVOCA_GLOBAL_TRANSCRIBE_CONCURRENCY", DEFAULT_GLOBAL_TRANSCRIBE_CONCURRENCY);
}

const SUMMARY_JSON_SHAPE =
  '{"nextSteps":[{"content":string,"assignee":string|null,"dueDate":string|null}],"topics":[{"title":string,"points":[string]}]}';

type OpenAiOperation = "transcription" | "summary";

class OpenAiHttpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAiHttpError";
  }
}

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

export type TranscribeProgressCallback = (progress: number, message: string) => void | Promise<void>;

export async function transcribeAudioFile(options: {
  fileBuffer: Buffer;
  fileName: string;
  language: string;
  durationSec?: number | null;
  signal?: AbortSignal;
  onProgress?: TranscribeProgressCallback;
}): Promise<TranscriptionResult> {
  const totalStart = performance.now();
  const report = options.onProgress ?? (() => {});

  await report(16, "오디오 전처리 중 (무음 제거 + 인코딩)");
  const { buffer, fileName } = await timedStep("preprocess", () =>
    preprocessAudio(options.fileBuffer, options.fileName, options.signal),
  );
  await report(20, "전처리 완료");

  // 클라이언트가 전달한 durationSec가 있으면 FFmpeg probe를 건너뜀
  let durationSec: number;
  if (typeof options.durationSec === "number" && options.durationSec > 0) {
    durationSec = options.durationSec;
    console.log(`[brevoca:perf] duration-probe — skipped (client=${durationSec.toFixed(1)}s)`);
  } else {
    durationSec = await timedStep("duration-probe", () =>
      getAudioDurationSec(buffer, fileName, options.signal),
    );
  }

  const needsChunking =
    buffer.length > WHISPER_MAX_SIZE || durationSec > TRANSCRIBE_MAX_DURATION_SEC;

  let result: TranscriptionResult;
  if (!needsChunking) {
    await report(22, "OpenAI 전사 API 호출 중");
    result = await timedStep("transcribe-single", () =>
      transcribeSingleFile(buffer, fileName, options.language, options.signal),
    );
    await report(50, "전사 API 완료");
  } else {
    await report(22, "오디오 분할 준비 중");
    result = await timedStep("transcribe-chunked", () =>
      transcribeChunked(buffer, fileName, options.language, durationSec, options.onProgress, options.signal),
    );
  }

  console.log(`[brevoca:perf] transcribe-total — ${(performance.now() - totalStart).toFixed(0)}ms`);
  return result;
}

async function preprocessAudio(
  fileBuffer: Buffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<{ buffer: Buffer; fileName: string }> {
  const ffmpegPath = await getFFmpegPath();
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "brevoca-preprocess-"));

  try {
    const ext = path.extname(fileName) || ".webm";
    const inputPath = path.join(workDir, `input${ext}`);
    const outputPath = path.join(workDir, "preprocessed.ogg");
    await fs.writeFile(inputPath, fileBuffer);

    await execFileAsync(
      ffmpegPath,
      [
        "-i", inputPath,
        "-af", "silenceremove=start_periods=1:start_threshold=-35dB:stop_periods=-1:stop_duration=0.5:stop_threshold=-35dB",
        "-ac", "1",
        "-c:a", "libopus",
        "-b:a", PREPROCESS_BITRATE,
        "-vn",
        "-y",
        outputPath,
      ],
      signal ? { signal } : undefined,
    );

    const buffer = await fs.readFile(outputPath);
    return { buffer, fileName: "preprocessed.ogg" };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
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
  const includeDiarization = getBooleanEnv("BREVOCA_TRANSCRIBE_DIARIZATION", false);

  formData.append("model", model);
  formData.append("language", language);
  formData.append("file", blob, fileName);
  formData.append("response_format", includeDiarization ? "diarized_json" : "json");
  formData.append("chunking_strategy", "auto");

  const response = await fetchOpenAiWithRetry(
    "/audio/transcriptions",
    {
      method: "POST",
      headers: getOpenAiHeaders(),
      signal,
      body: formData,
    },
    {
      operation: "transcription",
      retryDelaysMs: OPENAI_TRANSCRIBE_RETRY_DELAYS_MS,
    },
  );

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
  totalDurationSec: number,
  onProgress?: TranscribeProgressCallback,
  signal?: AbortSignal,
): Promise<TranscriptionResult> {
  const report = onProgress ?? (() => {});
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "brevoca-chunk-"));

  try {
    const ext = path.extname(fileName) || ".webm";
    const inputPath = path.join(workDir, `input${ext}`);
    await fs.writeFile(inputPath, fileBuffer);

    const chunkDurationSec = getChunkDurationSec();
    const { paths: chunkPaths, offsets: chunkOffsets } = await timedStep("split-audio", () =>
      splitAudio(inputPath, workDir, ext, chunkDurationSec, totalDurationSec, signal),
    );

    await report(25, `오디오를 ${chunkPaths.length}개 청크로 분할 완료`);

    // 청크 전사: 25% → 50% 구간을 균등 분배
    const chunkProgressFn = (completedCount: number) => {
      const ratio = completedCount / chunkPaths.length;
      const progress = Math.round(25 + ratio * 25);
      return report(progress, `청크 전사 중 (${completedCount}/${chunkPaths.length})`);
    };

    const transcripts = await transcribeChunksInParallel(chunkPaths, language, chunkOffsets, chunkProgressFn, signal);

    await report(50, "모든 청크 전사 완료");
    return mergeTranscriptionResults(transcripts);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function transcribeChunksInParallel(
  chunkPaths: string[],
  language: string,
  chunkOffsets: number[],
  onChunkComplete?: (completedCount: number) => void | Promise<void>,
  signal?: AbortSignal,
): Promise<TranscriptionResult[]> {
  const transcripts = new Array<TranscriptionResult>(chunkPaths.length);
  let nextIndex = 0;
  let completedCount = 0;
  const concurrency = Math.min(getTranscribeConcurrency(), chunkPaths.length);

  console.log(`[brevoca:perf] transcribe-chunks — ${chunkPaths.length} chunks, concurrency=${concurrency}`);

  const workers = Array.from(
    { length: concurrency },
    async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= chunkPaths.length) {
          return;
        }

        await globalTranscribeSemaphore.acquire();
        try {
          const chunkPath = chunkPaths[currentIndex];
          const chunkBuffer = await fs.readFile(chunkPath);
          const chunkName = path.basename(chunkPath);
          const chunkResult = await timedStep(`transcribe-chunk[${currentIndex}]`, () =>
            transcribeSingleFile(chunkBuffer, chunkName, language, signal),
          );
          const chunkOffsetSec = chunkOffsets[currentIndex] ?? 0;
          transcripts[currentIndex] = {
            transcriptText: chunkResult.transcriptText,
            transcriptSegments: offsetTranscriptSegments(chunkResult.transcriptSegments, chunkOffsetSec),
            transcriptChunks: chunkResult.transcriptChunks,
          };
          completedCount += 1;
          await onChunkComplete?.(completedCount);
        } finally {
          globalTranscribeSemaphore.release();
        }
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

async function getAudioDurationSec(
  fileBuffer: Buffer,
  fileName: string,
  signal?: AbortSignal,
): Promise<number> {
  const workDir = await fs.mkdtemp(path.join(tmpdir(), "brevoca-duration-"));

  try {
    const ext = path.extname(fileName) || ".ogg";
    const inputPath = path.join(workDir, `input${ext}`);
    await fs.writeFile(inputPath, fileBuffer);
    return await getAudioDurationSecFromPath(inputPath, signal);
  } catch {
    return TRANSCRIBE_MAX_DURATION_SEC + 1;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function getAudioDurationSecFromPath(
  inputPath: string,
  signal?: AbortSignal,
): Promise<number> {
  const ffmpegPath = await getFFmpegPath();

  // ffprobe 없이 ffmpeg stderr 출력에서 Duration 파싱
  try {
    const { stderr } = await execFileAsync(
      ffmpegPath,
      ["-i", inputPath, "-hide_banner", "-f", "null", "-"],
      signal ? { signal } : undefined,
    );
    return parseDurationFromFfmpegOutput(String(stderr));
  } catch (err: unknown) {
    return parseDurationFromFfmpegOutput(String((err as { stderr?: unknown })?.stderr ?? ""));
  }
}

function parseDurationFromFfmpegOutput(output: string): number {
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) {
    return 0;
  }

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = parseFloat(match[3]);
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * 오디오에서 무음 구간을 감지하고, 목표 분할 지점(chunkDurationSec 배수) 근처의
 * 무음 구간 중앙점을 찾아 최적의 분할 시점 목록을 반환한다.
 */
async function findSilenceSplitPoints(
  inputPath: string,
  totalDurationSec: number,
  chunkDurationSec: number,
  signal?: AbortSignal,
): Promise<number[]> {
  const numChunks = Math.ceil(totalDurationSec / chunkDurationSec);
  if (numChunks <= 1) return [];

  const ffmpegPath = await getFFmpegPath();

  try {
    const { stderr } = await execFileAsync(
      ffmpegPath,
      [
        "-i", inputPath,
        "-af", "silencedetect=noise=-35dB:d=0.3",
        "-f", "null",
        "-",
      ],
      signal ? { signal } : undefined,
    );

    // stderr에서 silence_end, silence_duration 파싱
    const silences: Array<{ mid: number }> = [];
    const regex = /silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g;
    let match;
    while ((match = regex.exec(String(stderr))) !== null) {
      const end = parseFloat(match[1]);
      const dur = parseFloat(match[2]);
      silences.push({ mid: end - dur / 2 });
    }

    if (silences.length === 0) return [];

    // 각 목표 분할 지점에서 ±15% 범위 내 가장 가까운 무음 중앙점 선택
    const searchRadius = chunkDurationSec * 0.15;
    const splitPoints: number[] = [];

    for (let i = 1; i < numChunks; i++) {
      const target = i * chunkDurationSec;
      let bestPoint = -1;
      let bestDistance = Infinity;

      for (const silence of silences) {
        const distance = Math.abs(silence.mid - target);
        if (distance <= searchRadius && distance < bestDistance) {
          bestPoint = silence.mid;
          bestDistance = distance;
        }
      }

      splitPoints.push(bestPoint >= 0 ? bestPoint : target);
    }

    return splitPoints;
  } catch {
    // silencedetect 실패 시 빈 배열 반환 → 고정 간격 분할 fallback
    return [];
  }
}

async function splitAudio(
  inputPath: string,
  workDir: string,
  _ext: string,
  chunkDurationSec: number,
  totalDurationSec: number,
  signal?: AbortSignal,
): Promise<{ paths: string[]; offsets: number[] }> {
  const ffmpegPath = await getFFmpegPath();

  // 전처리 단계에서 이미 opus/ogg로 인코딩되어 있으므로 스트림 복사 사용
  const outExt = ".ogg";
  const outputPattern = path.join(workDir, `chunk_%03d${outExt}`);

  // 무음 기반 분할: BREVOCA_SILENCE_SPLIT=false로 끌 수 있음
  const useSilenceSplit = getBooleanEnv("BREVOCA_SILENCE_SPLIT", true);
  let silenceSplitPoints: number[] = [];
  if (useSilenceSplit) {
    silenceSplitPoints = await timedStep("silence-detect", () =>
      findSilenceSplitPoints(inputPath, totalDurationSec, chunkDurationSec, signal),
    );
  } else {
    console.log("[brevoca:perf] silence-detect — skipped (BREVOCA_SILENCE_SPLIT=false)");
  }

  const segmentArgs = silenceSplitPoints.length > 0
    ? ["-segment_times", silenceSplitPoints.map((t) => t.toFixed(3)).join(",")]
    : ["-segment_time", String(chunkDurationSec)];

  // 입력이 이미 opus/ogg이면 스트림 복사, 아니면 재인코딩
  const isAlreadyOpus = inputPath.endsWith(".ogg");
  const codecArgs = isAlreadyOpus
    ? ["-c:a", "copy"]
    : ["-c:a", "libopus", "-b:a", PREPROCESS_BITRATE];

  await execFileAsync(
    ffmpegPath,
    [
      "-i", inputPath,
      "-f", "segment",
      ...segmentArgs,
      ...codecArgs,
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

  // 각 청크의 시작 오프셋: [0, splitPoint1, splitPoint2, ...]
  const offsets = [0, ...silenceSplitPoints.length > 0
    ? silenceSplitPoints
    : Array.from({ length: chunkPaths.length - 1 }, (_, i) => (i + 1) * chunkDurationSec),
  ];

  return { paths: chunkPaths, offsets };
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
    .map((summary, index) => {
      const lines = [`Chunk ${index + 1}`];
      if (summary.nextSteps.length > 0) {
        lines.push(
          `NextSteps: ${summary.nextSteps.map((item) => `${item.content} / 담당: ${item.assignee ?? "미정"} / 기한: ${item.dueDate ?? "미정"}`).join(" | ")}`,
        );
      }
      for (const topic of summary.topics) {
        lines.push(`Topic [${topic.title}]: ${topic.points.join(" | ")}`);
      }
      return lines.join("\n");
    })
    .join("\n\n");

  const text = await requestSummaryText(
    [
      "Return strict JSON only.",
      `Use this JSON shape: ${SUMMARY_JSON_SHAPE}.`,
      "Do not wrap the JSON in markdown fences.",
      "You are merging structured chunk summaries from one meeting transcript.",
      "Merge topics with similar titles into a single topic, combining all their points.",
      "Preserve all unique points from each chunk — do not drop any information.",
      "Deduplicate only truly identical points.",
      "Keep nextSteps concrete and actionable. Leave unclear assignee or dueDate as null.",
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
  const response = await fetchOpenAiWithRetry(
    "/responses",
    {
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
    },
    {
      operation: "summary",
    },
  );

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
    "The transcript may contain ASR noise or duplicated fragments.",
    "Identify all distinct topics discussed and capture every opinion, decision, observation, and background context under the appropriate topic.",
    "Do not drop any discussion point — comprehensiveness is more important than brevity.",
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
    "The transcript may contain ASR noise, filler, and repeated phrases.",
    "Identify topics discussed in this chunk and capture all opinions, observations, and context.",
    "Do not drop any discussion point — comprehensiveness is more important than brevity.",
    "If a field is not applicable in this chunk, leave it as an empty array.",
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
    nextSteps: normalizeActionItems(parsed.nextSteps),
    topics: normalizeTopics(parsed.topics),
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

function normalizeTopics(value: unknown): MeetingSummary["topics"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const title = typeof entry.title === "string" ? entry.title.trim() : "";
      if (!title) {
        return null;
      }

      const points = normalizeStringArray(entry.points);
      if (points.length === 0) {
        return null;
      }

      return { title, points };
    })
    .filter((entry): entry is MeetingSummary["topics"][number] => Boolean(entry));
}

function normalizeActionItems(value: unknown): MeetingSummary["nextSteps"] {
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
    .filter((entry): entry is MeetingSummary["nextSteps"][number] => Boolean(entry));
}

function buildMarkdown(summary: Omit<MeetingSummary, "markdown">): string {
  const sections: string[] = [];

  if (summary.nextSteps.length > 0) {
    const items = summary.nextSteps
      .map((item) => {
        let line = `- [ ] ${item.content}`;
        if (item.assignee) line += ` / 담당: ${item.assignee}`;
        if (item.dueDate) line += ` / 기한: ${item.dueDate}`;
        return line;
      })
      .join("\n");
    sections.push(`### 주요 결정 사항 및 다음 단계\n\n${items}`);
  }

  for (const topic of summary.topics) {
    const points = topic.points.map((p) => `- ${p}`).join("\n");
    sections.push(`### ${topic.title}\n\n${points}`);
  }

  return sections.join("\n\n");
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

async function fetchOpenAiWithRetry(
  endpoint: string,
  init: RequestInit,
  options: {
    operation: OpenAiOperation;
    retryDelaysMs?: number[];
  },
): Promise<Response> {
  const retryDelaysMs = options.retryDelaysMs ?? [];

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const response = await fetch(`${OPENAI_BASE_URL}${endpoint}`, init);
      if (response.ok) {
        return response;
      }

      const detail = await getOpenAiErrorMessage(response);
      const isRetryable = OPENAI_RETRYABLE_STATUS_CODES.has(response.status);
      if (isRetryable && attempt < retryDelaysMs.length) {
        await sleep(retryDelaysMs[attempt], init.signal);
        continue;
      }

      throw new OpenAiHttpError(formatOpenAiHttpErrorMessage(options.operation, response.status, detail));
    } catch (error) {
      if (error instanceof OpenAiHttpError) {
        throw error;
      }

      if (isAbortError(error)) {
        throw error;
      }

      if (!isRetryableFetchError(error) || attempt >= retryDelaysMs.length) {
        throw new Error(formatOpenAiNetworkErrorMessage(options.operation, error));
      }

      await sleep(retryDelaysMs[attempt], init.signal);
    }
  }

  throw new Error(`${getOpenAiOperationLabel(options.operation)} 호출이 반복 실패했습니다.`);
}

function formatOpenAiHttpErrorMessage(
  operation: OpenAiOperation,
  status: number,
  detail: string,
): string {
  return `${getOpenAiOperationLabel(operation)} 호출이 HTTP ${status}로 실패했습니다: ${detail}`;
}

function formatOpenAiNetworkErrorMessage(operation: OpenAiOperation, error: unknown): string {
  const rawDetail = error instanceof Error ? error.message : String(error);
  const lower = rawDetail.toLowerCase();
  const label = getOpenAiOperationLabel(operation);

  if (lower.includes("fetch failed")) {
    return `${label} 호출 중 원격 API 연결에 실패했습니다.`;
  }

  if (lower.includes("econnreset")) {
    return `${label} 호출 중 연결이 재설정되었습니다.`;
  }

  if (lower.includes("socket hang up")) {
    return `${label} 호출 중 원격 서버가 연결을 종료했습니다.`;
  }

  if (lower.includes("timeout")) {
    return `${label} 호출이 시간 안에 완료되지 않았습니다.`;
  }

  if (lower.includes("network")) {
    return `${label} 호출 중 네트워크 오류가 발생했습니다: ${rawDetail}`;
  }

  return `${label} 호출 중 요청 전송에 실패했습니다: ${rawDetail}`;
}

function getOpenAiOperationLabel(operation: OpenAiOperation): string {
  return operation === "transcription" ? "OpenAI 전사 API" : "OpenAI 요약 API";
}

function isRetryableFetchError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("econnreset") ||
    message.includes("socket hang up") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable")
  );
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const handleAbort = () => {
      cleanup();
      reject(signal?.reason instanceof Error ? signal.reason : new Error("Request aborted"));
    };

    const cleanup = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", handleAbort);
    };

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
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
