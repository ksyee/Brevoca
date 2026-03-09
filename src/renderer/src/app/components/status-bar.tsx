import { Cpu, HardDrive, Mic, MicOff, Wifi, WifiOff } from "lucide-react";
import { motion } from "motion/react";

interface StatusBarProps {
  whisperStatus: "ready" | "loading" | "processing" | "inactive";
  ollamaStatus: "connected" | "disconnected";
  micStatus: "connected" | "disconnected";
  whisperModel: string;
  whisperEngine: string | null;
  whisperBackend: string | null;
  whisperGpuEnabled: boolean;
  whisperRuntimeReady: boolean;
  modelName: string;
}

export function StatusBar({
  whisperStatus,
  ollamaStatus,
  micStatus,
  whisperModel,
  whisperEngine,
  whisperBackend,
  whisperGpuEnabled,
  whisperRuntimeReady,
  modelName,
}: StatusBarProps) {
  const whisperColor =
    whisperStatus === "ready"
      ? "#22c55e"
      : whisperStatus === "processing"
        ? "#f59e0b"
        : whisperStatus === "loading"
          ? "#3b82f6"
          : "#6b7280";

  const whisperLabel =
    whisperStatus === "ready"
      ? "Whisper 준비"
      : whisperStatus === "processing"
        ? "변환 중..."
        : whisperStatus === "loading"
          ? "모델 로딩..."
          : "비활성";

  return (
    <div
      className="flex items-center justify-between px-4 h-7 shrink-0 border-t border-white/5"
      style={{
        background: "rgba(0,0,0,0.3)",
        fontFamily: "'Inter', sans-serif",
        fontSize: "11px",
      }}
    >
      <div className="flex items-center gap-4">
        {/* Whisper status */}
        <div className="flex items-center gap-1.5 text-white/40">
          <Cpu size={11} />
          <motion.div
            className="w-1.5 h-1.5 rounded-full"
            style={{ backgroundColor: whisperColor }}
            animate={
              whisperStatus === "processing"
                ? { opacity: [1, 0.4, 1] }
                : {}
            }
            transition={{ duration: 0.8, repeat: Infinity }}
          />
          <span>{whisperLabel}</span>
        </div>

        {/* Mic status */}
        <div className="flex items-center gap-1.5 text-white/40">
          {micStatus === "connected" ? (
            <Mic size={11} className="text-green-500/70" />
          ) : (
            <MicOff size={11} className="text-red-500/70" />
          )}
          <span>
            마이크 {micStatus === "connected" ? "연결됨" : "없음"}
          </span>
        </div>

        {/* Ollama status */}
        <div className="flex items-center gap-1.5 text-white/40">
          {ollamaStatus === "connected" ? (
            <Wifi size={11} className="text-green-500/70" />
          ) : (
            <WifiOff size={11} className="text-red-500/70" />
          )}
          <span>
            Ollama {ollamaStatus === "connected" ? "연결됨" : "연결 안됨"}
          </span>
        </div>

        {/* Model */}
        <div className="flex items-center gap-1.5 text-white/40">
          <HardDrive size={11} />
          <span>{modelName}</span>
        </div>
      </div>

      <div className="text-white/20">
        {whisperRuntimeReady && whisperEngine && whisperBackend
          ? `${whisperEngine} (${whisperModel}, ${whisperGpuEnabled ? `GPU ${whisperBackend}` : "CPU"}) + ${modelName}`
          : `Whisper 미초기화 (${whisperModel}) + ${modelName}`}
      </div>
    </div>
  );
}
