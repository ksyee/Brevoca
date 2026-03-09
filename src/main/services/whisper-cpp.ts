import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import type { TranscriptionBackend, WhisperRuntimeInfo } from './transcription-backend'

// Setup ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path)

type WhisperLibVariant = 'default' | 'vulkan' | 'cuda'
type WhisperBackend = 'cpu' | 'metal' | 'vulkan' | 'cuda'

interface WhisperBackendCandidate {
  backend: WhisperBackend
  packageName: string
  libVariant: WhisperLibVariant
  useGpu: boolean
}

const whisperModuleCache = new Map<string, any>()

const AVAILABLE_PARALLELISM =
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
const CPU_THREAD_COUNT = Math.max(1, Math.min(8, AVAILABLE_PARALLELISM))
const CPU_PROCESSOR_COUNT = CPU_THREAD_COUNT >= 8 ? 2 : 1
const CPU_THREADS_PER_PROCESSOR = Math.max(1, Math.floor(CPU_THREAD_COUNT / CPU_PROCESSOR_COUNT))
const REALTIME_BEST_OF = 3
const REALTIME_BEAM_SIZE = 4
const FILE_BEST_OF = 4
const FILE_BEAM_SIZE = 5
const MAX_PROMPT_LENGTH = 160

export class WhisperCppService implements TranscriptionBackend {
  private context: any = null
  private modelPath: string = ''
  private runtimeInfo: WhisperRuntimeInfo = this.createDefaultRuntimeInfo()

  async init(modelName: string = 'small'): Promise<void> {
    // Release previous context if exists
    this.dispose()
    this.runtimeInfo = this.createDefaultRuntimeInfo()

    // Set model path in app data directory
    const modelsDir = path.join(app.getPath('userData'), 'models')
    if (!fs.existsSync(modelsDir)) {
      fs.mkdirSync(modelsDir, { recursive: true })
    }

    const modelFileName = `ggml-${modelName}.bin`
    this.modelPath = path.join(modelsDir, modelFileName)

    // Download model if not exists
    if (!fs.existsSync(this.modelPath)) {
      console.log(`Downloading Whisper model: ${modelName}...`)
      await this.downloadModel(modelName, this.modelPath)
    }

    console.log(`Loading Whisper model from: ${this.modelPath}`)

    const initErrors: string[] = []
    for (const candidate of this.getBackendCandidates()) {
      try {
        const module = this.loadWhisperBackendModule(candidate.packageName)
        this.context = new module.WhisperContext({
          filePath: this.modelPath,
          useGpu: candidate.useGpu,
        })
        this.runtimeInfo = {
          engine: 'whisper.cpp',
          backend: candidate.backend,
          gpuEnabled: candidate.useGpu,
          packageName: candidate.packageName,
          libVariant: candidate.libVariant,
          modelName,
        }
        console.log(
          `Whisper model loaded successfully with backend=${candidate.backend}, gpu=${candidate.useGpu}`
        )
        return
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        initErrors.push(`${candidate.backend}: ${message}`)
        this.context = null
        console.warn(`Failed to initialize Whisper backend ${candidate.backend}:`, error)
      }
    }

    throw new Error(`Whisper 초기화에 실패했습니다. 시도한 백엔드: ${initErrors.join(' | ')}`)
  }

  private async downloadModel(modelName: string, destPath: string): Promise<void> {
    const modelUrls: Record<string, string> = {
      'tiny': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
      'base': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
      'small': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
      'medium': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    }

    const url = modelUrls[modelName]
    if (!url) {
      throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(modelUrls).join(', ')}`)
    }

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download model: ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    fs.writeFileSync(destPath, Buffer.from(buffer))
    console.log(`Model downloaded to: ${destPath}`)
  }

  async transcribe(pcmData: any, language: string = 'ko', prompt?: string): Promise<string> {
    if (!this.context) {
      throw new Error('Whisper not initialized. Call init() first.')
    }

    try {
      // Electron IPC often converts ArrayBuffer to Uint8Array/Buffer in the main process.
      // @fugood/whisper.node strictly expects an ArrayBuffer.
      let bufferToProcess = pcmData
      if (Buffer.isBuffer(pcmData) || pcmData instanceof Uint8Array) {
        bufferToProcess = pcmData.buffer.slice(pcmData.byteOffset, pcmData.byteOffset + pcmData.byteLength)
      } else if (pcmData && pcmData.buffer instanceof ArrayBuffer) {
        bufferToProcess = pcmData.buffer
      }

      // transcribeData returns { stop, promise }
      const options: any = {
        language,
        maxThreads: CPU_THREADS_PER_PROCESSOR,
        nProcessors: CPU_PROCESSOR_COUNT,
        bestOf: REALTIME_BEST_OF,
        beamSize: REALTIME_BEAM_SIZE,
        maxLen: 0,
        translate: false,
        temperature: 0.0,
      }
      if (prompt) {
        options.prompt = this.buildPrompt(prompt)
      }

      const { promise } = this.context.transcribeData(bufferToProcess, options)

      const result = await promise

      if (result) {
        if (typeof result.result === 'string') {
          return result.result.trim()
        } else if (result.segments && Array.isArray(result.segments)) {
          return result.segments.map((segment: any) => segment.text).join(' ').trim()
        }
      }
      return ''
    } catch (error) {
      console.error('Transcription error:', error)
      throw error
    }
  }

  async transcribeFile(
    filePath: string,
    language: string = 'ko',
    onProgress: (progress: number, text: string, startSeconds?: number) => void,
    prompt?: string
  ): Promise<string> {
    if (!this.context) {
      throw new Error('Whisper not initialized. Call init() first.')
    }

    return new Promise((resolve, reject) => {
      const SAMPLE_RATE = 16000
      const CHUNK_DURATION_SEC = 30
      const BYTES_PER_SAMPLE = 2 // 16-bit PCM
      const CHUNK_BYTE_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_DURATION_SEC
      const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE

      let audioStream: Buffer[] = []
      let totalBytesReceived = 0
      let processedBytes = 0
      // Track accumulated buffer length with a counter instead of reduce() on every data event
      let currentBufferLength = 0
      let fullTranscript: string[] = []

      // To calculate progress, we need file duration
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        let durationSec = 0
        if (!err && metadata && metadata.format && metadata.format.duration) {
          durationSec = metadata.format.duration
        }

        const command = ffmpeg(filePath)
          .noVideo()
          .audioChannels(1)
          .audioFrequency(SAMPLE_RATE)
          .audioCodec('pcm_s16le')
          .format('s16le')
          .on('error', (err) => {
            console.error('FFmpeg decoding error:', err)
            reject(err)
          })

        const ffStream = command.pipe()
        let processPromise = Promise.resolve()

        ffStream.on('data', (chunk: Buffer) => {
          audioStream.push(chunk)
          totalBytesReceived += chunk.length
          currentBufferLength += chunk.length

          if (currentBufferLength >= CHUNK_BYTE_SIZE) {
            // Extract exactly one chunk
            const merged = Buffer.concat(audioStream)
            const chunkToProcess = merged.slice(0, CHUNK_BYTE_SIZE)
            const remainder = merged.slice(CHUNK_BYTE_SIZE)
            audioStream = [remainder]
            currentBufferLength = remainder.length

            processPromise = processPromise.then(async () => {
              const chunkStartSeconds = processedBytes / BYTES_PER_SECOND
              const buffer = chunkToProcess.buffer.slice(
                chunkToProcess.byteOffset,
                chunkToProcess.byteOffset + chunkToProcess.byteLength
              )

              const chunkPrompt = [prompt, fullTranscript.slice(-2).join(' ')].filter(Boolean).join(' ')
              const { promise } = this.context.transcribeData(buffer, {
                language,
                maxThreads: CPU_THREADS_PER_PROCESSOR,
                nProcessors: CPU_PROCESSOR_COUNT,
                bestOf: FILE_BEST_OF,
                beamSize: FILE_BEAM_SIZE,
                maxLen: 0,
                translate: false,
                temperature: 0.0,
                prompt: this.buildPrompt(chunkPrompt),
              })

              const result = await promise
              if (result) {
                let text = ''
                if (typeof result.result === 'string') {
                  text = result.result.trim()
                } else if (result.segments && Array.isArray(result.segments)) {
                  text = result.segments.map((s: any) => s.text).join(' ').trim()
                }

                if (text) {
                  fullTranscript.push(text)
                }

                if (durationSec > 0) {
                  // Approximate progress based on bytes processed vs expected total
                  const expectedTotalBytes = durationSec * SAMPLE_RATE * BYTES_PER_SAMPLE
                  const progress = Math.min(100, Math.round((totalBytesReceived / expectedTotalBytes) * 100))
                  onProgress(progress, text, chunkStartSeconds)
                } else {
                  onProgress(-1, text, chunkStartSeconds)
                }
              }

              processedBytes += chunkToProcess.length
            })
          }
        })

        ffStream.on('end', () => {
          processPromise = processPromise.then(async () => {
            // Process any remaining audio
            if (audioStream.length > 0) {
              const merged = Buffer.concat(audioStream)
              if (merged.length > 0) {
                const chunkStartSeconds = processedBytes / BYTES_PER_SECOND
                const buffer = merged.buffer.slice(
                  merged.byteOffset,
                  merged.byteOffset + merged.byteLength
                )

                const chunkPrompt = [prompt, fullTranscript.slice(-2).join(' ')].filter(Boolean).join(' ')
                const { promise } = this.context.transcribeData(buffer, {
                  language,
                  maxThreads: CPU_THREADS_PER_PROCESSOR,
                  nProcessors: CPU_PROCESSOR_COUNT,
                  bestOf: FILE_BEST_OF,
                  beamSize: FILE_BEAM_SIZE,
                  maxLen: 0,
                  translate: false,
                  temperature: 0.0,
                  prompt: this.buildPrompt(chunkPrompt),
                })

                const result = await promise
                if (result) {
                  let text = ''
                  if (typeof result.result === 'string') {
                    text = result.result.trim()
                  } else if (result.segments && Array.isArray(result.segments)) {
                    text = result.segments.map((s: any) => s.text).join(' ').trim()
                  }

                  if (text) {
                    fullTranscript.push(text)
                    onProgress(100, text, chunkStartSeconds)
                  }
                }
              }
            }
            resolve(fullTranscript.join('\n'))
          }).catch(reject)
        })
      })
    })
  }

  dispose(): void {
    if (this.context) {
      try {
        const releaseResult = this.context.release()
        if (releaseResult && typeof releaseResult.then === 'function') {
          releaseResult.catch(() => {
            // ignore cleanup errors
          })
        }
      } catch (e) {
        // ignore cleanup errors
      }
      this.context = null
    }
    this.runtimeInfo = this.createDefaultRuntimeInfo()
  }

  getRuntimeInfo(): WhisperRuntimeInfo {
    return this.runtimeInfo
  }

  private buildPrompt(prompt?: string): string | undefined {
    if (!prompt) {
      return undefined
    }

    const normalized = prompt.replace(/\s+/g, ' ').trim()
    if (!normalized) {
      return undefined
    }

    return normalized.slice(-MAX_PROMPT_LENGTH)
  }

  private getBackendCandidates(): WhisperBackendCandidate[] {
    const packageBase = `@fugood/node-whisper-${process.platform}-${process.arch}`
    const preferredBackend = process.env.SCRIBA_WHISPER_BACKEND?.trim().toLowerCase()

    const candidates: WhisperBackendCandidate[] = []

    if (process.platform === 'darwin' && process.arch === 'arm64') {
      candidates.push({
        backend: 'metal',
        packageName: packageBase,
        libVariant: 'default',
        useGpu: true,
      })
    } else if (process.platform === 'win32' || process.platform === 'linux') {
      if (process.arch === 'x64' || process.platform === 'linux') {
        candidates.push({
          backend: 'cuda',
          packageName: `${packageBase}-cuda`,
          libVariant: 'cuda',
          useGpu: true,
        })
      }

      candidates.push({
        backend: 'vulkan',
        packageName: `${packageBase}-vulkan`,
        libVariant: 'vulkan',
        useGpu: true,
      })
    }

    candidates.push({
      backend: 'cpu',
      packageName: packageBase,
      libVariant: 'default',
      useGpu: false,
    })

    if (!preferredBackend || preferredBackend === 'auto') {
      return this.dedupeBackendCandidates(candidates)
    }

    const preferred = candidates.find((candidate) => candidate.backend === preferredBackend)
    if (!preferred) {
      console.warn(`Unknown SCRIBA_WHISPER_BACKEND=${preferredBackend}, falling back to auto`)
      return this.dedupeBackendCandidates(candidates)
    }

    const fallbackCpu = candidates.find((candidate) => candidate.backend === 'cpu')
    return this.dedupeBackendCandidates([preferred, ...(fallbackCpu ? [fallbackCpu] : [])])
  }

  private dedupeBackendCandidates(candidates: WhisperBackendCandidate[]): WhisperBackendCandidate[] {
    const seen = new Set<string>()
    return candidates.filter((candidate) => {
      const key = `${candidate.backend}:${candidate.packageName}:${candidate.useGpu}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }

  private loadWhisperBackendModule(packageName: string): any {
    const cached = whisperModuleCache.get(packageName)
    if (cached) {
      return cached
    }

    try {
      const loadedModule = require(packageName)
      whisperModuleCache.set(packageName, loadedModule)
      return loadedModule
    } catch (error) {
      throw new Error(`${packageName} 로드 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  private createDefaultRuntimeInfo(): WhisperRuntimeInfo {
    return {
      engine: 'whisper.cpp',
      backend: 'cpu',
      gpuEnabled: false,
      packageName: '',
      libVariant: 'default',
    }
  }
}
