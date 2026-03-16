import { Minus, Square, X } from "lucide-react";

export function TitleBar() {
  return (
    <div
      className="titlebar-drag flex items-center justify-between h-10 px-4 bg-[#0a0a0f]/90 backdrop-blur-xl border-b border-white/5 select-none shrink-0"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-white/90" />
        </div>
        <span className="text-white/70 tracking-wide" style={{ fontSize: '13px' }}>
          Brevoca
        </span>
        <span className="text-white/25 ml-1" style={{ fontSize: '11px' }}>v1.0.0</span>
      </div>
      <div className="titlebar-no-drag flex items-center">
        <button
          onClick={() => window.electronAPI?.minimize()}
          className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
        >
          <Minus size={14} />
        </button>
        <button
          onClick={() => window.electronAPI?.maximize()}
          className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white/70 hover:bg-white/5 transition-all"
        >
          <Square size={11} />
        </button>
        <button
          onClick={() => window.electronAPI?.close()}
          className="w-10 h-10 flex items-center justify-center text-white/40 hover:text-white hover:bg-red-500/80 transition-all rounded-tr-lg"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
