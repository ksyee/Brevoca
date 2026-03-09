export interface WhisperRuntimeInfo {
  engine: 'faster-whisper' | 'whisper.cpp'
  backend: string
  gpuEnabled: boolean
  packageName?: string
  libVariant?: string
  pythonExecutable?: string
  workerScript?: string
  modelName?: string
  notes?: string[]
}

export interface TranscriptionBackend {
  init(modelName: string): Promise<void>
  transcribe(pcmData: ArrayBuffer | Uint8Array | Buffer, language?: string, prompt?: string): Promise<string>
  transcribeFile(
    filePath: string,
    language: string,
    onProgress: (progress: number, text: string, startSeconds?: number) => void,
    prompt?: string
  ): Promise<string>
  dispose(): void | Promise<void>
  getRuntimeInfo(): WhisperRuntimeInfo
}
