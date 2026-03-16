"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Sparkles, CheckCircle, ArrowRight, Upload } from "lucide-react";

type OnboardingStep = "welcome" | "workspace" | "complete";

export default function Onboarding() {
  const [plan, setPlan] = useState("");
  const router = useRouter();
  const [step, setStep] = useState<OnboardingStep>("welcome");
  const [workspaceName, setWorkspaceName] = useState("ABC 제조");

  const handleContinue = () => {
    if (step === "welcome") {
      setStep("workspace");
    } else if (step === "workspace") {
      setStep("complete");
      setTimeout(() => {
        router.push("/app");
      }, 2000);
    }
  };

  const handleSkip = () => {
    router.push("/app");
  };

  const handleComplete = () => {
    // Assuming toast is imported or globally available
    // toast.success("워크스페이스가 생성되었습니다.");
    router.push("/dashboard");
  };

  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Pattern */}
      <div 
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage: `radial-gradient(circle at 50% 50%, rgba(52, 211, 153, 0.05) 0%, transparent 50%),
                           linear-gradient(rgba(226, 232, 240, 0.02) 1px, transparent 1px),
                           linear-gradient(90deg, rgba(226, 232, 240, 0.02) 1px, transparent 1px)`,
          backgroundSize: '100% 100%, 40px 40px, 40px 40px'
        }}
      />

      <div className="relative z-10 w-full max-w-2xl">
        {/* Progress */}
        {step !== "complete" && (
          <div className="mb-8">
            <div className="flex items-center justify-center gap-2">
              <div
                className={`h-1.5 w-24 rounded-full transition-all ${
                  step === "welcome" ? "bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)]" : "bg-[var(--mint-500)]"
                }`}
              />
              <div
                className={`h-1.5 w-24 rounded-full transition-all ${
                  step === "workspace" ? "bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)]" : "bg-[var(--graphite-800)]"
                }`}
              />
            </div>
          </div>
        )}

        {/* Card */}
        <div className="p-12 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] shadow-2xl">
          {step === "welcome" && (
            <div className="text-center">
              <div className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center mx-auto mb-6">
                <FileText className="w-10 h-10 text-[var(--graphite-950)]" />
              </div>
              <h1 className="text-3xl font-bold mb-3">Brevoca에 오신 것을 환영합니다</h1>
              <p className="text-[var(--text-secondary)] text-lg mb-8">
                회의를 조용히 정리하는 관제실,<br />
                당신의 회의를 자동으로 분석하고 요약합니다
              </p>

              <div className="grid grid-cols-3 gap-4 mb-8">
                <div className="p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)]">
                  <Upload className="w-6 h-6 text-[var(--mint-500)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-secondary)]">오디오 업로드</p>
                </div>
                <div className="p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)]">
                  <Sparkles className="w-6 h-6 text-[var(--sky-500)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-secondary)]">AI 자동 처리</p>
                </div>
                <div className="p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)]">
                  <CheckCircle className="w-6 h-6 text-[var(--mint-500)] mx-auto mb-2" />
                  <p className="text-sm text-[var(--text-secondary)]">결과 확인</p>
                </div>
              </div>

              <button
                onClick={handleContinue}
                className="w-full py-4 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity flex items-center justify-center gap-2 font-medium text-lg"
              >
                <span>시작하기</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          )}

          {step === "workspace" && (
            <div>
              <div className="text-center mb-8">
                <h2 className="text-2xl font-bold mb-2">워크스페이스 설정</h2>
                <p className="text-[var(--text-secondary)]">
                  회의를 관리할 워크스페이스를 만들어보세요
                </p>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm mb-2">워크스페이스 이름</label>
                  <input
                    type="text"
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    placeholder="예: ABC 제조, 마케팅팀"
                    className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors text-lg"
                  />
                  <p className="text-sm text-[var(--text-secondary)] mt-2">
                    나중에 설정에서 변경할 수 있습니다
                  </p>
                </div>

                <div className="p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)]">
                  <h3 className="font-medium mb-2">워크스페이스에서 할 수 있는 일</h3>
                  <ul className="space-y-2 text-sm text-[var(--text-secondary)]">
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--mint-500)]" />
                      회의 녹음 파일 업로드 및 관리
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--sky-500)]" />
                      팀원 초대 및 협업
                    </li>
                    <li className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--mint-500)]" />
                      회의록 검색 및 아카이빙
                    </li>
                  </ul>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleSkip}
                    className="flex-1 py-3 rounded-[var(--radius-md)] border border-[var(--line-strong)] hover:bg-[var(--bg-surface-strong)] transition-colors"
                  >
                    건너뛰기
                  </button>
                  <button
                    onClick={handleContinue}
                    className="flex-1 py-3 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity flex items-center justify-center gap-2 font-medium"
                  >
                    <span>완료</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "complete" && (
            <div className="text-center py-8">
              <div className="w-20 h-20 rounded-full bg-[var(--mint-500)]/10 flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="w-10 h-10 text-[var(--mint-500)]" />
              </div>
              <h2 className="text-2xl font-bold mb-3">모든 준비가 완료되었습니다!</h2>
              <p className="text-[var(--text-secondary)] mb-4">
                이제 첫 회의를 업로드하고 Brevoca의 강력함을 경험해보세요
              </p>
              <div className="flex gap-1 justify-center">
                <div className="w-2 h-2 rounded-full bg-[var(--mint-500)] animate-pulse" />
                <div className="w-2 h-2 rounded-full bg-[var(--sky-500)] animate-pulse delay-75" />
                <div className="w-2 h-2 rounded-full bg-[var(--mint-500)] animate-pulse delay-150" />
              </div>
              <p className="text-sm text-[var(--text-secondary)] mt-4">대시보드로 이동 중...</p>
            </div>
          )}
        </div>

        {/* Skip button for welcome step */}
        {step === "welcome" && (
          <div className="mt-6 text-center">
            <button
              onClick={handleSkip}
              className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              건너뛰기
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
