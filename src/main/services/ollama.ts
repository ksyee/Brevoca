export class OllamaService {
  private baseUrl = 'http://localhost:11434'

  async checkConnection(): Promise<{ connected: boolean }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000)
      })
      return { connected: response.ok }
    } catch {
      return { connected: false }
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`)
      if (!response.ok) return []
      const data = await response.json()
      return (data.models || []).map((m: any) => m.name)
    } catch {
      return []
    }
  }

  async generateMinutes(
    transcript: string,
    model: string,
    onChunk: (chunk: string) => void
  ): Promise<void> {
    const prompt = `당신은 "회의 내용에서 사실을 추출하는 기록 정리 담당자"이다.
요약자가 아니라 분석가로서, 원문에 있는 사실만 정리하라.

[중요 규칙]
1. 원문에 없는 일정, 담당자, 수치, 결정사항을 절대 생성하지 마라.
2. 불명확한 항목은 "미정" 또는 "언급 없음"으로 표기하라.
3. 추측, 해석, 확장 설명을 하지 마라.
4. 반드시 아래 출력 구조를 유지하라.
5. 해당하는 내용이 없으면 "해당 없음"이라고 명시하라.

[출력 구조]

## 1. 회의 개요
- 회의 목적:
- 주요 주제:
- 참석자(언급된 경우만):

## 2. 결정사항 (명확히 합의된 것만)
-

## 3. 액션아이템
형식: [내용] / 담당: [이름 또는 미정] / 기한: [날짜 또는 미정]
-

## 4. 논의되었으나 미결정 사항
-

## 5. 주요 이슈 및 리스크
-

## 6. 다음 회의 관련
- 예정 일정:
- 준비사항:

## 7. 참고 정보 (수치, 데이터 등)
-

---

[회의 녹취 내용]
${transcript}

위 녹취 내용을 분석하여 출력 구조에 맞게 정리하라.
마지막으로, 작성한 내용 중 원문에 근거가 없는 문장이 있다면 제거하라.`

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          temperature: 0.1,
          top_p: 0.85,
          num_predict: 2048,
          repeat_penalty: 1.1
        }
      })
    })

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let pendingLine = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      pendingLine += decoder.decode(value, { stream: true })
      const lines = pendingLine.split('\n')
      pendingLine = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const json = JSON.parse(line)
          if (json.response) {
            onChunk(json.response)
          }
        } catch {
          // ignore malformed JSON lines
        }
      }
    }

    pendingLine += decoder.decode()
    if (pendingLine.trim()) {
      try {
        const json = JSON.parse(pendingLine)
        if (json.response) {
          onChunk(json.response)
        }
      } catch {
        // ignore trailing malformed JSON line
      }
    }
  }
}
