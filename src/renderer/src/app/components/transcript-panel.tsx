import { Languages, Trash2 } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { useEffect, useRef, memo } from "react";

interface TranscriptEntry {
  id: number;
  time: string;
  text: string;
}

interface TranscriptPanelProps {
  entries: TranscriptEntry[];
  isRecording: boolean;
  onClear: () => void;
}

const TranscriptItem = memo(function TranscriptItem({ entry }: { entry: TranscriptEntry }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex gap-3 group"
    >
      <span
        className="text-white/20 shrink-0 pt-0.5 tabular-nums"
        style={{ fontSize: "11px", fontFamily: "'JetBrains Mono', monospace" }}
      >
        {entry.time}
      </span>
      <p className="text-white/70" style={{ fontSize: "13.5px", lineHeight: "1.6" }}>
        {entry.text}
      </p>
    </motion.div>
  );
});

export const TranscriptPanel = memo(function TranscriptPanel({
  entries,
  isRecording,
  onClear,
}: TranscriptPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div
      className="flex flex-col h-full rounded-2xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        backdropFilter: "blur(20px)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/5">
        <div className="flex items-center gap-2.5">
          <Languages size={16} className="text-blue-400" />
          <span className="text-white/80" style={{ fontSize: "13px" }}>
            실시간 자막
          </span>
          {isRecording && (
            <motion.div
              className="w-1.5 h-1.5 rounded-full bg-red-500"
              animate={{ opacity: [1, 0.3, 1] }}
              transition={{ duration: 1.2, repeat: Infinity }}
            />
          )}
        </div>
        <button
          onClick={onClear}
          className="p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/5 transition-all cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Content */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-3 space-y-2.5 scrollbar-thin">
        <AnimatePresence>
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-white/15 gap-2 py-12">
              <Languages size={32} />
              <span style={{ fontSize: "13px" }}>녹음을 시작하면 자막이 표시됩니다</span>
            </div>
          ) : (
            entries.map((entry) => (
              <TranscriptItem key={entry.id} entry={entry} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});
