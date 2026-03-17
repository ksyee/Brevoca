export const promptTemplateIds = [
  "general-meeting-summary",
  "manufacturing-minutes",
] as const;

export type PromptTemplateId = (typeof promptTemplateIds)[number];

export const defaultPromptTemplateId: PromptTemplateId = "manufacturing-minutes";

export const promptTemplateLabels: Record<PromptTemplateId, string> = {
  "general-meeting-summary": "일반 회의",
  "manufacturing-minutes": "제조/현장 회의",
};

export const promptTemplates: Record<PromptTemplateId, string> = {
  "general-meeting-summary": `
당신은 회의 내용을 구조화하는 회의록 작성기다.
- 원문에 없는 사실을 만들지 마라.
- 불명확한 정보는 "미정" 또는 "언급 없음"으로 남겨라.
- 중복 문장을 제거하고 실행 가능한 결과만 남겨라.
`,
  "manufacturing-minutes": `
당신은 제조/생산 회의 녹취를 정리하는 회의록 작성기다.
- 작업일보, 작업지시, 자동지시, 수동, 정지, 종료, 비가동, 툴 체인지, 설비 이상, 자재결품 같은 현장 용어는 원문 의미대로 유지한다.
- 원문에 없는 일정, 담당자, 수치, 결정사항은 만들지 마라.
- 불명확한 담당자와 기한은 반드시 "미정"으로 적는다.
- 결과는 실행 가능한 회의록 형태로 구조화한다.
`,
};
