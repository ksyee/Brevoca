import { spawn, spawnSync, type ChildProcess } from 'child_process'
import fs from 'fs'
import path from 'path'

const CONNECTION_TIMEOUT_MS = 3000
const STARTUP_TIMEOUT_MS = 15000
const START_ATTEMPT_COOLDOWN_MS = 15000

export interface OllamaPullProgress {
  status: string
  completed?: number
  total?: number
}

export class OllamaService {
  private baseUrl = 'http://localhost:11434'
  private managedProcess: ChildProcess | null = null
  private startupPromise: Promise<boolean> | null = null
  private executablePath: string | null | undefined = undefined
  private startedByApp = false
  private lastStartAttemptAt = 0
  private lastStartupError: string | null = null

  async checkConnection(): Promise<{ connected: boolean }> {
    if (await this.isConnected()) {
      return { connected: true }
    }

    await this.ensureServerReady()
    return { connected: await this.isConnected() }
  }

  async getModels(): Promise<string[]> {
    const isReady = await this.ensureServerReady()
    if (!isReady) {
      return []
    }

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
    const isReady = await this.ensureServerReady()
    if (!isReady) {
      throw new Error(this.lastStartupError || 'Ollama 서버를 시작할 수 없습니다.')
    }

    const prompt = `당신은 제조/생산 회의 녹취를 정리하는 회의록 작성기다.
역할은 "원문에 있는 사실을 구조화"하는 것이다. 요약 감상문을 쓰지 마라.

[절대 규칙]
1. 원문에 없는 일정, 담당자, 수치, 결정사항을 만들지 마라.
2. 불명확하면 반드시 "미정" 또는 "언급 없음"으로 적어라.
3. 같은 의미의 문장을 반복하지 마라.
4. 같은 항목을 두 번 쓰지 마라.
5. "정리하면", "이상과 같습니다", "최종 정리본", "원문에 근거하지 않은 문장을 제거했다" 같은 메타 문장을 쓰지 마라.
6. 서론, 결론, 설명문 없이 바로 아래 마크다운 구조만 출력하라.
7. 각 bullet은 짧고 사실 중심으로 작성하라.
8. 회의에서 반복적으로 언급되었더라도 최종 출력에는 한 번만 정리하라.
9. 작업일보, 작업지시, 자동지시, 수동, 정지, 종료, 비가동, 툴 체인지, 설비 이상, 자재결품 같은 생산 현장 용어는 가능한 한 원문 의미대로 유지하라.

[출력 형식]
## 1. 회의 개요
- 회의 목적:
- 주요 주제:
- 참석자(언급된 경우만):

## 2. 결정사항
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

## 7. 참고 정보
- 수치:
- 용어/기준:

[작성 방법]
- 결정사항에는 "합의되었다", "정리하겠습니다", "그렇게 하자"처럼 확정 뉘앙스가 있는 내용만 넣어라.
- 의견 충돌 중 결론이 안 난 것은 "논의되었으나 미결정 사항"으로 보낸다.
- 담당자가 불명확하면 추정하지 말고 "미정"으로 적는다.
- 수치나 날짜는 원문에 있는 경우만 적는다.
- 내용이 없으면 "해당 없음"이라고 적는다.

[회의 녹취 내용]
${transcript}`

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: {
          temperature: 0,
          top_p: 0.7,
          num_predict: 1536,
          repeat_penalty: 1.2
        }
      })
    })

    if (!response.ok) {
      const rawBody = await response.text()
      let detail = rawBody.trim()

      try {
        const parsed = JSON.parse(rawBody)
        if (typeof parsed?.error === 'string' && parsed.error.trim()) {
          detail = parsed.error.trim()
        }
      } catch {
        // Ignore non-JSON error bodies and fall back to the raw text.
      }

      const suffix = detail ? ` - ${detail}` : ''
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}${suffix}`)
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

  async pullModel(
    model: string,
    onProgress: (progress: OllamaPullProgress) => void
  ): Promise<void> {
    const isReady = await this.ensureServerReady()
    if (!isReady) {
      throw new Error(this.lastStartupError || 'Ollama 서버를 시작할 수 없습니다.')
    }

    const response = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
      }),
    })

    if (!response.ok) {
      const rawBody = await response.text()
      let detail = rawBody.trim()

      try {
        const parsed = JSON.parse(rawBody)
        if (typeof parsed?.error === 'string' && parsed.error.trim()) {
          detail = parsed.error.trim()
        }
      } catch {
        // Ignore non-JSON error bodies and fall back to the raw text.
      }

      const suffix = detail ? ` - ${detail}` : ''
      throw new Error(`Ollama pull error: ${response.status} ${response.statusText}${suffix}`)
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
        this.emitPullProgress(line, onProgress)
      }
    }

    pendingLine += decoder.decode()
    if (pendingLine.trim()) {
      this.emitPullProgress(pendingLine, onProgress)
    }
  }

  warmup(): void {
    void this.ensureServerReady().catch((error) => {
      console.warn('Failed to warm up Ollama service:', error)
    })
  }

  dispose(): void {
    if (this.startedByApp && this.managedProcess && !this.managedProcess.killed) {
      this.managedProcess.kill()
    }
    this.managedProcess = null
  }

  private async ensureServerReady(): Promise<boolean> {
    if (await this.isConnected()) {
      return true
    }

    if (this.startupPromise) {
      return this.startupPromise
    }

    if (this.managedProcess && !this.managedProcess.killed) {
      return this.waitForConnection()
    }

    if (Date.now() - this.lastStartAttemptAt < START_ATTEMPT_COOLDOWN_MS) {
      return false
    }

    this.lastStartAttemptAt = Date.now()
    this.startupPromise = (async () => {
      const executablePath = this.resolveExecutablePath()
      if (!executablePath) {
        this.lastStartupError = 'Ollama 실행 파일을 찾을 수 없습니다. Ollama를 설치하거나 BREVOCA_OLLAMA_PATH를 설정하세요.'
        return false
      }

      try {
        const child = spawn(executablePath, ['serve'], {
          stdio: 'ignore',
          windowsHide: true,
        })

        this.startedByApp = true
        this.managedProcess = child
        this.lastStartupError = null

        child.once('exit', () => {
          this.managedProcess = null
        })

        child.once('error', (error) => {
          this.lastStartupError = `Ollama 실행 실패: ${error.message}`
        })
      } catch (error) {
        this.lastStartupError = `Ollama 실행 실패: ${error instanceof Error ? error.message : String(error)}`
        this.managedProcess = null
        return false
      }

      return this.waitForConnection()
    })().finally(() => {
      this.startupPromise = null
    })

    return this.startupPromise
  }

  private async isConnected(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS)
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async waitForConnection(timeoutMs: number = STARTUP_TIMEOUT_MS): Promise<boolean> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (await this.isConnected()) {
        this.lastStartupError = null
        return true
      }

      if (this.startedByApp && this.managedProcess?.exitCode != null) {
        this.lastStartupError ||= 'Ollama 서버가 시작 직후 종료되었습니다.'
        return false
      }

      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    this.lastStartupError ||= 'Ollama 서버 시작 시간이 초과되었습니다.'
    return false
  }

  private resolveExecutablePath(): string | null {
    if (this.executablePath !== undefined) {
      return this.executablePath
    }

    const envPath = process.env.BREVOCA_OLLAMA_PATH?.trim()
    if (envPath && fs.existsSync(envPath)) {
      this.executablePath = envPath
      return this.executablePath
    }

    const pathExecutable = this.findExecutableOnPath()
    if (pathExecutable) {
      this.executablePath = pathExecutable
      return this.executablePath
    }

    const candidatePaths = process.platform === 'win32'
      ? [
          path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
          path.join(process.env.ProgramFiles || '', 'Ollama', 'ollama.exe'),
        ]
      : ['/usr/local/bin/ollama', '/opt/homebrew/bin/ollama', '/usr/bin/ollama']

    const existingPath = candidatePaths.find((candidate) => candidate && fs.existsSync(candidate))
    this.executablePath = existingPath || null
    return this.executablePath
  }

  private findExecutableOnPath(): string | null {
    const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which'
    const result = spawnSync(lookupCommand, ['ollama'], {
      encoding: 'utf8',
      windowsHide: true,
    })

    if (result.status !== 0) {
      return null
    }

    const firstMatch = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)

    return firstMatch || null
  }

  private emitPullProgress(
    rawLine: string,
    onProgress: (progress: OllamaPullProgress) => void
  ): void {
    try {
      const json = JSON.parse(rawLine)
      if (typeof json?.status !== 'string' || !json.status.trim()) {
        return
      }

      const completed =
        typeof json.completed === 'number' && Number.isFinite(json.completed)
          ? json.completed
          : undefined
      const total =
        typeof json.total === 'number' && Number.isFinite(json.total)
          ? json.total
          : undefined

      onProgress({
        status: json.status.trim(),
        completed,
        total,
      })
    } catch {
      // Ignore malformed JSON lines.
    }
  }
}
