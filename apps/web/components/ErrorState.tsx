import { AlertCircle, RefreshCw, ChevronRight, X } from "lucide-react";

export type ErrorType =
  | "upload_failed"
  | "transcription_failed"
  | "summary_failed"
  | "provider_error"
  | "timeout"
  | "network_error";

interface ErrorInfo {
  title: string;
  description: string;
  possibleCauses: string[];
  actions: {
    label: string;
    variant: "primary" | "secondary";
    onClick: () => void;
  }[];
}

interface ErrorStateProps {
  type: ErrorType;
  onRetry?: () => void;
  onDismiss?: () => void;
  onSupport?: () => void;
}

export function ErrorState({ type, onRetry, onDismiss, onSupport }: ErrorStateProps) {
  const errorConfig: Record<ErrorType, ErrorInfo> = {
    upload_failed: {
      title: "업로드 실패",
      description: "파일 업로드 중 오류가 발생했습니다.",
      possibleCauses: [
        "네트워크 연결이 불안정합니다",
        "파일 크기가 제한을 초과했습니다 (최대 500MB)",
        "지원하지 않는 파일 형식입니다",
      ],
      actions: [
        {
          label: "다시 시도",
          variant: "primary",
          onClick: onRetry || (() => {}),
        },
      ],
    },
    transcription_failed: {
      title: "전사 실패",
      description: "음성을 텍스트로 변환하는 중 오류가 발생했습니다.",
      possibleCauses: [
        "오디오 품질이 너무 낮습니다",
        "배경 소음이 너무 큽니다",
        "지원하지 않는 언어 또는 방언입니다",
      ],
      actions: [
        {
          label: "다시 처리",
          variant: "primary",
          onClick: onRetry || (() => {}),
        },
        {
          label: "지원팀 문의",
          variant: "secondary",
          onClick: onSupport || (() => {}),
        },
      ],
    },
    summary_failed: {
      title: "요약 생성 실패",
      description: "AI 요약 생성 중 오류가 발생했습니다.",
      possibleCauses: [
        "전사문이 너무 짧거나 길어서 처리할 수 없습니다",
        "내용이 AI 정책에 위배됩니다",
        "AI Provider 서비스가 일시적으로 중단되었습니다",
      ],
      actions: [
        {
          label: "다시 요약",
          variant: "primary",
          onClick: onRetry || (() => {}),
        },
        {
          label: "전사문만 보기",
          variant: "secondary",
          onClick: () => {
            // Navigate to transcript-only view
          },
        },
      ],
    },
    provider_error: {
      title: "AI Provider 연결 실패",
      description: "AI 서비스에 연결할 수 없습니다.",
      possibleCauses: [
        "API 키가 만료되었거나 유효하지 않습니다",
        "할당량(quota)을 초과했습니다",
        "Provider 서비스가 일시적으로 중단되었습니다",
      ],
      actions: [
        {
          label: "설정에서 API 키 확인",
          variant: "primary",
          onClick: () => {
            window.location.href = "/settings";
          },
        },
        {
          label: "다시 시도",
          variant: "secondary",
          onClick: onRetry || (() => {}),
        },
      ],
    },
    timeout: {
      title: "처리 시간 초과",
      description: "처리 시간이 예상보다 길어져 중단되었습니다.",
      possibleCauses: [
        "파일이 너무 큽니다 (권장: 2시간 이하)",
        "서버가 일시적으로 과부하 상태입니다",
      ],
      actions: [
        {
          label: "다시 시도",
          variant: "primary",
          onClick: onRetry || (() => {}),
        },
        {
          label: "파일을 분할하여 업로드",
          variant: "secondary",
          onClick: () => {},
        },
      ],
    },
    network_error: {
      title: "네트워크 오류",
      description: "인터넷 연결을 확인해주세요.",
      possibleCauses: [
        "인터넷 연결이 끊어졌습니다",
        "방화벽이나 보안 설정이 접속을 차단하고 있습니다",
      ],
      actions: [
        {
          label: "다시 시도",
          variant: "primary",
          onClick: onRetry || (() => {}),
        },
      ],
    },
  };

  const error = errorConfig[type];

  return (
    <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border-2 border-[var(--danger-500)]/20 relative">
      {/* Dismiss Button */}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-[var(--graphite-800)] transition-colors"
        >
          <X className="w-4 h-4 text-[var(--text-secondary)]" />
        </button>
      )}

      {/* Header */}
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-[var(--danger-500)]/10 flex items-center justify-center flex-shrink-0">
          <AlertCircle className="w-6 h-6 text-[var(--danger-500)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold mb-1 text-[var(--danger-500)]">{error.title}</h3>
          <p className="text-[var(--text-secondary)]">{error.description}</p>
        </div>
      </div>

      {/* Possible Causes */}
      <div className="mb-6 p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)]">
        <h4 className="text-sm font-medium mb-2 text-[var(--text-secondary)]">가능한 원인:</h4>
        <div className="space-y-1.5">
          {error.possibleCauses.map((cause, index) => (
            <div key={index} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
              <ChevronRight className="w-4 h-4 flex-shrink-0 mt-0.5 text-[var(--danger-500)]" />
              <span>{cause}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {error.actions.map((action, index) => (
          <button
            key={index}
            onClick={action.onClick}
            className={`flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] transition-all ${
              action.variant === "primary"
                ? "bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90"
                : "border border-[var(--line-strong)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface-strong)] hover:text-[var(--text-primary)]"
            }`}
          >
            {action.variant === "primary" && <RefreshCw className="w-4 h-4" />}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
