import { useState, useEffect, useMemo, memo } from "react";
import { Mic, MicOff, Square, FileAudio } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export interface RecordingControlProps {
  isRecording: boolean;
  isPaused: boolean;
  isProcessingFile: boolean;
  fileProcessProgress?: number | null;
  onToggleRecording: () => void;
  onStop: () => void;
  onFileUpload?: () => void;
}

function formatDuration(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export const RecordingControl = memo(function RecordingControl({
  isRecording,
  isPaused,
  isProcessingFile,
  fileProcessProgress,
  onToggleRecording,
  onStop,
  onFileUpload,
}: RecordingControlProps) {
  // Internal duration timer — only this component re-renders on tick
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (isRecording) {
      setDuration(0);
      const timer = setInterval(() => setDuration((prev) => prev + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [isRecording]);

  // Pre-compute random waveform parameters once on mount
  const waveformParams = useMemo(
    () =>
      Array.from({ length: 32 }, (_, i) => ({
        randomHeight: Math.random() * 16,
        randomDuration: 0.4 + Math.random() * 0.4,
        sinBase: Math.sin(i * 0.5) * 20,
      })),
    []
  );

  return (
    <div
      className="flex flex-col items-center gap-5 py-6"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* Waveform visualization */}
      <div className="flex items-center gap-[3px] h-12">
        {waveformParams.map((params, i) => {
          const active = isRecording || isProcessingFile;
          const baseHeight = active
            ? 8 + params.sinBase + params.randomHeight
            : 4;
          return (
            <motion.div
              key={i}
              className="w-[3px] rounded-full"
              style={{
                background: active
                  ? isProcessingFile
                    ? `linear-gradient(to top, #8b5cf6, #6366f1)`
                    : `linear-gradient(to top, #ef4444, #f97316)`
                  : "rgba(255,255,255,0.1)",
              }}
              animate={{
                height: active ? [baseHeight * 0.3, baseHeight, baseHeight * 0.5] : 4,
              }}
              transition={{
                duration: params.randomDuration,
                repeat: Infinity,
                repeatType: "reverse",
                ease: "easeInOut",
                delay: i * 0.03,
              }}
            />
          );
        })}
      </div>

      {/* Timer */}
      <div
        className="tabular-nums tracking-widest"
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "32px",
          color: isRecording
            ? "#f87171"
            : isProcessingFile
              ? "#a78bfa"
              : "rgba(255,255,255,0.3)",
        }}
      >
        {isProcessingFile
          ? `처리 중${fileProcessProgress != null ? `... ${fileProcessProgress}%` : '...'}`
          : formatDuration(duration)}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        {/* File upload button */}
        <motion.button
          onClick={onFileUpload}
          disabled={isRecording || isProcessingFile}
          className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/10 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          title="오디오 파일 가져오기"
        >
          <FileAudio size={18} />
        </motion.button>

        <AnimatePresence mode="wait">
          {isRecording && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={onStop}
              className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              <Square size={18} fill="currentColor" />
            </motion.button>
          )}
        </AnimatePresence>

        <button
          onClick={onToggleRecording}
          className="relative cursor-pointer"
          disabled={isProcessingFile}
        >
          {/* Pulse rings */}
          {isRecording && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full bg-red-500/20"
                animate={{ scale: [1, 1.8], opacity: [0.4, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "easeOut" }}
              />
              <motion.div
                className="absolute inset-0 rounded-full bg-red-500/15"
                animate={{ scale: [1, 2.2], opacity: [0.3, 0] }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeOut",
                  delay: 0.3,
                }}
              />
            </>
          )}
          <motion.div
            className="relative w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: isRecording
                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                : "linear-gradient(135deg, #3b82f6, #6366f1)",
              boxShadow: isRecording
                ? "0 0 30px rgba(239,68,68,0.4)"
                : "0 0 20px rgba(99,102,241,0.3)",
              opacity: isProcessingFile ? 0.4 : 1,
            }}
            whileHover={{ scale: isProcessingFile ? 1 : 1.05 }}
            whileTap={{ scale: isProcessingFile ? 1 : 0.95 }}
          >
            {isRecording ? (
              <MicOff size={24} className="text-white" />
            ) : (
              <Mic size={24} className="text-white" />
            )}
          </motion.div>
        </button>
      </div>

      <p
        className="text-white/30"
        style={{ fontSize: "12px", fontFamily: "'Inter', sans-serif" }}
      >
        {isProcessingFile
          ? "오디오 파일 처리 중..."
          : isRecording
            ? "녹음 중... 마이크 버튼을 눌러 중지"
            : "마이크 버튼을 눌러 녹음 시작 · 파일 아이콘으로 오디오 파일 가져오기"}
      </p>
    </div>
  );
});
