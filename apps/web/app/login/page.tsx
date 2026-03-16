"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText, Mail, Lock, ArrowRight } from "lucide-react";

export default function Login() {
  const router = useRouter();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Mock authentication
    if (isLogin) {
      router.push("/app");
    } else {
      // Go to onboarding for new users
      setTimeout(() => {
        router.push("/onboarding");
      }, 1500);
    }
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

      <div className="relative z-10 w-full max-w-md">
        {/* Logo */}
        <Link href="/" className="inline-flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center">
            <FileText className="w-6 h-6 text-[var(--graphite-950)]" />
          </div>
          <span className="text-2xl font-semibold">Brevoca</span>
        </Link>

        {/* Card */}
        <div className="p-8 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] shadow-2xl">
          {/* Tabs */}
          <div className="flex gap-1 mb-8 p-1 bg-[var(--graphite-800)] rounded-lg">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2 rounded-md transition-all ${
                isLogin
                  ? "bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              로그인
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2 rounded-md transition-all ${
                !isLogin
                  ? "bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)]"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              회원가입
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label className="block text-sm mb-2">회사/팀명</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="예: ABC 제조"
                  className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                  required={!isLogin}
                />
                <p className="text-xs text-[var(--text-secondary)] mt-1.5">
                  첫 워크스페이스로 생성됩니다
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm mb-2">이메일</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your@email.com"
                  className="w-full pl-11 pr-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm mb-2">비밀번호</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--text-secondary)]" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                  required
                />
              </div>
            </div>

            {isLogin && (
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-[var(--text-secondary)]">
                  <input
                    type="checkbox"
                    className="w-4 h-4 rounded border-[var(--line-soft)] bg-[var(--graphite-800)] checked:bg-[var(--mint-500)]"
                  />
                  로그인 유지
                </label>
                <button type="button" className="text-[var(--mint-500)] hover:underline">
                  비밀번호 찾기
                </button>
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity flex items-center justify-center gap-2 font-medium"
            >
              <span>{isLogin ? "로그인" : "시작하기"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 pt-6 border-t border-[var(--line-soft)] text-center text-sm text-[var(--text-secondary)]">
            {isLogin ? (
              <p>
                계정이 없으신가요?{" "}
                <button onClick={() => setIsLogin(false)} className="text-[var(--mint-500)] hover:underline">
                  회원가입
                </button>
              </p>
            ) : (
              <p>
                이미 계정이 있으신가요?{" "}
                <button onClick={() => setIsLogin(true)} className="text-[var(--mint-500)] hover:underline">
                  로그인
                </button>
              </p>
            )}
          </div>
        </div>

        {/* Back to Home */}
        <div className="mt-6 text-center">
          <Link href="/" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
            ← 홈으로 돌아가기
          </Link>
        </div>
      </div>
    </div>
  );
}
