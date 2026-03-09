import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import type { TranscriptionBackend, WhisperRuntimeInfo } from './transcription-backend'

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  onProgress?: (progress: number, text: string, startSeconds?: number) => void
}

interface WorkerMessage {
  id?: number
  event?: string
  request_id?: number
  success?: boolean
  error?: string
  result?: any
  progress?: number
  text?: string
  start_seconds?: number
  traceback?: string
}

export class FasterWhisperService implements TranscriptionBackend {
  private static dependencyBootstrapPromise: Promise<void> | null = null
  private static dependencyBootstrapError: Error | null = null
  private static dependencyState: 'idle' | 'checking' | 'ready' | 'failed' = 'idle'
  private static pythonRuntimePathEntries: string[] = []

  private workerProcess: ChildProcessWithoutNullStreams | null = null
  private pendingRequests = new Map<number, PendingRequest>()
  private nextRequestId = 1
  private stdoutBuffer = ''
  private runtimeInfo: WhisperRuntimeInfo = {
    engine: 'faster-whisper',
    backend: 'cpu',
    gpuEnabled: false,
    notes: [],
  }

  async init(modelName: string = 'small'): Promise<void> {
    await FasterWhisperService.ensurePythonDependenciesReady()
    await this.ensureWorkerProcess()
    const response = await this.sendRequest('init', { modelName })
    this.runtimeInfo = {
      engine: 'faster-whisper',
      backend: response.runtime?.backend ?? 'cpu',
      gpuEnabled: Boolean(response.runtime?.gpuEnabled),
      pythonExecutable: this.getPythonExecutable(),
      workerScript: this.resolveWorkerScriptPath(),
      modelName,
      notes: response.runtime?.notes ?? this.buildDependencyNotes(),
    }
  }

  async transcribe(
    pcmData: ArrayBuffer | Uint8Array | Buffer,
    language: string = 'ko',
    prompt?: string
  ): Promise<string> {
    await this.ensureWorkerProcess()

    const buffer = this.toBuffer(pcmData)
    const response = await this.sendRequest('transcribe_chunk', {
      audioBase64: buffer.toString('base64'),
      language,
      prompt,
    })

    return typeof response.text === 'string' ? response.text.trim() : ''
  }

  async transcribeFile(
    filePath: string,
    language: string,
    onProgress: (progress: number, text: string, startSeconds?: number) => void,
    prompt?: string
  ): Promise<string> {
    await this.ensureWorkerProcess()

    const response = await this.sendRequest(
      'transcribe_file',
      {
        filePath,
        language,
        prompt,
      },
      onProgress
    )

    return typeof response.text === 'string' ? response.text.trim() : ''
  }

  dispose(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Python STT worker was disposed'))
    }
    this.pendingRequests.clear()

    if (this.workerProcess) {
      this.workerProcess.stdin.end()
      this.workerProcess.kill()
      this.workerProcess = null
    }

    this.stdoutBuffer = ''
    this.runtimeInfo = {
      engine: 'faster-whisper',
      backend: 'cpu',
      gpuEnabled: false,
      notes: [],
    }
  }

  getRuntimeInfo(): WhisperRuntimeInfo {
    return this.runtimeInfo
  }

  static warmup(): void {
    void this.ensurePythonDependenciesReady().catch((error) => {
      console.warn('Failed to warm up faster-whisper dependencies:', error)
    })
  }

  static async ensurePythonDependenciesReady(): Promise<void> {
    if (this.dependencyState === 'ready') {
      return
    }

    if (this.dependencyBootstrapPromise) {
      return this.dependencyBootstrapPromise
    }

    this.dependencyBootstrapPromise = (async () => {
      this.dependencyState = 'checking'
      this.dependencyBootstrapError = null

      const pythonExecutable = process.env.SCRIBA_PYTHON_PATH?.trim() || 'python'
      const requirementsPath = this.resolveRequirementsPath()

      const dependenciesInstalled = await this.runPythonCommand(
        pythonExecutable,
        ['-c', 'import numpy, faster_whisper, ctranslate2, onnxruntime'],
        { label: 'python dependency check' }
      )

      if (!dependenciesInstalled.ok) {
        console.log('Installing Python STT dependencies...')

        const installArgs = ['-m', 'pip', 'install', '-r', requirementsPath]
        if (!process.env.VIRTUAL_ENV) {
          installArgs.push('--user')
        }
        installArgs.push('--disable-pip-version-check', '--no-warn-script-location')

        const installResult = await this.runPythonCommand(pythonExecutable, installArgs, {
          label: 'python dependency install',
          timeoutMs: 10 * 60 * 1000,
        })

        if (!installResult.ok) {
          throw new Error(
            `Python STT 의존성 자동 설치 실패: ${installResult.stderr || installResult.stdout || 'unknown error'}`
          )
        }
      }

      const verifyResult = await this.runPythonCommand(
        pythonExecutable,
        ['-c', 'import numpy, faster_whisper, ctranslate2, onnxruntime'],
        { label: 'python dependency verify' }
      )

      if (!verifyResult.ok) {
        throw new Error(
          `Python STT 의존성 검증 실패: ${verifyResult.stderr || verifyResult.stdout || 'unknown error'}`
        )
      }

      await this.ensureCudaRuntimePackages(pythonExecutable)

      this.dependencyState = 'ready'
    })()
      .catch((error) => {
        this.dependencyState = 'failed'
        this.dependencyBootstrapError = error instanceof Error ? error : new Error(String(error))
        throw this.dependencyBootstrapError
      })
      .finally(() => {
        this.dependencyBootstrapPromise = null
      })

    return this.dependencyBootstrapPromise
  }

  private async ensureWorkerProcess(): Promise<void> {
    if (this.workerProcess) {
      return
    }

    const workerScript = this.resolveWorkerScriptPath()
    const pythonExecutable = this.getPythonExecutable()

    await new Promise<void>((resolve, reject) => {
      const worker = spawn(pythonExecutable, ['-u', workerScript], {
        cwd: path.dirname(workerScript),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: FasterWhisperService.buildPythonEnv(),
      })

      let resolved = false
      let stderrBuffer = ''

      worker.stdout.on('data', (chunk: Buffer) => {
        this.handleWorkerStdout(chunk.toString('utf8'))
      })

      worker.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8')
        stderrBuffer += text
        console.warn('[faster-whisper-worker]', text.trim())
      })

      worker.once('error', (error) => {
        if (!resolved) {
          reject(new Error(`Python worker spawn failed: ${error.message}`))
          return
        }
        this.handleWorkerCrash(new Error(`Python worker error: ${error.message}`))
      })

      worker.once('spawn', () => {
        if (resolved) {
          return
        }
        resolved = true
        this.workerProcess = worker
        this.attachWorkerListeners(worker)
        resolve()
      })

      worker.once('exit', (code, signal) => {
        const crashError = new Error(
          `Python worker exited before initialization (code=${code}, signal=${signal ?? 'none'}). ${stderrBuffer.trim()}`
        )
        if (!resolved) {
          reject(crashError)
          return
        }
        this.handleWorkerCrash(crashError)
      })

      setTimeout(() => {
        if (!resolved) {
          reject(new Error('Python worker startup timed out'))
          worker.kill()
        }
      }, 2000)
    })
  }

  private attachWorkerListeners(worker: ChildProcessWithoutNullStreams): void {
    worker.stdout.removeAllListeners('data')
    worker.stderr.removeAllListeners('data')

    worker.stdout.on('data', (chunk: Buffer) => {
      this.handleWorkerStdout(chunk.toString('utf8'))
    })

    worker.stderr.on('data', (chunk: Buffer) => {
      console.warn('[faster-whisper-worker]', chunk.toString('utf8').trim())
    })

    worker.on('error', (error) => {
      this.handleWorkerCrash(new Error(`Python worker error: ${error.message}`))
    })

    worker.on('exit', (code, signal) => {
      this.handleWorkerCrash(
        new Error(`Python worker exited unexpectedly (code=${code}, signal=${signal ?? 'none'})`)
      )
    })
  }

  private handleWorkerStdout(chunk: string): void {
    this.stdoutBuffer += chunk

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf('\n')
      if (newlineIndex === -1) {
        break
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1)

      if (!line) {
        continue
      }

      let message: WorkerMessage
      try {
        message = JSON.parse(line)
      } catch (error) {
        console.warn('Failed to parse faster-whisper worker output:', line, error)
        continue
      }

      this.handleWorkerMessage(message)
    }
  }

  private handleWorkerMessage(message: WorkerMessage): void {
    if (message.event === 'startup_error') {
      this.handleWorkerCrash(new Error(message.error || 'Python worker startup failed'))
      return
    }

    if (message.event === 'file_progress' && typeof message.request_id === 'number') {
      const pending = this.pendingRequests.get(message.request_id)
      pending?.onProgress?.(message.progress ?? -1, message.text ?? '', message.start_seconds)
      return
    }

    if (typeof message.id !== 'number') {
      return
    }

    const pending = this.pendingRequests.get(message.id)
    if (!pending) {
      return
    }

    this.pendingRequests.delete(message.id)

    if (message.success) {
      pending.resolve(message.result)
      return
    }

    pending.reject(new Error(message.error || 'Unknown Python worker error'))
  }

  private handleWorkerCrash(error: Error): void {
    if (!this.workerProcess) {
      return
    }

    this.workerProcess = null

    for (const pending of this.pendingRequests.values()) {
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private sendRequest(
    type: string,
    payload: Record<string, unknown>,
    onProgress?: (progress: number, text: string, startSeconds?: number) => void
  ): Promise<any> {
    if (!this.workerProcess) {
      return Promise.reject(new Error('Python STT worker is not running'))
    }

    const id = this.nextRequestId++

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject, onProgress })

      const body = JSON.stringify({
        id,
        type,
        ...payload,
      })

      this.workerProcess?.stdin.write(body + '\n', 'utf8', (error) => {
        if (!error) {
          return
        }
        this.pendingRequests.delete(id)
        reject(error)
      })
    })
  }

  private resolveWorkerScriptPath(): string {
    const candidates = [
      path.join(app.getAppPath(), 'python', 'whisper_worker.py'),
      path.resolve(app.getAppPath(), '..', 'python', 'whisper_worker.py'),
      path.resolve(app.getAppPath(), '..', '..', 'python', 'whisper_worker.py'),
      path.join(process.cwd(), 'python', 'whisper_worker.py'),
      path.join(__dirname, '..', '..', '..', 'python', 'whisper_worker.py'),
    ]

    const existingPath = candidates.find((candidate) => fs.existsSync(candidate))
    if (!existingPath) {
      throw new Error('Python STT worker script not found (python/whisper_worker.py)')
    }

    return existingPath
  }

  private getPythonExecutable(): string {
    return process.env.SCRIBA_PYTHON_PATH?.trim() || 'python'
  }

  private buildDependencyNotes(): string[] {
    const notes: string[] = []
    if (FasterWhisperService.dependencyState === 'ready') {
      notes.push('python-deps-ready')
    }
    if (FasterWhisperService.dependencyBootstrapError) {
      notes.push(FasterWhisperService.dependencyBootstrapError.message)
    }
    return notes
  }

  private static resolveRequirementsPath(): string {
    const candidates = [
      path.join(app.getAppPath(), 'python', 'requirements-stt.txt'),
      path.resolve(app.getAppPath(), '..', 'python', 'requirements-stt.txt'),
      path.resolve(app.getAppPath(), '..', '..', 'python', 'requirements-stt.txt'),
      path.join(process.cwd(), 'python', 'requirements-stt.txt'),
      path.join(__dirname, '..', '..', '..', 'python', 'requirements-stt.txt'),
    ]

    const existingPath = candidates.find((candidate) => fs.existsSync(candidate))
    if (!existingPath) {
      throw new Error('Python requirements file not found (python/requirements-stt.txt)')
    }

    return existingPath
  }

  private static runPythonCommand(
    pythonExecutable: string,
    args: string[],
    options?: { label?: string; timeoutMs?: number }
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(pythonExecutable, args, {
        cwd: process.cwd(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.buildPythonEnv(),
      })

      let stdout = ''
      let stderr = ''
      let settled = false
      const timeoutMs = options?.timeoutMs ?? 30_000

      const timer = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        child.kill()
        reject(new Error(`${options?.label || 'python command'} timed out`))
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })

      child.once('error', (error) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        reject(error)
      })

      child.once('exit', (code) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        resolve({
          ok: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        })
      })
    })
  }

  private static async ensureCudaRuntimePackages(pythonExecutable: string): Promise<void> {
    const cudaCheck = await this.runPythonCommand(
      pythonExecutable,
      ['-c', 'import ctranslate2; print(ctranslate2.get_cuda_device_count())'],
      { label: 'cuda device check' }
    )

    if (!cudaCheck.ok || Number.parseInt(cudaCheck.stdout, 10) <= 0) {
      this.pythonRuntimePathEntries = []
      return
    }

    const runtimeCheck = await this.runPythonCommand(
      pythonExecutable,
      [
        '-c',
        [
          'import importlib.metadata as md',
          'from importlib.metadata import PackageNotFoundError',
          'pkgs=("nvidia-cublas-cu12","nvidia-cudnn-cu12")',
          'missing=[]',
          'for pkg in pkgs:',
          '    try:',
          '        md.distribution(pkg)',
          '    except PackageNotFoundError:',
          '        missing.append(pkg)',
          'print("|".join(missing))',
        ].join('\n'),
      ],
      { label: 'cuda runtime package check' }
    )

    if (!runtimeCheck.ok) {
      throw new Error(runtimeCheck.stderr || runtimeCheck.stdout || 'CUDA runtime package check failed')
    }

    const missingPackages = runtimeCheck.stdout
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)

    if (missingPackages.length > 0) {
      console.log('Installing NVIDIA CUDA runtime packages for faster-whisper...')

      const pipPackages = missingPackages.map((moduleName) =>
        moduleName === 'nvidia.cublas.lib' ? 'nvidia-cublas-cu12' : 'nvidia-cudnn-cu12'
      )

      const installArgs = ['-m', 'pip', 'install', ...pipPackages]
      if (!process.env.VIRTUAL_ENV) {
        installArgs.push('--user')
      }
      installArgs.push('--disable-pip-version-check', '--no-warn-script-location')

      const installResult = await this.runPythonCommand(pythonExecutable, installArgs, {
        label: 'cuda runtime package install',
        timeoutMs: 10 * 60 * 1000,
      })

      if (!installResult.ok) {
        throw new Error(
          `CUDA runtime package install failed: ${installResult.stderr || installResult.stdout || 'unknown error'}`
        )
      }
    }

    const runtimePathResult = await this.runPythonCommand(
      pythonExecutable,
      [
        '-c',
        [
          'import importlib.metadata as md',
          'import pathlib',
          'pairs=(',
          '    ("nvidia-cublas-cu12", "nvidia/cublas/bin"),',
          '    ("nvidia-cudnn-cu12", "nvidia/cudnn/bin"),',
          ')',
          'paths=[]',
          'for pkg, rel_path in pairs:',
          '    dist = md.distribution(pkg)',
          '    paths.append(str(pathlib.Path(dist.locate_file(rel_path)).resolve()))',
          'print("\\n".join(paths))',
        ].join('\n'),
      ],
      { label: 'cuda runtime path resolve' }
    )

    if (!runtimePathResult.ok) {
      throw new Error(
        `CUDA runtime path resolve failed: ${runtimePathResult.stderr || runtimePathResult.stdout || 'unknown error'}`
      )
    }

    this.pythonRuntimePathEntries = runtimePathResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }

  private static buildPythonEnv(): NodeJS.ProcessEnv {
    const pathEntries = [...this.pythonRuntimePathEntries]
    if (process.env.PATH) {
      pathEntries.push(process.env.PATH)
    }

    return {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PATH: pathEntries.join(path.delimiter),
    }
  }

  private toBuffer(value: ArrayBuffer | Uint8Array | Buffer): Buffer {
    if (Buffer.isBuffer(value)) {
      return value
    }

    if (value instanceof Uint8Array) {
      return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
    }

    return Buffer.from(value)
  }
}
