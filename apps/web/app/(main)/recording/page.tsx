"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Mic, Pause, Play, Square, Trash2, Upload } from "lucide-react";
import {
  defaultPromptTemplateId,
  promptTemplateLabels,
  promptTemplateIds,
  type PromptTemplateId,
} from "@brevoca/contracts";
import { authedFetch } from "@/lib/client/authed-fetch";
import { toast } from "sonner";

type RecordingState = "idle" | "recording" | "paused" | "stopped";

export default function BrowserRecordingPage() {
  const router = useRouter();
  const [state, setState] = useState<RecordingState>("idle");
  const [duration, setDuration] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("ko");
  const [promptTemplateId, setPromptTemplateId] = useState<PromptTemplateId>(defaultPromptTemplateId);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => {
      clearTimer();
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      analyserRef.current = null;
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const recorder = new MediaRecorder(stream, { mimeType });

      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setRecordedBlob(blob);
      };

      recorder.start(500);
      streamRef.current = stream;
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      recorderRef.current = recorder;

      setDuration(0);
      setRecordedBlob(null);
      setState("recording");

      intervalRef.current = setInterval(() => {
        setDuration((current) => current + 1);
      }, 1000);

      const updateLevel = () => {
        if (!analyserRef.current || state === "stopped") {
          return;
        }

        const values = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(values);
        const average = values.reduce((sum, value) => sum + value, 0) / values.length;
        setAudioLevel(Math.min(100, (average / 128) * 100));
        requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (error) {
      console.error(error);
      toast.error("마이크 접근 권한이 필요합니다.");
    }
  };

  const pauseRecording = () => {
    recorderRef.current?.pause();
    setState("paused");
    clearTimer();
  };

  const resumeRecording = () => {
    recorderRef.current?.resume();
    setState("recording");
    intervalRef.current = setInterval(() => {
      setDuration((current) => current + 1);
    }, 1000);
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
    stopMediaResources();
    setState("stopped");
    setAudioLevel(0);
  };

  const discardRecording = () => {
    stopMediaResources();
    setState("idle");
    setDuration(0);
    setAudioLevel(0);
    setRecordedBlob(null);
  };

  const uploadRecording = async () => {
    if (!recordedBlob) {
      return;
    }

    const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
    if (recordedBlob.size > MAX_FILE_SIZE) {
      toast.error("녹음 파일이 너무 큽니다. 최대 100MB까지 업로드할 수 있습니다.");
      return;
    }

    setUploading(true);
    setUploadProgress(10);
    const progressTimer = window.setInterval(() => {
      setUploadProgress((current) => Math.min(current + 12, 90));
    }, 250);

    try {
      const file = new File([recordedBlob], `${buildFileName(title)}.webm`, {
        type: recordedBlob.type || "audio/webm",
      });
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title.trim() || "브라우저 녹음 회의");
      formData.append("language", language);
      formData.append("promptTemplateId", promptTemplateId);
      formData.append("sourceType", "browser_recording");
      formData.append("durationSec", String(duration));

      const response = await authedFetch("/api/meetings", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorMessage = await extractServerError(response);
        throw new Error(errorMessage);
      }

      const payload = (await response.json()) as { jobId: string };
      setUploadProgress(100);
      toast.success("브라우저 녹음을 업로드했습니다.");
      router.push(`/processing/${payload.jobId}`);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "녹음 업로드에 실패했습니다.";
      toast.error(message);
      setUploading(false);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold mb-2">브라우저 녹음</h1>
          <p className="text-[var(--text-secondary)]">마이크로 회의를 녹음하고 같은 파이프라인으로 바로 처리합니다.</p>
        </div>

        <div className="p-12 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] shadow-xl">
          <div className="flex items-center justify-center mb-8">
            <div
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm ${
                state === "recording"
                  ? "bg-[var(--danger-500)]/10 text-[var(--danger-500)]"
                  : state === "paused"
                  ? "bg-[var(--signal-orange-500)]/10 text-[var(--signal-orange-500)]"
                  : state === "stopped"
                  ? "bg-[var(--mint-500)]/10 text-[var(--mint-500)]"
                  : "bg-[var(--graphite-800)] text-[var(--text-secondary)]"
              }`}
            >
              {state === "recording" && (
                <>
                  <div className="w-2 h-2 rounded-full bg-[var(--danger-500)] animate-pulse" />
                  녹음 중
                </>
              )}
              {state === "paused" && (
                <>
                  <Pause className="w-4 h-4" />
                  일시정지
                </>
              )}
              {state === "stopped" && (
                <>
                  <Square className="w-4 h-4" />
                  녹음 완료
                </>
              )}
              {state === "idle" && "녹음 대기"}
            </div>
          </div>

          <div className="text-center mb-8">
            <div className="text-6xl font-mono font-bold mb-2">{formatDuration(duration)}</div>
            <div className="text-sm text-[var(--text-secondary)]">녹음 시간</div>
          </div>

          {state === "recording" && (
            <div className="mb-8">
              <div className="flex items-center justify-center gap-1 h-24">
                {Array.from({ length: 40 }).map((_, index) => {
                  const barHeight = Math.max(10, Math.sin((index / 40) * Math.PI) * audioLevel + Math.random() * 20);
                  return (
                    <div
                      key={index}
                      className="w-2 rounded-full transition-all duration-100"
                      style={{
                        height: `${barHeight}%`,
                        backgroundColor:
                          barHeight > 60
                            ? "var(--danger-500)"
                            : barHeight > 30
                            ? "var(--mint-500)"
                            : "var(--sky-500)",
                        opacity: 0.8,
                      }}
                    />
                  );
                })}
              </div>
              <div className="text-center text-sm text-[var(--text-secondary)] mt-2">실시간 오디오 레벨</div>
            </div>
          )}

          {!uploading && (
            <div className="flex items-center justify-center gap-4">
              {state === "idle" && (
                <button
                  onClick={() => {
                    void startRecording();
                  }}
                  className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-all flex items-center justify-center shadow-lg hover:scale-105"
                >
                  <Mic className="w-10 h-10" />
                </button>
              )}

              {state === "recording" && (
                <>
                  <button
                    onClick={pauseRecording}
                    className="w-16 h-16 rounded-full bg-[var(--graphite-800)] border border-[var(--line-strong)] hover:bg-[var(--graphite-700)] transition-all flex items-center justify-center"
                  >
                    <Pause className="w-6 h-6" />
                  </button>
                  <button
                    onClick={stopRecording}
                    className="w-20 h-20 rounded-full bg-[var(--danger-500)] text-white hover:opacity-90 transition-all flex items-center justify-center shadow-lg"
                  >
                    <Square className="w-8 h-8" />
                  </button>
                </>
              )}

              {state === "paused" && (
                <>
                  <button
                    onClick={resumeRecording}
                    className="w-16 h-16 rounded-full bg-[var(--mint-500)] text-[var(--graphite-950)] hover:opacity-90 transition-all flex items-center justify-center"
                  >
                    <Play className="w-6 h-6" />
                  </button>
                  <button
                    onClick={stopRecording}
                    className="w-16 h-16 rounded-full bg-[var(--danger-500)] text-white hover:opacity-90 transition-all flex items-center justify-center"
                  >
                    <Square className="w-6 h-6" />
                  </button>
                </>
              )}

              {state === "stopped" && (
                <>
                  <button
                    onClick={discardRecording}
                    className="px-6 py-3 rounded-[var(--radius-md)] border border-[var(--line-strong)] hover:bg-[var(--bg-surface-strong)] transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>삭제</span>
                  </button>
                  <button
                    onClick={() => {
                      void uploadRecording();
                    }}
                    className="px-8 py-3 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity flex items-center gap-2 font-medium"
                  >
                    <Upload className="w-5 h-5" />
                    <span>업로드 및 처리</span>
                  </button>
                </>
              )}
            </div>
          )}

          {uploading && (
            <div className="space-y-4">
              <div className="h-3 bg-[var(--graphite-800)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="text-center text-[var(--text-secondary)]">
                {uploadProgress < 100 ? `업로드 중... ${uploadProgress}%` : "업로드 완료! 처리 페이지로 이동합니다..."}
              </div>
            </div>
          )}
        </div>

        {state === "stopped" && (
          <div className="mt-8 p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] space-y-4">
            <div>
              <label className="block text-sm mb-2">회의 제목</label>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="예: 현장 이슈 공유"
                className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2">언어</label>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                </select>
              </div>

              <div>
                <label className="block text-sm mb-2">템플릿</label>
                <select
                  value={promptTemplateId}
                  onChange={(event) => setPromptTemplateId(event.target.value as PromptTemplateId)}
                  className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                >
                  {promptTemplateIds.map((id) => (
                    <option key={id} value={id}>
                      {promptTemplateLabels[id]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <h3 className="font-medium mb-3">녹음 팁</h3>
          <div className="space-y-2 text-sm text-[var(--text-secondary)]">
            <div className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--mint-500)]" />
              <span>조용한 환경에서 마이크와 가까운 거리에서 녹음하세요.</span>
            </div>
            <div className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--mint-500)]" />
              <span>브라우저 녹음도 업로드와 같은 OpenAI 전사/요약 파이프라인을 사용합니다.</span>
            </div>
            <div className="flex items-start gap-2">
              <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--mint-500)]" />
              <span>긴 회의는 안정적인 네트워크 상태에서 업로드하는 편이 좋습니다.</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  function stopMediaResources() {
    clearTimer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    analyserRef.current = null;
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }

  function clearTimer() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function buildFileName(title: string): string {
  const base = title.trim() || `recording-${new Date().toISOString().slice(0, 19)}`;
  return base.replace(/[^\w\-가-힣]+/g, "-");
}

async function extractServerError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (payload.error) {
      return payload.error;
    }
  } catch {
    // JSON 파싱 실패 시 텍스트로 fallback
  }

  return `녹음 업로드에 실패했습니다. (${response.status})`;
}
