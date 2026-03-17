"use client";

import { useEffect, useState } from "react";
import type { WorkspaceDetailResponse, WorkspaceInvitationRecord, WorkspaceMemberRecord } from "@brevoca/contracts";
import { Building2, Users, FileText, Download, Zap, Save, Plus, X } from "lucide-react";
import { useAppSession } from "@/components/AppSessionProvider";
import { authedFetch } from "@/lib/client/authed-fetch";
import { toast } from "sonner";

export default function Settings() {
  const { currentWorkspace, refresh, user } = useAppSession();
  const [workspaceName, setWorkspaceName] = useState("");
  const [defaultLanguage, setDefaultLanguage] = useState("ko");
  const [defaultTemplate, setDefaultTemplate] = useState("manufacturing");
  const [exportFormat, setExportFormat] = useState("markdown");
  const [inviteEmail, setInviteEmail] = useState("");
  const [members, setMembers] = useState<WorkspaceMemberRecord[]>([]);
  const [invitations, setInvitations] = useState<WorkspaceInvitationRecord[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [savingWorkspace, setSavingWorkspace] = useState(false);
  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [actingMemberId, setActingMemberId] = useState<string | null>(null);
  const [actingInvitationId, setActingInvitationId] = useState<string | null>(null);

  const isOwner = currentWorkspace?.role === "owner";

  useEffect(() => {
    setWorkspaceName(currentWorkspace?.name ?? "");
  }, [currentWorkspace?.name]);

  useEffect(() => {
    if (!currentWorkspace) {
      setMembers([]);
      setInvitations([]);
      return;
    }

    let cancelled = false;
    setLoadingMembers(true);

    void (async () => {
      try {
        const response = await authedFetch(`/api/workspaces/${currentWorkspace.id}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await getResponseError(response));
        }

        const payload = (await response.json()) as WorkspaceDetailResponse;
        if (!cancelled) {
          setMembers(payload.members);
          setInvitations(payload.invitations);
        }
      } catch (error) {
        if (!cancelled) {
          setMembers([]);
          setInvitations([]);
          toast.error(error instanceof Error ? error.message : "멤버 목록을 불러오지 못했습니다.");
        }
      } finally {
        if (!cancelled) {
          setLoadingMembers(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentWorkspace]);

  const handleSave = async () => {
    if (!currentWorkspace) {
      return;
    }

    setSavingWorkspace(true);
    try {
      const response = await authedFetch(`/api/workspaces/${currentWorkspace.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: workspaceName }),
      });

      if (!response.ok) {
        throw new Error(await getResponseError(response));
      }

      await refresh();
      toast.success("워크스페이스 이름을 저장했습니다.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "워크스페이스 저장에 실패했습니다.");
    } finally {
      setSavingWorkspace(false);
    }
  };

  const handleInvite = () => {
    if (!currentWorkspace || !inviteEmail.trim()) {
      return;
    }

    setSubmittingInvite(true);
    void (async () => {
      try {
        const response = await authedFetch(`/api/workspaces/${currentWorkspace.id}/invitations`, {
          method: "POST",
          body: JSON.stringify({ email: inviteEmail }),
        });

        if (!response.ok) {
          throw new Error(await getResponseError(response));
        }

        const payload = (await response.json()) as { invitation: WorkspaceInvitationRecord };
        setInvitations((current) => [...current, payload.invitation]);
        setInviteEmail("");
        toast.success("초대를 생성했습니다.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "초대 생성에 실패했습니다.");
      } finally {
        setSubmittingInvite(false);
      }
    })();
  };

  const handleRoleChange = (member: WorkspaceMemberRecord, role: "owner" | "member") => {
    if (!currentWorkspace || member.role === role) {
      return;
    }

    setActingMemberId(member.userId);
    void (async () => {
      try {
        const response = await authedFetch(`/api/workspaces/${currentWorkspace.id}/members/${member.userId}`, {
          method: "PATCH",
          body: JSON.stringify({ role }),
        });

        if (!response.ok) {
          throw new Error(await getResponseError(response));
        }

        setMembers((current) =>
          current.map((item) => (item.userId === member.userId ? { ...item, role } : item)),
        );
        await refresh();
        toast.success("멤버 역할을 변경했습니다.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "역할 변경에 실패했습니다.");
      } finally {
        setActingMemberId(null);
      }
    })();
  };

  const handleRemoveMember = (member: WorkspaceMemberRecord) => {
    if (!currentWorkspace) {
      return;
    }

    setActingMemberId(member.userId);
    void (async () => {
      try {
        const response = await authedFetch(`/api/workspaces/${currentWorkspace.id}/members/${member.userId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(await getResponseError(response));
        }

        setMembers((current) => current.filter((item) => item.userId !== member.userId));
        toast.success("멤버를 제거했습니다.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "멤버 제거에 실패했습니다.");
      } finally {
        setActingMemberId(null);
      }
    })();
  };

  const handleRevokeInvitation = (invitation: WorkspaceInvitationRecord) => {
    if (!currentWorkspace) {
      return;
    }

    setActingInvitationId(invitation.id);
    void (async () => {
      try {
        const response = await authedFetch(`/api/workspaces/${currentWorkspace.id}/invitations/${invitation.id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(await getResponseError(response));
        }

        setInvitations((current) => current.filter((item) => item.id !== invitation.id));
        toast.success("초대를 취소했습니다.");
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "초대 취소에 실패했습니다.");
      } finally {
        setActingInvitationId(null);
      }
    })();
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">설정</h1>
        <p className="text-[var(--text-secondary)]">워크스페이스와 기본 설정을 관리하세요.</p>
      </div>

      <div className="space-y-6">
        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="flex items-center gap-2 mb-6">
            <Building2 className="w-5 h-5 text-[var(--mint-500)]" />
            <h2 className="text-xl">워크스페이스 정보</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-2">워크스페이스 이름</label>
              <input
                type="text"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                disabled={!currentWorkspace}
                className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm mb-2">워크스페이스 설명</label>
              <textarea
                rows={3}
                placeholder="이 워크스페이스에 대한 설명을 입력하세요"
                className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors resize-none"
              />
            </div>
          </div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="flex items-center gap-2 mb-6">
            <Users className="w-5 h-5 text-[var(--sky-500)]" />
            <h2 className="text-xl">팀 멤버</h2>
          </div>

          <div className="mb-6 p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)]">
            <div className="flex gap-3">
              <input
                type="email"
                placeholder="이메일 주소를 입력하세요"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                className="flex-1 px-4 py-2 rounded-[var(--radius-md)] bg-[var(--graphite-900)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
              />
              <button
                onClick={handleInvite}
                disabled={submittingInvite || !isOwner}
                className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity"
              >
                <Plus className="w-4 h-4" />
                <span>{submittingInvite ? "초대 중..." : "초대"}</span>
              </button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mt-2">
              {isOwner
                ? "초대받은 사용자가 같은 이메일로 로그인하면 자동으로 워크스페이스 멤버로 연결됩니다."
                : "멤버 초대는 워크스페이스 관리자만 할 수 있습니다."}
            </p>
          </div>

          {invitations.length > 0 && (
            <div className="mb-6 space-y-2">
              <div className="text-sm text-[var(--text-secondary)]">대기 중인 초대</div>
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between p-4 rounded-[var(--radius-md)] border border-dashed border-[var(--line-soft)] bg-[var(--graphite-900)]"
                >
                  <div>
                    <div className="font-medium">{invitation.email}</div>
                    <div className="text-sm text-[var(--text-secondary)]">
                      {invitation.role === "owner" ? "관리자" : "멤버"} 초대 대기 중
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => handleRevokeInvitation(invitation)}
                      disabled={actingInvitationId === invitation.id}
                      className="p-2 rounded-lg hover:bg-[var(--graphite-800)] text-[var(--text-secondary)] hover:text-[var(--danger-500)] transition-colors disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            {loadingMembers ? (
              <div className="p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)] text-sm text-[var(--text-secondary)]">
                멤버를 불러오는 중입니다.
              </div>
            ) : members.length > 0 ? (
              members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)]"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[var(--mint-500)] to-[var(--sky-500)] flex items-center justify-center text-[var(--graphite-950)] font-semibold">
                      {member.displayName[0]?.toUpperCase() ?? "?"}
                    </div>
                    <div>
                      <div className="font-medium">{member.displayName}</div>
                      <div className="text-sm text-[var(--text-secondary)]">{member.email ?? "이메일 없음"}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {isOwner && member.userId !== user?.id ? (
                      <select
                        value={member.role}
                        onChange={(event) => handleRoleChange(member, event.target.value as "owner" | "member")}
                        disabled={actingMemberId === member.userId}
                        className="px-3 py-1 rounded-full bg-[var(--graphite-900)] text-sm text-[var(--text-secondary)] border border-[var(--line-soft)]"
                      >
                        <option value="owner">관리자</option>
                        <option value="member">멤버</option>
                      </select>
                    ) : (
                      <div className="px-3 py-1 rounded-full bg-[var(--graphite-900)] text-sm text-[var(--text-secondary)]">
                        {member.role === "owner" ? "관리자" : "멤버"}
                      </div>
                    )}
                    {isOwner && member.userId !== user?.id && (
                      <button
                        onClick={() => handleRemoveMember(member)}
                        disabled={actingMemberId === member.userId}
                        className="p-2 rounded-lg hover:bg-[var(--graphite-900)] text-[var(--text-secondary)] hover:text-[var(--danger-500)] transition-colors disabled:opacity-50"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="p-4 rounded-[var(--radius-md)] bg-[var(--graphite-800)] text-sm text-[var(--text-secondary)]">
                아직 등록된 멤버가 없습니다. 현재는 워크스페이스 생성자만 멤버로 표시됩니다.
              </div>
            )}
          </div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="flex items-center gap-2 mb-6">
            <FileText className="w-5 h-5 text-[var(--signal-orange-500)]" />
            <h2 className="text-xl">기본 설정</h2>
          </div>

          <div className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-2">기본 언어</label>
                <select
                  value={defaultLanguage}
                  onChange={(e) => setDefaultLanguage(e.target.value)}
                  className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                >
                  <option value="ko">한국어</option>
                  <option value="en">English</option>
                  <option value="ja">日本語</option>
                  <option value="zh">中文</option>
                </select>
              </div>

              <div>
                <label className="block text-sm mb-2">기본 템플릿</label>
                <select
                  value={defaultTemplate}
                  onChange={(e) => setDefaultTemplate(e.target.value)}
                  className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors"
                >
                  <option value="general">일반 회의</option>
                  <option value="manufacturing">제조/현장 회의</option>
                  <option value="brainstorm">브레인스토밍</option>
                  <option value="oneonone">1:1 미팅</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="flex items-center gap-2 mb-6">
            <Download className="w-5 h-5 text-[var(--mint-500)]" />
            <h2 className="text-xl">내보내기 설정</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-2">기본 내보내기 형식</label>
              <div className="grid grid-cols-3 gap-3">
                {["markdown", "docx", "pdf"].map((format) => (
                  <button
                    key={format}
                    onClick={() => setExportFormat(format)}
                    className={`px-4 py-3 rounded-[var(--radius-md)] text-sm transition-colors ${
                      exportFormat === format
                        ? "bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)]"
                        : "bg-[var(--graphite-800)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {format === "markdown" && "Markdown (.md)"}
                    {format === "docx" && "Word (.docx)"}
                    {format === "pdf" && "PDF (.pdf)"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 rounded-[var(--radius-xl)] bg-[var(--bg-surface)] border border-[var(--line-soft)]">
          <div className="flex items-center gap-2 mb-6">
            <Zap className="w-5 h-5 text-[var(--sky-500)]" />
            <h2 className="text-xl">AI 제공자 설정</h2>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm mb-2">전사 제공자</label>
              <select className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors">
                <option>Whisper (OpenAI)</option>
              </select>
            </div>

            <div>
              <label className="block text-sm mb-2">요약 제공자</label>
              <select className="w-full px-4 py-3 rounded-[var(--radius-md)] bg-[var(--graphite-800)] border border-[var(--line-soft)] focus:border-[var(--mint-500)] focus:outline-none transition-colors">
                <option>GPT-5 mini (OpenAI)</option>
              </select>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              void handleSave();
            }}
            disabled={savingWorkspace || !currentWorkspace}
            className="flex items-center gap-2 px-6 py-3 rounded-[var(--radius-md)] bg-gradient-to-r from-[var(--mint-500)] to-[var(--sky-500)] text-[var(--graphite-950)] hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{savingWorkspace ? "저장 중..." : "설정 저장"}</span>
          </button>
          <button
            onClick={() => setWorkspaceName(currentWorkspace?.name ?? "")}
            className="px-6 py-3 rounded-[var(--radius-md)] border border-[var(--line-strong)] hover:bg-[var(--bg-surface-strong)] transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

async function getResponseError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}
