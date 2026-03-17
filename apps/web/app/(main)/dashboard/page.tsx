import Link from "next/link";
import { AlertCircle, ArrowRight, CheckCircle, Clock, FileAudio, Mic, Upload } from "lucide-react";
import { listMeetings } from "@/lib/server/store";

export const dynamic = "force-dynamic";

const statusConfig = {
  uploaded: { label: "업로드 완료", color: "var(--mist-300)", icon: FileAudio },
  transcribing: { label: "전사 중", color: "var(--sky-500)", icon: Clock },
  summarizing: { label: "요약 중", color: "var(--sky-500)", icon: Clock },
  completed: { label: "완료", color: "var(--mint-500)", icon: CheckCircle },
  failed: { label: "실패", color: "var(--danger-500)", icon: AlertCircle },
};

export default async function Dashboard() {
  const meetings = await listMeetings();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const todayMeetings = meetings.filter((meeting) => meeting.createdAt.startsWith(today)).length;
  const processingMeetings = meetings.filter(
    (meeting) => meeting.status === "transcribing" || meeting.status === "summarizing",
  ).length;
  const completedMeetings = meetings.filter((meeting) => meeting.status === "completed").length;

  const hour = now.getHours();
  const greeting = hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후에요" : "좋은 저녁이에요";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">{greeting}</h1>
        <p className="text-[var(--text-secondary)]">회의 업로드부터 회의록 정리까지 한 흐름으로 관리하세요.</p>
      </div>

      <div className="mb-8 grid md:grid-cols-2 gap-4">
        <Link
          href="/upload"
          className="group p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] hover:border-[var(--mint-500)] transition-all"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg mb-2">파일 업로드</h3>
              <p className="text-sm text-[var(--text-secondary)]">오디오 파일을 올리면 자동으로 전사와 요약을 시작합니다.</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-[var(--mint-500)]/10 flex items-center justify-center group-hover:bg-[var(--mint-500)]/20 transition-colors">
              <Upload className="w-6 h-6 text-[var(--mint-500)]" />
            </div>
          </div>
        </Link>

        <Link
          href="/recording"
          className="group p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] hover:border-[var(--sky-500)] transition-all"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg mb-2">브라우저 녹음</h3>
              <p className="text-sm text-[var(--text-secondary)]">브라우저에서 바로 녹음하고 같은 파이프라인으로 처리합니다.</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-[var(--sky-500)]/10 flex items-center justify-center group-hover:bg-[var(--sky-500)]/20 transition-colors">
              <Mic className="w-6 h-6 text-[var(--sky-500)]" />
            </div>
          </div>
        </Link>
      </div>

      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <KpiCard label="오늘 등록된 회의" value={todayMeetings} color="var(--mint-500)" />
        <KpiCard label="처리 중" value={processingMeetings} color="var(--sky-500)" />
        <KpiCard label="완료" value={completedMeetings} color="var(--signal-orange-500)" />
        <KpiCard label="총 회의" value={meetings.length} color="var(--text-primary)" />
      </div>

      <div className="rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] overflow-hidden">
        <div className="p-6 border-b border-[var(--line-soft)]">
          <h2 className="text-xl">최근 회의</h2>
        </div>

        {meetings.length > 0 ? (
          <div className="divide-y divide-[var(--line-soft)]">
            {meetings.map((meeting) => {
              const config = statusConfig[meeting.status];
              const Icon = config.icon;

              return (
                <Link
                  key={meeting.id}
                  href={
                    meeting.status === "completed" || meeting.status === "failed"
                      ? `/meeting/${meeting.id}`
                      : `/processing/${meeting.jobId}`
                  }
                  className="block p-6 hover:bg-[var(--bg-surface-strong)] transition-colors"
                >
                  <div className="flex items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg truncate">{meeting.title}</h3>
                        <div
                          className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs"
                          style={{
                            backgroundColor: `${config.color}15`,
                            color: config.color,
                          }}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span>{config.label}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--text-secondary)]">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4" />
                          <span>{formatDate(meeting.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <FileAudio className="w-4 h-4" />
                          <span className="font-mono">{formatDuration(meeting.durationSec)}</span>
                        </div>
                        <div className="px-2.5 py-1 rounded-full bg-[var(--graphite-800)] text-xs">
                          {meeting.sourceType === "browser_recording" ? "브라우저 녹음" : "파일 업로드"}
                        </div>
                      </div>
                    </div>

                    <ArrowRight className="w-5 h-5 text-[var(--text-secondary)] flex-shrink-0" />
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="p-12 text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--graphite-800)] flex items-center justify-center mx-auto mb-4">
              <FileAudio className="w-8 h-8 text-[var(--text-secondary)]" />
            </div>
            <h3 className="text-xl mb-2">아직 회의가 없습니다</h3>
            <p className="text-[var(--text-secondary)] mb-6">첫 녹취를 넣어보세요.</p>
            <Link
              href="/upload"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
            >
              <Upload className="w-4 h-4" />
              <span>파일 업로드</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
      <div className="text-sm text-[var(--text-secondary)] mb-2">{label}</div>
      <div className="text-3xl font-bold" style={{ color }}>
        {value}
      </div>
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
