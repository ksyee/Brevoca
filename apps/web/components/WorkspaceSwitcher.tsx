"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Check, Plus } from "lucide-react";
import { useAppSession } from "@/components/AppSessionProvider";
import { toast } from "sonner";

export function WorkspaceSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { workspaces, currentWorkspace, createWorkspace, selectWorkspace } = useAppSession();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isCreating) {
          setIsCreating(false);
          setNewName("");
        } else {
          setIsOpen(false);
        }
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, isCreating]);

  useEffect(() => {
    if (isCreating && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating]);

  const handleSelect = async (workspaceId: string) => {
    await selectWorkspace(workspaceId);
    setIsOpen(false);
    setIsCreating(false);
    setNewName("");
  };

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    try {
      await createWorkspace(trimmed);
      setIsCreating(false);
      setNewName("");
      setIsOpen(false);
      toast.success(`"${trimmed}" 워크스페이스가 생성되었습니다`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "워크스페이스 생성에 실패했습니다.");
    }
  };

  const handleCreateKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    }
  };

  if (!currentWorkspace) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
        <div className="w-6 h-6 rounded-md bg-[var(--graphite-800)]" />
        <span className="text-sm text-[var(--text-secondary)]">워크스페이스 로딩 중</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--line-soft)] hover:border-[var(--line-strong)] transition-colors"
      >
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center text-[var(--graphite-950)] text-xs font-semibold">
          {currentWorkspace.name[0]}
        </div>
        <span className="text-sm max-w-[120px] truncate">{currentWorkspace.name}</span>
        <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 w-72 rounded-[var(--radius-lg)] bg-[var(--graphite-900)] border border-[var(--line-strong)] shadow-[0_16px_48px_rgba(0,0,0,0.5)] z-20 backdrop-blur-xl">
            <div className="px-4 pt-4 pb-2">
              <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wider">
                워크스페이스
              </div>
            </div>

            <div className="px-2 pb-2 max-h-64 overflow-y-auto">
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  onClick={() => {
                    void handleSelect(workspace.id);
                  }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)] transition-colors ${
                    currentWorkspace.id === workspace.id
                      ? "bg-[var(--graphite-800)]"
                      : "hover:bg-[var(--graphite-800)]/60"
                  }`}
                >
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center text-[var(--graphite-950)] text-sm font-semibold flex-shrink-0">
                    {workspace.name[0]}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm truncate">{workspace.name}</div>
                    <div className="text-xs text-[var(--text-secondary)]">{workspace.role === "owner" ? "관리자" : "멤버"}</div>
                  </div>
                  {currentWorkspace.id === workspace.id && (
                    <Check className="w-4 h-4 text-[var(--mint-500)] flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>

            <div className="px-2 pb-2 pt-1 border-t border-[var(--line-soft)] mx-2">
              {isCreating ? (
                <div className="pt-2 space-y-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={handleCreateKeyDown}
                    placeholder="워크스페이스 이름 입력"
                    className="w-full bg-[var(--graphite-950)] border border-[var(--line-soft)] rounded-[var(--radius-sm)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/60 focus:outline-none focus:border-[var(--mint-500)] focus:ring-1 focus:ring-[var(--mint-500)]/20 transition-all"
                    maxLength={30}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setIsCreating(false); setNewName(""); }}
                      className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] text-sm text-[var(--text-secondary)] hover:bg-[var(--graphite-800)] transition-colors"
                    >
                      취소
                    </button>
                    <button
                      onClick={() => {
                        void handleCreate();
                      }}
                      disabled={!newName.trim()}
                      className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--mint-500)] text-[var(--graphite-950)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      생성
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 mt-1 rounded-[var(--radius-sm)] border border-dashed border-[var(--line-soft)] hover:border-[var(--mint-500)]/40 hover:bg-[var(--mint-500)]/5 transition-all text-[var(--text-secondary)] hover:text-[var(--mint-400)] group"
                >
                  <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" />
                  <span className="text-sm">새 워크스페이스</span>
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
