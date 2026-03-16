"use client";

import Link from "next/link";
import { Upload, Zap, FileText, ArrowRight } from "lucide-react";
import { motion } from "motion/react";

export default function Landing() {
  return (
    <div className="min-h-screen bg-[var(--bg-canvas)] text-[var(--text-primary)] relative overflow-hidden">
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

      {/* Header */}
      <header className="relative z-10 border-b border-[var(--line-soft)] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center">
              <FileText className="w-5 h-5 text-[var(--graphite-950)]" />
            </div>
            <span className="text-xl font-semibold">Brevoca</span>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/login"
              className="px-4 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              로그인
            </Link>
            <Link
              href="/login"
              className="px-6 py-2 rounded-full bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
            >
              무료로 시작
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-24 pb-32 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--bg-surface)] border border-[var(--line-soft)] mb-8">
            <Zap className="w-4 h-4 text-[var(--mint-500)]" />
            <span className="text-sm text-[var(--text-secondary)]">회의 직후 바로 쓸 수 있는 결과물</span>
          </div>
        </motion.div>
        
        <motion.h1
          className="text-5xl lg:text-6xl font-bold mb-6 leading-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          회의를 조용히 정리하는
          <br />
          <span className="bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] bg-clip-text text-transparent">
            관제실
          </span>
        </motion.h1>
        
        <motion.p
          className="text-lg lg:text-xl text-[var(--text-secondary)] mb-12 max-w-2xl mx-auto"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
        >
          오디오를 업로드하면 Brevoca가 전사, 요약, 결정사항, 액션아이템을 자동으로 정리합니다.
          <br />
          제조/현장 회의에 특화된 실무 도구입니다.
        </motion.p>

        <motion.div
          className="flex items-center justify-center gap-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <Link
            href="/dashboard"
            className="group px-8 py-4 rounded-[var(--radius-lg)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity flex items-center gap-2"
          >
            무료로 시작
            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>
          <button className="px-8 py-4 rounded-[var(--radius-lg)] border border-[var(--line-strong)] text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors">
            샘플 결과 보기
          </button>
        </motion.div>
      </section>

      {/* 3-Step Process */}
      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-3 gap-8">
          <div className="p-8 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] backdrop-blur-sm">
            <div className="w-12 h-12 rounded-xl bg-[var(--mint-500)]/10 flex items-center justify-center mb-6">
              <Upload className="w-6 h-6 text-[var(--mint-500)]" />
            </div>
            <h3 className="text-xl mb-3">1. 업로드</h3>
            <p className="text-[var(--text-secondary)]">
              회의 오디오를 드래그 앤 드롭하거나 브라우저에서 바로 녹음하세요.
            </p>
          </div>

          <div className="p-8 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] backdrop-blur-sm">
            <div className="w-12 h-12 rounded-xl bg-[var(--sky-500)]/10 flex items-center justify-center mb-6">
              <Zap className="w-6 h-6 text-[var(--sky-500)]" />
            </div>
            <h3 className="text-xl mb-3">2. 처리</h3>
            <p className="text-[var(--text-secondary)]">
              AI가 전사, 화자 분리, 요약을 자동으로 수행합니다. 진행 상태를 실시간으로 확인하세요.
            </p>
          </div>

          <div className="p-8 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] backdrop-blur-sm">
            <div className="w-12 h-12 rounded-xl bg-[var(--signal-orange-500)]/10 flex items-center justify-center mb-6">
              <FileText className="w-6 h-6 text-[var(--signal-orange-500)]" />
            </div>
            <h3 className="text-xl mb-3">3. 결과 확인</h3>
            <p className="text-[var(--text-secondary)]">
              전사문, 요약, 결정사항, 액션아이템을 한 화면에서 확인하고 바로 공유하세요.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 max-w-4xl mx-auto px-6 pb-32 text-center">
        <div className="p-12 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] backdrop-blur-sm">
          <h2 className="text-3xl font-bold mb-4">지금 바로 시작하세요</h2>
          <p className="text-[var(--text-secondary)] mb-8">
            첫 회의 처리는 무료입니다. 신용카드 필요 없습니다.
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-[var(--radius-lg)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
          >
            무료로 시작
            <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[var(--line-soft)] backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center justify-between text-sm text-[var(--text-secondary)]">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span>Brevoca © 2026</span>
            </div>
            <div className="flex items-center gap-6">
              <a href="#" className="hover:text-[var(--text-primary)] transition-colors">문서</a>
              <a href="#" className="hover:text-[var(--text-primary)] transition-colors">지원</a>
              <a href="#" className="hover:text-[var(--text-primary)] transition-colors">개인정보처리방침</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}