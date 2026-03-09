import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  // Window controls
  minimize: () => void
  maximize: () => void
  close: () => void

  // Whisper STT
  whisperInit: (modelName: string) => Promise<{
    success: boolean
    error?: string
    runtime?: {
      engine: string
      backend: string
      gpuEnabled: boolean
      packageName?: string
      libVariant?: string
      pythonExecutable?: string
      workerScript?: string
      modelName?: string
      notes?: string[]
    }
  }>
  whisperTranscribe: (pcmData: ArrayBuffer, lang: string, prompt?: string) => Promise<{ success: boolean; text?: string; error?: string }>
  whisperTranscribeFile: (filePath: string, lang: string, prompt?: string) => Promise<{ success: boolean; text?: string; error?: string }>
  whisperDispose: () => Promise<{ success: boolean }>

  onWhisperFileProgress: (callback: (progress: number, text: string, startSeconds?: number) => void) => void
  removeWhisperListeners: () => void

  selectAudioFile: () => Promise<string | null>

  // Ollama
  ollamaCheck: () => Promise<{ connected: boolean }>
  ollamaGenerate: (transcript: string, model: string) => Promise<{ success: boolean; error?: string }>
  ollamaModels: () => Promise<string[]>
  ollamaPullModel: (model: string) => Promise<{ success: boolean; error?: string }>
  onOllamaChunk: (callback: (chunk: string) => void) => void
  onOllamaDone: (callback: () => void) => void
  onOllamaPullProgress: (callback: (progress: { status: string; completed?: number; total?: number }) => void) => void
  onOllamaPullDone: (callback: () => void) => void
  removeOllamaListeners: () => void
  removeOllamaPullListeners: () => void
}

const electronAPI: ElectronAPI = {
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),

  // Whisper STT
  whisperInit: (modelName: string) => ipcRenderer.invoke('whisper:init', modelName),
  whisperTranscribe: (pcmData: ArrayBuffer, lang: string, prompt?: string) => ipcRenderer.invoke('whisper:transcribe', pcmData, lang, prompt),
  whisperTranscribeFile: (filePath: string, lang: string, prompt?: string) => ipcRenderer.invoke('whisper:transcribeFile', filePath, lang, prompt),
  whisperDispose: () => ipcRenderer.invoke('whisper:dispose'),

  onWhisperFileProgress: (callback: (progress: number, text: string, startSeconds?: number) => void) => {
    ipcRenderer.removeAllListeners('whisper:fileProgress')
    ipcRenderer.on('whisper:fileProgress', (_event, progress, text, startSeconds) =>
      callback(progress, text, startSeconds)
    )
  },
  removeWhisperListeners: () => {
    ipcRenderer.removeAllListeners('whisper:fileProgress')
  },

  selectAudioFile: () => ipcRenderer.invoke('dialog:selectAudioFile'),

  // Ollama
  ollamaCheck: () => ipcRenderer.invoke('ollama:check'),
  ollamaGenerate: (transcript: string, model: string) => ipcRenderer.invoke('ollama:generate', transcript, model),
  ollamaModels: () => ipcRenderer.invoke('ollama:models'),
  ollamaPullModel: (model: string) => ipcRenderer.invoke('ollama:pull', model),
  onOllamaChunk: (callback: (chunk: string) => void) => {
    ipcRenderer.on('ollama:chunk', (_event, chunk) => callback(chunk))
  },
  onOllamaDone: (callback: () => void) => {
    ipcRenderer.on('ollama:done', () => callback())
  },
  onOllamaPullProgress: (callback) => {
    ipcRenderer.removeAllListeners('ollama:pullProgress')
    ipcRenderer.on('ollama:pullProgress', (_event, progress) => callback(progress))
  },
  onOllamaPullDone: (callback: () => void) => {
    ipcRenderer.on('ollama:pullDone', () => callback())
  },
  removeOllamaListeners: () => {
    ipcRenderer.removeAllListeners('ollama:chunk')
    ipcRenderer.removeAllListeners('ollama:done')
  },
  removeOllamaPullListeners: () => {
    ipcRenderer.removeAllListeners('ollama:pullProgress')
    ipcRenderer.removeAllListeners('ollama:pullDone')
  },
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)
