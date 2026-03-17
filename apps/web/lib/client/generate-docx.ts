import {
  Document,
  Packer,
  Table,
  TableRow,
  TableCell,
  Paragraph,
  TextRun,
  WidthType,
  AlignmentType,
  VerticalAlign,
  BorderStyle,
  ShadingType,
  type ITableCellBorders,
  type IShadingAttributesProperties,
  HeadingLevel,
  TableLayoutType,
} from "docx";
import { saveAs } from "file-saver";
import type { MeetingDetail } from "@brevoca/contracts";

export interface Attendee {
  department: string;
  position: string;
  name: string;
}

export interface DocxExportData {
  author: string;
  location: string;
  dateTime: string;
  attendees: Attendee[];
}

const FONT = "Pretendard";
const GRAY_FILL: IShadingAttributesProperties = {
  type: ShadingType.CLEAR,
  color: "auto",
  fill: "D9D9D9",
};

const TABLE_WIDTH = 9500;

const GRID_COLS = [1500, 400, 1050, 900, 900, 350, 424, 1126, 199, 92, 759, 474, 426, 900];

function colWidth(...indices: number[]): number {
  return indices.reduce((sum, i) => sum + GRID_COLS[i], 0);
}

const CELL_BORDERS: ITableCellBorders = {
  top: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  left: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
  right: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
};

function text(value: string, options?: { bold?: boolean; size?: number }): TextRun {
  return new TextRun({
    text: value,
    font: FONT,
    bold: options?.bold ?? false,
    size: options?.size ?? 20,
  });
}

function centeredParagraph(value: string, options?: { bold?: boolean; size?: number }): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [text(value, options)],
  });
}

function leftParagraph(value: string, options?: { bold?: boolean; size?: number }): Paragraph {
  return new Paragraph({
    children: [text(value, options)],
  });
}

function labelCell(label: string, width: number, colSpan?: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: colSpan,
    shading: GRAY_FILL,
    borders: CELL_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    children: [centeredParagraph(label, { bold: true })],
  });
}

function valueCell(value: string, width: number, colSpan?: number): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: colSpan,
    borders: CELL_BORDERS,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        indent: { left: 120 },
        children: [text(value)],
      }),
    ],
  });
}

function buildTitleAndApprovalRows(): TableRow[] {
  const titleWidth = colWidth(0, 1, 2, 3, 4, 5);
  const approvalLabelWidth = GRID_COLS[6];
  const approvalColWidth1 = colWidth(7, 8);
  const approvalColWidth2 = colWidth(9, 10, 11);
  const approvalColWidth3 = colWidth(12, 13);

  const row1 = new TableRow({
    children: [
      new TableCell({
        width: { size: titleWidth, type: WidthType.DXA },
        columnSpan: 6,
        rowSpan: 3,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          centeredParagraph("회  의  록", { bold: true, size: 60 }),
        ],
      }),
      new TableCell({
        width: { size: approvalLabelWidth, type: WidthType.DXA },
        rowSpan: 3,
        shading: GRAY_FILL,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          centeredParagraph("결", { bold: true }),
          centeredParagraph("", { bold: true }),
          centeredParagraph("재", { bold: true }),
        ],
      }),
      new TableCell({
        width: { size: approvalColWidth1, type: WidthType.DXA },
        columnSpan: 2,
        shading: GRAY_FILL,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("작성", { bold: true })],
      }),
      new TableCell({
        width: { size: approvalColWidth2, type: WidthType.DXA },
        columnSpan: 3,
        shading: GRAY_FILL,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("검토", { bold: true })],
      }),
      new TableCell({
        width: { size: approvalColWidth3, type: WidthType.DXA },
        columnSpan: 2,
        shading: GRAY_FILL,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("승인", { bold: true })],
      }),
    ],
  });

  const row2 = new TableRow({
    height: { value: 818, rule: "atLeast" as const },
    children: [
      new TableCell({
        width: { size: approvalColWidth1, type: WidthType.DXA },
        columnSpan: 2,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("")],
      }),
      new TableCell({
        width: { size: approvalColWidth2, type: WidthType.DXA },
        columnSpan: 3,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("")],
      }),
      new TableCell({
        width: { size: approvalColWidth3, type: WidthType.DXA },
        columnSpan: 2,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("")],
      }),
    ],
  });

  const row3 = new TableRow({
    children: [
      new TableCell({
        width: { size: approvalColWidth1, type: WidthType.DXA },
        columnSpan: 2,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("/")],
      }),
      new TableCell({
        width: { size: approvalColWidth2, type: WidthType.DXA },
        columnSpan: 3,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("/")],
      }),
      new TableCell({
        width: { size: approvalColWidth3, type: WidthType.DXA },
        columnSpan: 2,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("/")],
      }),
    ],
  });

  return [row1, row2, row3];
}

function buildInfoRows(
  meeting: MeetingDetail,
  exportData: DocxExportData,
): TableRow[] {
  const labelWidth = GRID_COLS[0];
  const valueWidth1 = colWidth(1, 2, 3, 4, 5, 6);
  const labelWidth2 = colWidth(7, 8, 9);
  const valueWidth2 = colWidth(10, 11, 12, 13);

  const titleRow = new TableRow({
    children: [
      labelCell("제목/안건", labelWidth),
      valueCell(meeting.title, valueWidth1, 6),
      labelCell("작성자", labelWidth2, 3),
      valueCell(exportData.author, valueWidth2, 4),
    ],
  });

  const locationRow = new TableRow({
    children: [
      labelCell("장소", labelWidth),
      valueCell(exportData.location, valueWidth1, 6),
      labelCell("일시", labelWidth2, 3),
      valueCell(exportData.dateTime, valueWidth2, 4),
    ],
  });

  return [titleRow, locationRow];
}

function buildAttendeeRows(attendees: Attendee[]): TableRow[] {
  const headerRow = new TableRow({
    children: [
      new TableCell({
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        columnSpan: 14,
        shading: GRAY_FILL,
        borders: CELL_BORDERS,
        verticalAlign: VerticalAlign.CENTER,
        children: [centeredParagraph("참석자", { bold: true })],
      }),
    ],
  });

  const leftDeptW = colWidth(0, 1);
  const leftPosW = GRID_COLS[2];
  const leftNameW = GRID_COLS[3];
  const leftStampW = GRID_COLS[4];
  const rightDeptW = colWidth(5, 6, 7);
  const rightPosW = colWidth(8, 9, 10);
  const rightNameW = colWidth(11, 12);
  const rightStampW = GRID_COLS[13];

  const colHeaderRow = new TableRow({
    children: [
      labelCell("소속", leftDeptW, 2),
      labelCell("직위", leftPosW),
      labelCell("성명", leftNameW),
      labelCell("인", leftStampW),
      labelCell("소속", rightDeptW, 3),
      labelCell("직위", rightPosW, 3),
      labelCell("성명", rightNameW, 2),
      labelCell("인", rightStampW),
    ],
  });

  const rows: TableRow[] = [headerRow, colHeaderRow];
  const rowCount = Math.max(3, Math.ceil(attendees.length / 2));

  for (let i = 0; i < rowCount; i++) {
    const left = attendees[i * 2];
    const right = attendees[i * 2 + 1];

    const dataRow = new TableRow({
      children: [
        new TableCell({
          width: { size: leftDeptW, type: WidthType.DXA },
          columnSpan: 2,
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph(left?.department ?? "")],
        }),
        new TableCell({
          width: { size: leftPosW, type: WidthType.DXA },
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph(left?.position ?? "")],
        }),
        new TableCell({
          width: { size: leftNameW, type: WidthType.DXA },
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph(left?.name ?? "")],
        }),
        new TableCell({
          width: { size: leftStampW, type: WidthType.DXA },
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph("")],
        }),
        new TableCell({
          width: { size: rightDeptW, type: WidthType.DXA },
          columnSpan: 3,
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph(right?.department ?? "")],
        }),
        new TableCell({
          width: { size: rightPosW, type: WidthType.DXA },
          columnSpan: 3,
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph(right?.position ?? "")],
        }),
        new TableCell({
          width: { size: rightNameW, type: WidthType.DXA },
          columnSpan: 2,
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph(right?.name ?? "")],
        }),
        new TableCell({
          width: { size: rightStampW, type: WidthType.DXA },
          borders: CELL_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [centeredParagraph("")],
        }),
      ],
    });

    rows.push(dataRow);
  }

  return rows;
}

function buildContentParagraphs(meeting: MeetingDetail): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  if (meeting.summary?.topics?.length) {
    for (const topic of meeting.summary.topics) {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 200, after: 100 },
          children: [text(topic.title, { bold: true, size: 22 })],
        }),
      );

      for (const point of topic.points) {
        paragraphs.push(
          new Paragraph({
            indent: { left: 240 },
            spacing: { after: 60 },
            children: [text(`• ${point}`)],
          }),
        );
      }
    }
  }

  if (meeting.summary?.nextSteps?.length) {
    paragraphs.push(
      new Paragraph({
        spacing: { before: 300, after: 100 },
        children: [text("다음 단계 / 후속 조치", { bold: true, size: 22 })],
      }),
    );

    for (const step of meeting.summary.nextSteps) {
      const parts: string[] = [step.content];
      if (step.assignee) parts.push(`[담당: ${step.assignee}]`);
      if (step.dueDate) parts.push(`[기한: ${step.dueDate}]`);

      paragraphs.push(
        new Paragraph({
          indent: { left: 240 },
          spacing: { after: 60 },
          children: [text(`☐ ${parts.join(" ")}`)],
        }),
      );
    }
  }

  if (paragraphs.length === 0 && meeting.summary?.markdown) {
    for (const line of meeting.summary.markdown.split("\n")) {
      paragraphs.push(leftParagraph(line));
    }
  }

  if (paragraphs.length === 0) {
    paragraphs.push(leftParagraph(""));
  }

  return paragraphs;
}

function buildContentRow(meeting: MeetingDetail): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: TABLE_WIDTH, type: WidthType.DXA },
        columnSpan: 14,
        borders: CELL_BORDERS,
        children: [
          new Paragraph({
            spacing: { after: 100 },
            children: [text("회의 내용", { bold: true })],
          }),
          ...buildContentParagraphs(meeting),
        ],
      }),
    ],
  });
}

export async function generateMeetingDocx(
  meeting: MeetingDetail,
  exportData: DocxExportData,
): Promise<void> {
  const mainTable = new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    rows: [
      ...buildTitleAndApprovalRows(),
      ...buildInfoRows(meeting, exportData),
      ...buildAttendeeRows(exportData.attendees),
      buildContentRow(meeting),
    ],
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1000, right: 800, bottom: 1000, left: 800 },
          },
        },
        children: [mainTable],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${meeting.title}.docx`);
}
