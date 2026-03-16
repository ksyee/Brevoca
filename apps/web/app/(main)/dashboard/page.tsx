import Link from "next/link";
import { FileAudio, Clock, CheckCircle, AlertCircle, ArrowRight, Upload, Mic } from "lucide-react";

// Mock data
const mockMeetings = [
  {
    id: "1",
    title: "제조라인 개선 회의",
    date: "2026-03-12 14:30",
    status: "completed",
    duration: "45:30",
    actionItems: 5,
  },
  {
    id: "2",
    title: "안전 점검 브리핑",
    date: "2026-03-12 10:00",
    status: "processing",
    duration: "32:15",
    progress: 65,
  },
  {
    id: "3",
    title: "주간 생산 계획 회의",
    date: "2026-03-11 16:00",
    status: "completed",
    duration: "58:42",
    actionItems: 8,
  },
  {
    id: "4",
    title: "설비 유지보수 검토",
    date: "2026-03-10 09:30",
    status: "failed",
    duration: "25:18",
    error: "전사 실패",
  },
];

const statusConfig = {
  completed: { label: "완료", color: "var(--mint-500)", icon: CheckCircle },
  processing: { label: "처리 중", color: "var(--sky-500)", icon: Clock },
  failed: { label: "실패", color: "var(--danger-500)", icon: AlertCircle },
};

export default function Dashboard() {
  const todayMeetings = mockMeetings.filter(m => m.date.startsWith("2026-03-12")).length;
  const processingMeetings = mockMeetings.filter(m => m.status === "processing").length;
  const totalActionItems = mockMeetings
    .filter(m => m.actionItems)
    .reduce((sum, m) => sum + (m.actionItems || 0), 0);

  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? "좋은 아침이에요" : hour < 18 ? "좋은 오후에요" : "좋은 저녁이에요";

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-1">{greeting} 👋</h1>
        <p className="text-[var(--text-secondary)]">오늘의 회의 현황을 확인하세요.</p>
      </div>

      {/* Quick Actions */}
      <div className="mb-8 grid md:grid-cols-2 gap-4">
        <Link
          href="/upload"
          className="group p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] hover:border-[var(--mint-500)] transition-all"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg mb-2">파일 업로드</h3>
              <p className="text-sm text-[var(--text-secondary)]">오디오를 놓으면 Brevoca가 회의를 정리합니다</p>
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
              <p className="text-sm text-[var(--text-secondary)]">바로 녹음을 시작하고 자동으로 처리합니다</p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-[var(--sky-500)]/10 flex items-center justify-center group-hover:bg-[var(--sky-500)]/20 transition-colors">
              <Mic className="w-6 h-6 text-[var(--sky-500)]" />
            </div>
          </div>
        </Link>
      </div>

      {/* KPI Cards */}
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="text-sm text-[var(--text-secondary)] mb-2">오늘 처리된 회의</div>
          <div className="text-3xl font-bold text-[var(--mint-500)]">{todayMeetings}</div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="text-sm text-[var(--text-secondary)] mb-2">처리 중</div>
          <div className="text-3xl font-bold text-[var(--sky-500)]">{processingMeetings}</div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="text-sm text-[var(--text-secondary)] mb-2">액션아이템</div>
          <div className="text-3xl font-bold text-[var(--signal-orange-500)]">{totalActionItems}</div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="text-sm text-[var(--text-secondary)] mb-2">총 회의</div>
          <div className="text-3xl font-bold">{mockMeetings.length}</div>
        </div>
      </div>

      {/* Recent Meetings */}
      <div className="rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] overflow-hidden">
        <div className="p-6 border-b border-[var(--line-soft)]">
          <h2 className="text-xl">최근 회의</h2>
        </div>

        <div className="divide-y divide-[var(--line-soft)]">
          {mockMeetings.map((meeting) => {
            const config = statusConfig[meeting.status as keyof typeof statusConfig];
            const Icon = config.icon;

            return (
              <Link
                key={meeting.id}
                href={`/meeting/${meeting.id}`}
                className="block p-6 hover:bg-[var(--bg-surface-strong)] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg">{meeting.title}</h3>
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

                    <div className="flex items-center gap-6 text-sm text-[var(--text-secondary)]">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-4 h-4" />
                        <span>{meeting.date}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <FileAudio className="w-4 h-4" />
                        <span className="font-mono">{meeting.duration}</span>
                      </div>
                      {meeting.actionItems && (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle className="w-4 h-4" />
                          <span>액션아이템 {meeting.actionItems}개</span>
                        </div>
                      )}
                    </div>

                    {meeting.status === "processing" && meeting.progress && (
                      <div className="mt-3">
                        <div className="h-1.5 bg-[var(--graphite-800)] rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] transition-all duration-300"
                            style={{ width: `${meeting.progress}%` }}
                          />
                        </div>
                        <div className="text-xs text-[var(--text-secondary)] mt-1.5">
                          요약 생성 중... {meeting.progress}%
                        </div>
                      </div>
                    )}

                    {meeting.status === "failed" && (
                      <div className="mt-2 text-sm text-[var(--danger-500)]">
                        {meeting.error} · 다시 시도하려면 클릭하세요
                      </div>
                    )}
                  </div>

                  <ArrowRight className="w-5 h-5 text-[var(--text-secondary)] ml-4" />
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Empty State (shown when no meetings) */}
      {mockMeetings.length === 0 && (
        <div className="rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] p-12 text-center">
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
  );
}