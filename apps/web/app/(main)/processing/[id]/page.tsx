'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle,
  ChevronRight,
  FileAudio,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type { JobRecord, ProcessingErrorType } from '@brevoca/contracts';
import { authedFetch } from '@/lib/client/authed-fetch';
import { ErrorState } from '@/components/ErrorState';

type StepId = 'upload' | 'transcribe' | 'summarize' | 'complete';

const steps = [
  { id: 'upload' as const, label: '업로드 완료', icon: CheckCircle },
  { id: 'transcribe' as const, label: '음성 전사 중', icon: FileAudio },
  { id: 'summarize' as const, label: '회의록 요약 중', icon: Sparkles },
  { id: 'complete' as const, label: '완료', icon: CheckCircle },
];

export default function ProcessingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [job, setJob] = useState<JobRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [canceling, setCanceling] = useState(false);

  useEffect(() => {
    let mounted = true;
    let timer: number | null = null;

    async function loadJob() {
      const response = await authedFetch(`/api/jobs/${id}`);
      if (!response.ok) {
        return;
      }

      const nextJob = (await response.json()) as JobRecord;
      if (!mounted) {
        return;
      }

      setJob(nextJob);
      setLoading(false);

      if (nextJob.status === 'completed') {
        router.replace(`/meeting/${nextJob.meetingId}`);
        return;
      }

      if (nextJob.status === 'queued' || nextJob.status === 'processing') {
        timer = window.setTimeout(() => {
          void loadJob();
        }, 2000);
      }
    }

    void loadJob();

    return () => {
      mounted = false;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [id, router]);

  const handleRetry = async () => {
    setRetrying(true);
    const response = await authedFetch(`/api/jobs/${id}/retry`, {
      method: 'POST',
    });
    if (response.ok) {
      const refreshed = await authedFetch(`/api/jobs/${id}`);
      if (refreshed.ok) {
        setJob((await refreshed.json()) as JobRecord);
      }
    }
    setRetrying(false);
  };

  const handleCancelAndDelete = async () => {
    if (!job) {
      return;
    }

    setCanceling(true);
    const response = await authedFetch(`/api/meetings/${job.meetingId}`, {
      method: 'DELETE',
    });
    setCanceling(false);

    if (response.ok) {
      router.replace('/dashboard');
    }
  };

  if (loading || !job) {
    return (
      <div className="p-6 lg:p-8">
        <div className="max-w-3xl mx-auto rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] p-12 flex items-center justify-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>처리 상태를 불러오는 중입니다...</span>
        </div>
      </div>
    );
  }

  const currentStep = getCurrentStep(job);
  const errorType = (job.errorType ?? 'provider_error') as ProcessingErrorType;

  return (
    <div className="p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center mx-auto mb-6">
            <Sparkles className="w-8 h-8 text-[var(--graphite-950)]" />
          </div>
          <h1 className="text-3xl font-bold mb-2">회의를 처리하고 있습니다</h1>
          <p className="text-[var(--text-secondary)]">
            AI가 전사와 회의록 요약을 순차적으로 생성하는 중입니다.
          </p>
        </div>

        {job.status === 'failed' && (
          <div className="mb-8">
            <ErrorState
              type={errorType}
              onRetry={() => {
                void handleRetry();
              }}
              onDismiss={() => router.push('/dashboard')}
            />
          </div>
        )}

        <div className="mb-8 p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-[var(--text-secondary)]">
              전체 진행률
            </span>
            <span className="text-sm font-mono text-[var(--mint-500)]">
              {job.progress}%
            </span>
          </div>
          <div className="h-3 bg-[var(--graphite-800)] rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${
                job.status === 'failed'
                  ? 'bg-[var(--danger-500)]'
                  : 'bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)]'
              }`}
              style={{ width: `${job.progress}%` }}
            />
          </div>
          <p className="text-sm text-[var(--text-secondary)] mt-3">
            {job.status === 'failed'
              ? job.errorMessage || '처리 중 오류가 발생했습니다.'
              : job.status === 'canceled'
                ? '처리가 중단되었습니다.'
                : job.status === 'completed'
                  ? '완료되었습니다. 결과 페이지로 이동합니다.'
                  : '처리가 완료되면 자동으로 결과 페이지로 이동합니다.'}
          </p>
        </div>

        {(job.status === 'queued' || job.status === 'processing') && (
          <div className="mb-8 flex justify-end">
            <button
              onClick={() => {
                void handleCancelAndDelete();
              }}
              disabled={canceling}
              className="inline-flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--danger-500)]/40 px-4 py-2 text-[var(--danger-500)] transition-colors hover:bg-[var(--danger-500)]/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {canceling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              <span>
                {canceling ? '중단 및 삭제 중...' : '처리 중단 후 삭제'}
              </span>
            </button>
          </div>
        )}

        <div className="mb-8 p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="space-y-4">
            {steps.map((step, index) => {
              const status = getStepStatus(currentStep, step.id, job.status);
              const Icon = step.icon;

              return (
                <div key={step.id}>
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                        status === 'complete'
                          ? 'bg-[var(--mint-500)]/10 text-[var(--mint-500)]'
                          : status === 'active'
                            ? 'bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)]'
                            : 'bg-[var(--graphite-800)] text-[var(--text-secondary)]'
                      }`}
                    >
                      {status === 'active' && job.status !== 'failed' ? (
                        <Loader2 className="w-6 h-6 animate-spin" />
                      ) : (
                        <Icon className="w-6 h-6" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium mb-1">{step.label}</div>
                      <div className="text-sm text-[var(--text-secondary)]">
                        {status === 'complete'
                          ? '완료'
                          : status === 'active'
                            ? '진행 중...'
                            : '대기 중'}
                      </div>
                    </div>
                  </div>
                  {index < steps.length - 1 && (
                    <div className="ml-6 my-2">
                      <div
                        className={`w-0.5 h-6 ${status === 'complete' ? 'bg-[var(--mint-500)]' : 'bg-[var(--graphite-800)]'}`}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">처리 로그</h3>
            {retrying && (
              <span className="text-sm text-[var(--text-secondary)]">
                재처리 요청 중...
              </span>
            )}
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto font-mono text-sm">
            {job.logs.map((log, index) => (
              <div
                key={`${log}-${index}`}
                className="flex items-start gap-2 text-[var(--text-secondary)]"
              >
                <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--mint-500)]" />
                <span>{log}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function getCurrentStep(job: JobRecord): StepId {
  if (job.status === 'completed') {
    return 'complete';
  }

  if (job.stage === 'summarize') {
    return 'summarize';
  }

  return 'transcribe';
}

function getStepStatus(
  currentStep: StepId,
  step: StepId,
  jobStatus: JobRecord['status'],
) {
  const order: StepId[] = ['upload', 'transcribe', 'summarize', 'complete'];
  const currentIndex = order.indexOf(currentStep);
  const stepIndex = order.indexOf(step);

  if (stepIndex === 0) {
    return 'complete';
  }

  if (
    (jobStatus === 'completed' || jobStatus === 'canceled') &&
    step === 'complete'
  ) {
    return 'complete';
  }

  if (stepIndex < currentIndex) {
    return 'complete';
  }

  if (stepIndex === currentIndex) {
    return 'active';
  }

  return 'pending';
}
