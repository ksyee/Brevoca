import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron';
import { join } from 'path';
import { WhisperService } from './services/whisper';
import { OllamaService } from './services/ollama';
import { FasterWhisperService } from './services/faster-whisper';

let mainWindow: BrowserWindow | null = null;
let whisperService: WhisperService | null = null;
const ollamaService = new OllamaService();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0c0c14',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // Detect dev vs production
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// Window control IPC handlers
function setupWindowIPC(): void {
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });

  ipcMain.handle('dialog:selectAudioFile', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '오디오 파일 선택',
      filters: [
        { name: 'Audio Files', extensions: ['mp3', 'm4a', 'wav', 'ogg'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    return result.filePaths[0];
  });
}

// Whisper IPC handlers
function setupWhisperIPC(): void {
  ipcMain.handle('whisper:init', async (_event, modelName: string) => {
    try {
      whisperService = new WhisperService();
      await whisperService.init(modelName);
      return {
        success: true,
        runtime: whisperService.getRuntimeInfo(),
      };
    } catch (error: any) {
      console.error('Whisper init error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle(
    'whisper:transcribe',
    async (_event, pcmData: ArrayBuffer, lang: string, prompt?: string) => {
      if (!whisperService) {
        return { success: false, error: 'Whisper not initialized' };
      }
      try {
        const text = await whisperService.transcribe(pcmData, lang, prompt);
        return { success: true, text };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle(
    'whisper:transcribeFile',
    async (_event, filePath: string, lang: string, prompt?: string) => {
      if (!whisperService) {
        return { success: false, error: 'Whisper not initialized' };
      }
      try {
        const text = await whisperService.transcribeFile(
          filePath,
          lang,
          (progress, newText, startSeconds) => {
            if (mainWindow) {
              mainWindow.webContents.send(
                'whisper:fileProgress',
                progress,
                newText,
                startSeconds,
              );
            }
          },
          prompt,
        );
        return { success: true, text };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle('whisper:dispose', async () => {
    if (whisperService) {
      await whisperService.dispose();
      whisperService = null;
    }
    return { success: true };
  });
}

// Ollama IPC handlers
function setupOllamaIPC(): void {
  ipcMain.handle('ollama:check', async () => {
    return await ollamaService.checkConnection();
  });

  ipcMain.handle(
    'ollama:generate',
    async (event, transcript: string, model: string) => {
      try {
        await ollamaService.generateMinutes(
          transcript,
          model,
          (chunk: string) => {
            event.sender.send('ollama:chunk', chunk);
          },
        );
        event.sender.send('ollama:done');
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  );

  ipcMain.handle('ollama:models', async () => {
    return await ollamaService.getModels();
  });

  ipcMain.handle('ollama:pull', async (event, model: string) => {
    try {
      await ollamaService.pullModel(model, (progress) => {
        event.sender.send('ollama:pullProgress', progress);
      });
      event.sender.send('ollama:pullDone');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  });
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.brevoca.app');

  setupWindowIPC();
  setupWhisperIPC();
  setupOllamaIPC();

  createWindow();
  FasterWhisperService.warmup();
  ollamaService.warmup();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (whisperService) {
    void whisperService.dispose();
  }
  ollamaService.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
