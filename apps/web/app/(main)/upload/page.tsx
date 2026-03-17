"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, FileAudio, Tag as TagIcon, Upload as UploadIcon, X } from "lucide-react";
import {
  defaultPromptTemplateId,
  promptTemplateLabels,
  promptTemplateIds,
  type PromptTemplateId,
} from "@brevoca/contracts";
import { toast } from "sonner";

export default function UploadPage() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [title, setTitle] = useState("");
  const [language, setLanguage] = useState("ko");
  const [promptTemplateId, setPromptTemplateId] = useState<PromptTemplateId>(defaultPromptTemplateId);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const resolvedTitle = useMemo(() => {
    if (title.trim()) {
      return title.trim();
    }
    if (!selectedFile) {
      return "";
    }
    return selectedFile.name.replace(/\.[^.]+$/, "");
  }, [selectedFile, title]);

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      await applySelectedFile(file);
    }
  };

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      await applySelectedFile(file);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      return;
    }

    setUploading(true);
    setUploadProgress(10);

    const progressTimer = window.setInterval(() => {
      setUploadProgress((current) => Math.min(current + 12, 90));
    }, 250);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("title", resolvedTitle || selectedFile.name);
      formData.append("language", language);
      formData.append("promptTemplateId", promptTemplateId);
      formData.append("sourceType", "upload");
      formData.append("tags", JSON.stringify(tags));
      if (durationSec) {
        formData.append("durationSec", String(durationSec));
      }

      const response = await fetch("/api/meetings", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const payload = (await response.json()) as { jobId: string };
      setUploadProgress(100);
      toast.success("업로드를 시작했습니다.");
      router.push(`/processing/${payload.jobId}`);
    } catch (error) {
      console.error(error);
      toast.error("업로드에 실패했습니다.");
      setUploading(false);
    } finally {
      window.clearInterval(progressTimer);
    }
  };

  const handleAddTag = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || !tagInput.trim()) {
      return;
    }

    event.preventDefault();
    const nextTag = tagInput.trim();
    if (!tags.includes(nextTag)) {
      setTags((current) => [...current, nextTag]);
    }
    setTagInput("");
  };

  const handleRemoveTag = (target: string) => {
    setTags((current) => current.filter((tag) => tag !== target));
  };

  const applySelectedFile = async (file: File) => {
    if (!isSupportedAudioFile(file)) {
      toast.error("지원하지 않는 오디오 형식입니다.");
      return;
    }

    setSelectedFile(file);
    setDurationSec(await getAudioDuration(file));
    setTitle(file.name.replace(/\.[^.]+$/, ""));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">새 회의 업로드</h1>
        <p className="text-[var(--text-secondary)]">오디오를 업로드하면 OpenAI 전사와 요약이 자동으로 이어집니다.</p>
      </div>

      {!selectedFile ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            void handleDrop(event);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`relative p-16 rounded-[var(--radius-xl)] border-2 border-dashed cursor-pointer transition-all duration-200 ${
            isDragging
              ? "border-[var(--mint-500)] bg-[var(--mint-500)]/5"
              : "border-[var(--line-strong)] bg-[var(--bg-surface)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-surface-strong)]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm"
            onChange={(event) => {
              void handleFileSelect(event);
            }}
            className="hidden"
          />

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--graphite-800)] flex items-center justify-center mx-auto mb-6">
              <UploadIcon className="w-8 h-8 text-[var(--mint-500)]" />
            </div>

            <h3 className="text-xl mb-2">
              {isDragging ? "파일을 여기에 놓으세요" : "오디오를 놓으면 Brevoca가 회의를 정리합니다"}
            </h3>

            <p className="text-[var(--text-secondary)] mb-6">또는 클릭하여 파일을 선택하세요</p>

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--graphite-800)] text-sm text-[var(--text-secondary)]">
              <FileAudio className="w-4 h-4" />
              <span>mp3, wav, m4a, webm 지원</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-[var(--mint-500)]/10 flex items-center justify-center flex-shrink-0">
                <FileAudio className="w-6 h-6 text-[var(--mint-500)]" />
              </div>

              <div className="flex-1 min-w-0">
                <h4 className="font-medium mb-1 truncate">{selectedFile.name}</h4>
                <div className="flex items-center gap-4 text-sm text-[var(--text-secondary)]">
                  <span className="font-mono">{formatFileSize(selectedFile.size)}</span>
                  <span>•</span>
                  <span className="font-mono">{formatDuration(durationSec)}</span>
                </div>
              </div>

              {!uploading && (
                <button
                  onClick={() => {
                    setSelectedFile(null);
                    setDurationSec(null);
                  }}
                  className="p-2 rounded-lg hover:bg-[var(--graphite-800)] transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              )}

              {uploading && uploadProgress === 100 && (
                <div className="p-2">
                  <CheckCircle className="w-6 h-6 text-[var(--mint-500)]" />
                </div>
              )}
            </div>

            {uploading && (
              <div className="mt-4">
                <div className="h-2 bg-[var(--graphite-800)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="text-sm text-[var(--text-secondary)] mt-2">
                  {uploadProgress < 100 ? `업로드 중... ${uploadProgress}%` : "업로드 완료! 처리 페이지로 이동합니다..."}
                </div>
              </div>
            )}
          </div>

          {!uploading && (
            <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] space-y-4">
              <div>
                <label className="block text-sm mb-2">회의 제목</label>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="예: 제조라인 개선 회의"
                  className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm mb-2">언어</label>
                  <select
                    value={language}
                    onChange={(event) => setLanguage(event.target.value)}
                    className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                  >
                    <option value="ko">한국어</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm mb-2">템플릿</label>
                  <select
                    value={promptTemplateId}
                    onChange={(event) => setPromptTemplateId(event.target.value as PromptTemplateId)}
                    className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                  >
                    {promptTemplateIds.map((id) => (
                      <option key={id} value={id}>
                        {promptTemplateLabels[id]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm mb-2">태그</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={handleAddTag}
                    className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                    placeholder="태그 추가 후 Enter"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <div
                      key={tag}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--graphite-800)] text-sm text-[var(--text-secondary)]"
                    >
                      <TagIcon className="w-4 h-4" />
                      <span>{tag}</span>
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="p-1 rounded-full hover:bg-[var(--graphite-700)] transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!uploading && (
            <button
              onClick={() => {
                void handleUpload();
              }}
              className="w-full px-6 py-4 rounded-[var(--radius-lg)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity font-medium"
            >
              업로드하고 처리 시작
            </button>
          )}
        </div>
      )}
    </div>
  );
}

async function getAudioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);
    audio.preload = "metadata";
    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(Number.isFinite(audio.duration) ? Math.round(audio.duration) : null);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(durationSec: number | null): string {
  if (!durationSec || durationSec < 1) {
    return "--:--";
  }

  const minutes = Math.floor(durationSec / 60);
  const seconds = durationSec % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isSupportedAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg|webm)$/i.test(file.name);
}
