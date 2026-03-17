"use client";

import { useState } from "react";
import { Plus, Trash2, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { MeetingDetail } from "@brevoca/contracts";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  generateMeetingDocx,
  type Attendee,
  type DocxExportData,
} from "@/lib/client/generate-docx";

interface ExportDocxDialogProps {
  meeting: MeetingDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDefaultDateTime(createdAt: string): string {
  const date = new Date(createdAt);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}. ${m}. ${d}. ${h}:${min}`;
}

const EMPTY_ATTENDEE: Attendee = { department: "", position: "", name: "" };

export function ExportDocxDialog({ meeting, open, onOpenChange }: ExportDocxDialogProps) {
  const [author, setAuthor] = useState("");
  const [location, setLocation] = useState("");
  const [dateTime, setDateTime] = useState(() => formatDefaultDateTime(meeting.createdAt));
  const [attendees, setAttendees] = useState<Attendee[]>([{ ...EMPTY_ATTENDEE }]);
  const [exporting, setExporting] = useState(false);

  const updateAttendee = (index: number, field: keyof Attendee, value: string) => {
    setAttendees((prev) => prev.map((a, i) => (i === index ? { ...a, [field]: value } : a)));
  };

  const addAttendee = () => {
    setAttendees((prev) => [...prev, { ...EMPTY_ATTENDEE }]);
  };

  const removeAttendee = (index: number) => {
    setAttendees((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const exportData: DocxExportData = {
        author,
        location,
        dateTime,
        attendees: attendees.filter((a) => a.name || a.department || a.position),
      };
      await generateMeetingDocx(meeting, exportData);
      toast.success("DOCX 파일을 다운로드합니다.");
      onOpenChange(false);
    } catch {
      toast.error("DOCX 생성에 실패했습니다.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>회의록 내보내기</DialogTitle>
          <DialogDescription>
            DOCX 양식에 포함할 추가 정보를 입력하세요.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="author">작성자</Label>
              <Input
                id="author"
                placeholder="이름"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="location">장소</Label>
              <Input
                id="location"
                placeholder="회의 장소"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="dateTime">일시</Label>
            <Input
              id="dateTime"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>참석자</Label>
              <Button type="button" variant="ghost" size="sm" onClick={addAttendee}>
                <Plus className="w-4 h-4" />
                추가
              </Button>
            </div>

            <div className="space-y-2">
              {attendees.map((attendee, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    placeholder="소속"
                    className="flex-1"
                    value={attendee.department}
                    onChange={(e) => updateAttendee(index, "department", e.target.value)}
                  />
                  <Input
                    placeholder="직위"
                    className="w-20"
                    value={attendee.position}
                    onChange={(e) => updateAttendee(index, "position", e.target.value)}
                  />
                  <Input
                    placeholder="성명"
                    className="w-24"
                    value={attendee.name}
                    onChange={(e) => updateAttendee(index, "name", e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeAttendee(index)}
                    disabled={attendees.length <= 1}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button
            onClick={() => { void handleExport(); }}
            disabled={exporting}
          >
            {exporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {exporting ? "생성 중..." : "DOCX 다운로드"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
