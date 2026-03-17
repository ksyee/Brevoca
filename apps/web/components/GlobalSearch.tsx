import { useState, useEffect, useRef } from "react";
import { Search, Clock, FileAudio } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const mockRecentSearches = [
  { id: "1", title: "제조라인 개선 회의", date: "2026-03-12" },
  { id: "2", title: "안전 점검 브리핑", date: "2026-03-12" },
  { id: "5", title: "품질 개선 TF 미팅", date: "2026-03-09" },
];

export function GlobalSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
      // Cmd/Ctrl+K to focus search
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        containerRef.current?.querySelector("input")?.focus();
        setIsOpen(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      setIsOpen(false);
      router.push(`/search?q=${encodeURIComponent(query)}`);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <form onSubmit={handleSearch}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
          <input
            type="text"
            placeholder="회의 검색... (⌘K)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setIsOpen(true)}
            className="w-48 lg:w-64 pl-9 pr-4 py-2 rounded-[var(--radius-md)] bg-[var(--bg-surface)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors text-sm placeholder:text-[var(--text-secondary)]"
          />
        </div>
      </form>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute top-full left-0 mt-2 w-80 rounded-[var(--radius-xl)] bg-[var(--bg-surface-strong)] border border-[var(--line-soft)] shadow-2xl z-20 overflow-hidden">
            {query ? (
              <div className="p-4">
                <div className="text-sm text-[var(--text-secondary)]">
                  &quot;{query}&quot; 검색 결과를 보려면 Enter를 누르세요
                </div>
              </div>
            ) : (
              <>
                <div className="p-3 border-b border-[var(--line-soft)]">
                  <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] px-2">
                    <Clock className="w-3 h-3" />
                    <span>최근 회의</span>
                  </div>
                </div>

                <div className="p-2 max-h-64 overflow-y-auto">
                  {mockRecentSearches.map((meeting) => (
                    <Link
                      key={meeting.id}
                      href={`/meeting/${meeting.id}`}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors"
                    >
                      <FileAudio className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm truncate">{meeting.title}</div>
                        <div className="text-xs text-[var(--text-secondary)]">{meeting.date}</div>
                      </div>
                    </Link>
                  ))}
                </div>

                <div className="p-2 border-t border-[var(--line-soft)]">
                  <Link
                    href="/search"
                    onClick={() => setIsOpen(false)}
                    className="block px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--bg-surface)] transition-colors text-sm text-center text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    전체 검색 보기
                  </Link>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
