"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload as UploadIcon, FileAudio, X, CheckCircle, Tag as TagIcon } from "lucide-react";

export default function Upload() {
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.type.startsWith("audio/") || file.name.match(/\.(mp3|wav|m4a|ogg)$/i))) {
      setSelectedFile(file);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (!selectedFile) return;

    setUploading(true);
    setUploadProgress(0);

    // Simulate upload progress
    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            router.push("/processing/new");
          }, 500);
          return 100;
        }
        return prev + 10;
      });
    }, 200);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const formatDuration = (file: File) => {
    // Mock duration - in real app, would parse audio file
    return "45:30";
  };

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">새 회의 업로드</h1>
        <p className="text-[var(--text-secondary)]">
          회의 오디오를 업로드하면 자동으로 전사와 요약을 생성합니다.
        </p>
      </div>

      {/* Upload Zone */}
      {!selectedFile ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative p-16 rounded-[var(--radius-xl)] border-2 border-dashed cursor-pointer
            transition-all duration-200
            ${
              isDragging
                ? "border-[var(--mint-500)] bg-[var(--mint-500)]/5"
                : "border-[var(--line-strong)] bg-[var(--bg-surface)] hover:border-[var(--line-strong)] hover:bg-[var(--bg-surface-strong)]"
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-[var(--graphite-800)] flex items-center justify-center mx-auto mb-6">
              <UploadIcon className="w-8 h-8 text-[var(--mint-500)]" />
            </div>

            <h3 className="text-xl mb-2">
              {isDragging ? "파일을 여기에 놓으세요" : "오디오를 놓으면 Brevoca가 회의를 정리합니다"}
            </h3>

            <p className="text-[var(--text-secondary)] mb-6">
              또는 클릭하여 파일을 선택하세요
            </p>

            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--graphite-800)] text-sm text-[var(--text-secondary)]">
              <FileAudio className="w-4 h-4" />
              <span>mp3, wav, m4a 지원</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* File Info Card */}
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
                  <span className="font-mono">{formatDuration(selectedFile)}</span>
                </div>
              </div>

              {!uploading && (
                <button
                  onClick={() => setSelectedFile(null)}
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

          {/* Meeting Details */}
          {!uploading && (
            <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)] space-y-4">
              <div>
                <label className="block text-sm mb-2">회의 제목</label>
                <input
                  type="text"
                  placeholder="예: 제조라인 개선 회의"
                  className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm mb-2">언어</label>
                  <select className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors">
                    <option>한국어</option>
                    <option>English</option>
                    <option>日本語</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm mb-2">템플릿</label>
                  <select className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors">
                    <option>일반 회의</option>
                    <option>제조/현장 회의</option>
                    <option>브레인스토밍</option>
                    <option>1:1 미팅</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm mb-2">태그</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleAddTag}
                    className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                    placeholder="태그 추가"
                  />
                  <button
                    onClick={() => handleAddTag({ key: "Enter" } as React.KeyboardEvent<HTMLInputElement>)}
                    className="px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                  >
                    추가
                  </button>
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
                        className="ml-2 p-1 rounded-full hover:bg-[var(--graphite-800)] transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Actions */}
          {!uploading && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleUpload}
                className="flex-1 py-4 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
              >
                업로드 시작
              </button>
              <button
                onClick={() => setSelectedFile(null)}
                className="px-6 py-4 rounded-[var(--radius-md)] border border-[var(--line-strong)] hover:bg-[var(--bg-surface-strong)] transition-colors"
              >
                취소
              </button>
            </div>
          )}
        </div>
      )}

      {/* Info */}
      <div className="mt-8 p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
        <h3 className="font-medium mb-3">처리 과정</h3>
        <div className="space-y-2 text-sm text-[var(--text-secondary)]">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--mint-500)]" />
            <span>1. 오디오 업로드</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--sky-500)]" />
            <span>2. 음성을 텍스트로 전사 (약 1~3분)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--signal-orange-500)]" />
            <span>3. AI가 요약, 결정사항, 액션아이템 추출 (약 30초~1분)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[var(--mist-300)]" />
            <span>4. 결과 확인 및 공유 가능</span>
          </div>
        </div>
      </div>
    </div>
  );
}