"use client";

import type { ReactNode } from "react";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle,
  Clock,
  Download,
  FileAudio,
  Loader2,
  Share2,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import type { MeetingDetail } from "@brevoca/contracts";
import { TagEditor } from "@/components/TagEditor";

export default function MeetingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function loadMeeting() {
      const response = await fetch(`/api/meetings/${id}`, { cache: "no-store" });
      if (!response.ok) {
        setLoading(false);
        return;
      }

      const payload = (await response.json()) as MeetingDetail;
      if (!mounted) {
        return;
      }

      setMeeting(payload);
      setLoading(false);
    }

    void loadMeeting();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-4xl mx-auto rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] p-12 flex items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>회의를 불러오는 중입니다...</span>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-4xl mx-auto rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] p-12 text-center">
          <AlertCircle className="w-10 h-10 text-[var(--danger-500)] mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">회의를 찾을 수 없습니다</h1>
          <p className="text-[var(--text-secondary)] mb-6">삭제되었거나 아직 처리가 완료되지 않았을 수 있습니다.</p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
          >
            <ArrowLeft className="w-4 h-4" />
            대시보드로 돌아가기
          </Link>
        </div>
      </div>
    );
  }

  const handleShare = async () => {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    toast.success("공유 링크를 클립보드에 복사했습니다.");
  };

  const handleExport = () => {
    const markdown = meeting.summary?.markdown ?? meeting.transcriptText ?? "";
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${meeting.title}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success("Markdown 내보내기를 시작했습니다.");
  };

  return (
    <div className="min-h-full">
      <div className="border-b border-[var(--line-soft)] bg-[var(--bg-surface)]/50 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6">
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>대시보드로 돌아가기</span>
          </Link>

          <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 mb-4">
            <div className="flex-1">
              <h1 className="text-2xl lg:text-3xl font-bold mb-3">{meeting.title}</h1>
              <div className="flex flex-wrap items-center gap-4 lg:gap-6 text-[var(--text-secondary)]">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4" />
                  <span>{formatDate(meeting.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <FileAudio className="w-4 h-4" />
                  <span className="font-mono">{formatDuration(meeting.durationSec)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  <span>{meeting.sourceType === "browser_recording" ? "브라우저 녹음" : "파일 업로드"}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  void handleShare();
                }}
                className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] border border-[var(--line-strong)] hover:bg-[var(--bg-surface)] transition-colors"
              >
                <Share2 className="w-4 h-4" />
                <span className="hidden sm:inline">공유</span>
              </button>
              <button
                onClick={handleExport}
                className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">내보내기</span>
              </button>
            </div>
          </div>

          <TagEditor initialTags={meeting.tags} />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-8 grid lg:grid-cols-[1.1fr,0.9fr] gap-8">
        <section className="space-y-6">
          <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
            <h2 className="text-xl mb-4">회의록</h2>
            <article className="whitespace-pre-wrap text-[var(--text-secondary)] leading-relaxed">
              {meeting.summary?.markdown ?? "요약이 아직 생성되지 않았습니다."}
            </article>
          </div>

          <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
            <h2 className="text-xl mb-4">전사문</h2>
            <article className="whitespace-pre-wrap text-[var(--text-secondary)] leading-relaxed">
              {meeting.transcriptText ?? "전사문이 아직 생성되지 않았습니다."}
            </article>
          </div>
        </section>

        <aside className="space-y-6">
          <SummaryCard title="회의 개요">
            <p className="text-[var(--text-secondary)] leading-relaxed">
              {meeting.summary?.overview ?? "해당 없음"}
            </p>
          </SummaryCard>

          <SummaryCard title="결정사항">
            <BulletList items={meeting.summary?.decisions ?? []} icon="success" />
          </SummaryCard>

          <SummaryCard title="액션아이템">
            {meeting.summary?.actionItems?.length ? (
              <div className="space-y-3">
                {meeting.summary.actionItems.map((item, index) => (
                  <div
                    key={`${item.content}-${index}`}
                    className="p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)]"
                  >
                    <div className="font-medium mb-2">{item.content}</div>
                    <div className="text-sm text-[var(--text-secondary)]">
                      담당: {item.assignee ?? "미정"} / 기한: {item.dueDate ?? "미정"}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[var(--text-secondary)]">해당 없음</p>
            )}
          </SummaryCard>

          <SummaryCard title="미결정 사항">
            <BulletList items={meeting.summary?.openQuestions ?? []} icon="warning" />
          </SummaryCard>

          <SummaryCard title="리스크">
            <BulletList items={meeting.summary?.risks ?? []} icon="warning" />
          </SummaryCard>
        </aside>
      </div>
    </div>
  );
}

function SummaryCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
      <h2 className="text-xl mb-4">{title}</h2>
      {children}
    </div>
  );
}

function BulletList({
  items,
  icon,
}: {
  items: string[];
  icon: "success" | "warning";
}) {
  if (items.length === 0) {
    return <p className="text-[var(--text-secondary)]">해당 없음</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={`${item}-${index}`} className="flex items-start gap-3">
          {icon === "success" ? (
            <CheckCircle className="w-5 h-5 text-[var(--mint-500)] flex-shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-5 h-5 text-[var(--signal-orange-500)] flex-shrink-0 mt-0.5" />
          )}
          <p className="text-[var(--text-secondary)]">{item}</p>
        </div>
      ))}
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(durationSec: number | null): string {
  if (!durationSec || durationSec < 1) {
    return "--:--";
  }

  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
