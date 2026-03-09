import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import os from 'os'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'

// Setup ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path)

let whisperModule: any = null

const AVAILABLE_PARALLELISM =
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length
const CPU_THREAD_COUNT = Math.max(1, Math.min(8, AVAILABLE_PARALLELISM))
const CPU_PROCESSOR_COUNT = CPU_THREAD_COUNT >= 8 ? 2 : 1
const CPU_THREADS_PER_PROCESSOR = Math.max(1, Math.floor(CPU_THREAD_COUNT / CPU_PROCESSOR_COUNT))

export class WhisperService {
  private context: any = null
  private modelPath: string = ''

  async init(modelName: string = 'base'): Promise<void> {
    // Release previous context if exists
    this.dispose()
    // Dynamically import whisper.node
    if (!whisperModule) {
      try {
        whisperModule = require('@fugood/whisper.node')
      } catch (e) {
        console.error('Failed to load @fugood/whisper.node:', e)
        throw new Error('whisper.node 모듈을 로드할 수 없습니다. npm install을 다시 실행해 주세요.')
      }
    }

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

    // Initialize whisper context using the correct API
    console.log(`Loading Whisper model from: ${this.modelPath}`)
    this.context = await whisperModule.initWhisper({
      filePath: this.modelPath,
      useGpu: false,
    })
    console.log('Whisper model loaded successfully')
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
        bestOf: 1,
        beamSize: 1,
        maxLen: 0,
        translate: false,
        temperature: 0.0,
      }
      if (prompt) {
        options.prompt = prompt
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
    onProgress: (progress: number, text: string) => void
  ): Promise<string> {
    if (!this.context) {
      throw new Error('Whisper not initialized. Call init() first.')
    }

    return new Promise((resolve, reject) => {
      const SAMPLE_RATE = 16000
      const CHUNK_DURATION_SEC = 30
      const BYTES_PER_SAMPLE = 2 // 16-bit PCM
      const CHUNK_BYTE_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHUNK_DURATION_SEC

      let audioStream: Buffer[] = []
      let totalBytesReceived = 0
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
              const buffer = chunkToProcess.buffer.slice(
                chunkToProcess.byteOffset,
                chunkToProcess.byteOffset + chunkToProcess.byteLength
              )

              const prompt = fullTranscript.slice(-2).join(' ')
              const { promise } = this.context.transcribeData(buffer, {
                language,
                maxThreads: CPU_THREADS_PER_PROCESSOR,
                nProcessors: CPU_PROCESSOR_COUNT,
                bestOf: 1,
                beamSize: 1,
                maxLen: 0,
                translate: false,
                temperature: 0.0,
                prompt: prompt || undefined,
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
                  onProgress(progress, text)
                } else {
                  onProgress(-1, text)
                }
              }
            })
          }
        })

        ffStream.on('end', () => {
          processPromise = processPromise.then(async () => {
            // Process any remaining audio
            if (audioStream.length > 0) {
              const merged = Buffer.concat(audioStream)
              if (merged.length > 0) {
                const buffer = merged.buffer.slice(
                  merged.byteOffset,
                  merged.byteOffset + merged.byteLength
                )

                const prompt = fullTranscript.slice(-2).join(' ')
                const { promise } = this.context.transcribeData(buffer, {
                  language,
                  maxThreads: CPU_THREADS_PER_PROCESSOR,
                  nProcessors: CPU_PROCESSOR_COUNT,
                  bestOf: 1,
                  beamSize: 1,
                  maxLen: 0,
                  translate: false,
                  temperature: 0.0,
                  prompt: prompt || undefined,
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
                    onProgress(100, text)
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
        this.context.release()
      } catch (e) {
        // ignore cleanup errors
      }
      this.context = null
    }
  }
}
