"use client";

import { useState, useEffect } from "react";
import { User, Settings, LogOut, HelpCircle, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppSession } from "@/components/AppSessionProvider";
import { toast } from "sonner";

export function ProfileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { user, signOut } = useAppSession();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen]);

  const handleLogout = async () => {
    setIsOpen(false);
    await signOut();
    toast.success("로그아웃 되었습니다.");
    router.push("/login");
  };

  const displayEmail = user?.email || "로그인이 필요합니다";
  const displayInitial = (user?.email?.[0] || "사").toUpperCase();

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center text-[var(--graphite-950)] text-sm font-semibold">
          {displayInitial}
        </div>
        <ChevronDown className={`w-4 h-4 text-[var(--text-secondary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full right-0 mt-2 w-56 rounded-[var(--radius-xl)] bg-[var(--bg-surface-strong)] border border-[var(--line-soft)] shadow-2xl z-20 overflow-hidden">
            <div className="p-3 border-b border-[var(--line-soft)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center text-[var(--graphite-950)] font-semibold">
                  {displayInitial}
                </div>
                <div>
                  <div className="text-sm font-medium">사용자</div>
                  <div className="text-xs text-[var(--text-secondary)]">{displayEmail}</div>
                </div>
              </div>
            </div>

            <div className="p-2">
              <Link
                href="/settings"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors text-sm"
              >
                <User className="w-4 h-4 text-[var(--text-secondary)]" />
                <span>프로필</span>
              </Link>

              <Link
                href="/settings"
                onClick={() => setIsOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors text-sm"
              >
                <Settings className="w-4 h-4 text-[var(--text-secondary)]" />
                <span>설정</span>
              </Link>

              <button className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors text-sm">
                <HelpCircle className="w-4 h-4 text-[var(--text-secondary)]" />
                <span>도움말</span>
              </button>
            </div>

            <div className="p-2 border-t border-[var(--line-soft)]">
              <button
                onClick={() => {
                  void handleLogout();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors text-sm text-[var(--danger-500)]"
              >
                <LogOut className="w-4 h-4" />
                <span>로그아웃</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
