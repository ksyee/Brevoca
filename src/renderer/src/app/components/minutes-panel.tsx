import { FileText, Copy, Download, RefreshCw, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { memo, useMemo } from "react";

interface MinutesPanelProps {
  content: string;
  isGenerating: boolean;
  hasTranscript: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onDownload: () => void;
}

export const MinutesPanel = memo(function MinutesPanel({
  content,
  isGenerating,
  hasTranscript,
  onGenerate,
  onCopy,
  onDownload,
}: MinutesPanelProps) {
  // Memoize parsed lines to avoid re-splitting on every render
  const parsedLines = useMemo(() => content.split("\n"), [content]);

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
          <FileText size={16} className="text-purple-400" />
          <span className="text-white/80" style={{ fontSize: "13px" }}>
            회의록
          </span>
          {isGenerating && (
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
            >
              <RefreshCw size={12} className="text-purple-400" />
            </motion.div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {content && (
            <>
              <button
                onClick={onCopy}
                className="p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/5 transition-all cursor-pointer"
                title="복사"
              >
                <Copy size={14} />
              </button>
              <button
                onClick={onDownload}
                className="p-1.5 rounded-lg text-white/20 hover:text-white/50 hover:bg-white/5 transition-all cursor-pointer"
                title="다운로드"
              >
                <Download size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        {!content && !isGenerating ? (
          <div className="flex flex-col items-center justify-center h-full gap-4">
            <div className="text-white/10">
              <FileText size={36} />
            </div>
            <p className="text-white/20 text-center" style={{ fontSize: "13px", lineHeight: "1.6" }}>
              녹음 종료 후 AI가 회의록을 자동 생성합니다
            </p>
            {hasTranscript && (
              <motion.button
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={onGenerate}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl cursor-pointer transition-all hover:brightness-110"
                style={{
                  background: "linear-gradient(135deg, #7c3aed, #6366f1)",
                  boxShadow: "0 0 20px rgba(124,58,237,0.3)",
                  fontSize: "13px",
                  color: "white",
                }}
              >
                <Sparkles size={14} />
                회의록 생성
              </motion.button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {isGenerating && !content && (
              <div className="flex items-center gap-2 text-purple-400 mb-4">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                  <RefreshCw size={14} />
                </motion.div>
                <span style={{ fontSize: "13px" }}>Ollama로 회의록 생성 중...</span>
              </div>
            )}
            <div
              className="text-white/70 whitespace-pre-wrap"
              style={{ fontSize: "13.5px", lineHeight: "1.8" }}
            >
              {parsedLines.map((line, i) => {
                if (line.startsWith("# ")) {
                  return (
                    <h2
                      key={i}
                      className="text-white/90 mt-4 mb-2 pb-1 border-b border-white/5"
                      style={{ fontSize: "16px" }}
                    >
                      {line.replace("# ", "")}
                    </h2>
                  );
                }
                if (line.startsWith("## ")) {
                  return (
                    <h3
                      key={i}
                      className="text-purple-300/80 mt-3 mb-1.5"
                      style={{ fontSize: "14px" }}
                    >
                      {line.replace("## ", "")}
                    </h3>
                  );
                }
                if (line.startsWith("- ")) {
                  return (
                    <div key={i} className="flex gap-2 ml-2 my-0.5">
                      <span className="text-purple-400/60 shrink-0">{'•'}</span>
                      <span>{line.replace("- ", "")}</span>
                    </div>
                  );
                }
                if (line.trim() === "") {
                  return <div key={i} className="h-2" />;
                }
                return <p key={i}>{line}</p>;
              })}
              {isGenerating && (
                <motion.span
                  className="inline-block w-[2px] h-4 bg-purple-400 ml-0.5 align-text-bottom"
                  animate={{ opacity: [1, 0] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
