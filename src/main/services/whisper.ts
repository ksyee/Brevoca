import { FasterWhisperService } from './faster-whisper'
import type { TranscriptionBackend, WhisperRuntimeInfo } from './transcription-backend'
import { WhisperCppService } from './whisper-cpp'

type EngineName = 'faster-whisper' | 'whisper.cpp'

export class WhisperService implements TranscriptionBackend {
  private activeBackend: TranscriptionBackend | null = null
  private runtimeInfo: WhisperRuntimeInfo = {
    engine: 'whisper.cpp',
    backend: 'cpu',
    gpuEnabled: false,
    notes: [],
  }

  async init(modelName: string = 'small'): Promise<void> {
    await this.dispose()

    const initErrors: string[] = []
    for (const engine of this.getEngineOrder()) {
      if (engine === 'whisper.cpp' && !this.supportsWhisperCppModel(modelName)) {
        initErrors.push(`whisper.cpp 실패: 모델 ${modelName}은 faster-whisper 백엔드에서만 지원됩니다`)
        continue
      }

      const backend = this.createBackend(engine)
      try {
        await backend.init(modelName)
        this.activeBackend = backend
        this.runtimeInfo = {
          ...backend.getRuntimeInfo(),
          modelName,
          notes: [...(backend.getRuntimeInfo().notes ?? []), ...initErrors],
        }
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        initErrors.push(`${engine} 실패: ${message}`)
        await Promise.resolve(backend.dispose())
      }
    }

    throw new Error(`사용 가능한 STT 백엔드가 없습니다. ${initErrors.join(' | ')}`)
  }

  async transcribe(
    pcmData: ArrayBuffer | Uint8Array | Buffer,
    language: string = 'ko',
    prompt?: string
  ): Promise<string> {
    this.ensureBackend()
    return this.activeBackend!.transcribe(pcmData, language, prompt)
  }

  async transcribeFile(
    filePath: string,
    language: string,
    onProgress: (progress: number, text: string, startSeconds?: number) => void,
    prompt?: string
  ): Promise<string> {
    this.ensureBackend()
    return this.activeBackend!.transcribeFile(filePath, language, onProgress, prompt)
  }

  async dispose(): Promise<void> {
    if (this.activeBackend) {
      await Promise.resolve(this.activeBackend.dispose())
      this.activeBackend = null
    }

    this.runtimeInfo = {
      engine: 'whisper.cpp',
      backend: 'cpu',
      gpuEnabled: false,
      notes: [],
    }
  }

  getRuntimeInfo(): WhisperRuntimeInfo {
    return this.runtimeInfo
  }

  private createBackend(engine: EngineName): TranscriptionBackend {
    if (engine === 'faster-whisper') {
      return new FasterWhisperService()
    }

    return new WhisperCppService()
  }

  private getEngineOrder(): EngineName[] {
    const preferredEngine = process.env.SCRIBA_STT_ENGINE?.trim().toLowerCase()

    if (!preferredEngine || preferredEngine === 'auto') {
      return ['faster-whisper', 'whisper.cpp']
    }

    if (preferredEngine === 'faster-whisper' || preferredEngine === 'python') {
      return ['faster-whisper']
    }

    if (preferredEngine === 'whisper.cpp' || preferredEngine === 'cpp') {
      return ['whisper.cpp']
    }

    console.warn(`Unknown SCRIBA_STT_ENGINE=${preferredEngine}, falling back to auto`)
    return ['faster-whisper', 'whisper.cpp']
  }

  private ensureBackend(): void {
    if (!this.activeBackend) {
      throw new Error('Whisper not initialized. Call init() first.')
    }
  }

  private supportsWhisperCppModel(modelName: string): boolean {
    return ['tiny', 'base', 'small', 'medium'].includes(modelName)
  }
}
