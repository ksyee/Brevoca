import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { TitleBar } from "./components/title-bar";
import { RecordingControl } from "./components/recording-control";
import { TranscriptPanel } from "./components/transcript-panel";
import { MinutesPanel } from "./components/minutes-panel";
import { StatusBar } from "./components/status-bar";
import { Settings, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Audio processing constants
const SAMPLE_RATE = 16000;
const CHUNK_DURATION_SEC = 3; // Keep realtime latency low now that GPU decoding is available
// Pre-allocated ring buffer: 10 seconds at 96kHz (generous upper bound)
const AUDIO_RING_BUFFER_SIZE = 96000 * 10;
// Hard cap to prevent unbounded renderer memory growth if Whisper falls behind.
const MAX_AUDIO_RING_BUFFER_SIZE = 96000 * 30;
const AUDIO_WORKLET_CHUNK_SIZE = 2048;
const audioCaptureWorkletUrl = new URL("../worklets/audio-capture.worklet.js", import.meta.url);
const DEFAULT_OLLAMA_MODEL = "qwen2.5:3b";
const RECOMMENDED_OLLAMA_MODELS = [
  { id: "qwen2.5:7b-instruct", label: "qwen2.5:7b-instruct (저사양)" },
  { id: "qwen2.5:14b", label: "qwen2.5:14b (균형)" },
  { id: "qwen2.5:32b", label: "qwen2.5:32b (성능우선)" },
  { id: "gemma3:12b", label: "gemma3:12b (균형)" },
  { id: "mistral-small3.1", label: "mistral-small3.1 (균형)" },
  { id: "qwen2.5:3b", label: "qwen2.5:3b (초저사양)" },
] as const;

interface AudioRingBuffer {
  buffer: Float32Array;
  readPos: number;
  writePos: number;
  length: number;
}

export default function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [transcriptEntries, setTranscriptEntries] = useState<
    { id: number; time: string; text: string }[]
  >([]);
  const [minutesContent, setMinutesContent] = useState("");
  const [isGeneratingMinutes, setIsGeneratingMinutes] = useState(false);
  const [whisperStatus, setWhisperStatus] = useState<
    "ready" | "loading" | "processing" | "inactive"
  >("inactive");
  const [ollamaStatus, setOllamaStatus] = useState<"connected" | "disconnected">("disconnected");
  const [showSettings, setShowSettings] = useState(false);
  const [selectedModel, setSelectedModel] = useState("qwen2.5:3b");
  const [selectedLang, setSelectedLang] = useState("ko");
  const [whisperModel, setWhisperModel] = useState("turbo");
  const [transcriptionHint, setTranscriptionHint] = useState("");
  const [whisperEngine, setWhisperEngine] = useState<string | null>(null);
  const [whisperBackend, setWhisperBackend] = useState<string | null>(null);
  const [whisperGpuEnabled, setWhisperGpuEnabled] = useState(false);
  const [whisperRuntimeReady, setWhisperRuntimeReady] = useState(false);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [micStatus, setMicStatus] = useState<"connected" | "disconnected">("disconnected");
  const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMicId, setSelectedMicId] = useState<string>("");
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [fileProcessProgress, setFileProcessProgress] = useState<number | null>(null);
  const [isPullingOllamaModel, setIsPullingOllamaModel] = useState(false);
  const [ollamaPullStatus, setOllamaPullStatus] = useState<string | null>(null);
  const ollamaHasModels = availableModels.length > 0;
  const ollamaModelOptions = useMemo(
    () => Array.from(new Set([...availableModels, ...RECOMMENDED_OLLAMA_MODELS.map((model) => model.id)])),
    [availableModels]
  );
  const selectedModelInstalled = selectedModel ? availableModels.includes(selectedModel) : false;
  const getOllamaModelLabel = useCallback((model: string) => {
    return RECOMMENDED_OLLAMA_MODELS.find((item) => item.id === model)?.label || model;
  }, []);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const entryIdRef = useRef(0);
  const fullTranscriptRef = useRef<string[]>([]);
  // Duration tracked via ref to avoid App-wide re-renders every second
  const durationRef = useRef(0);
  const inputSampleRateRef = useRef(48000);
  const processedInputSamplesRef = useRef(0);

  // Audio refs
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Pre-allocated audio ring buffer (lazy-initialized in startRecording)
  const audioRingRef = useRef<AudioRingBuffer | null>(null);
  const processingChunkPromiseRef = useRef<Promise<void> | null>(null);
  const isStartingRecordingRef = useRef(false);
  const isStoppingRecordingRef = useRef(false);

  // Whisper lazy init tracking
  const whisperInitializedModelRef = useRef<string | null>(null);
  const whisperInitPromiseRef = useRef<Promise<boolean> | null>(null);
  const whisperInitTargetModelRef = useRef<string | null>(null);
  const pendingWorkletFlushResolverRef = useRef<(() => void) | null>(null);

  // Minutes streaming batch buffer
  const minutesBufferRef = useRef("");
  const minutesRafRef = useRef<number | null>(null);

  const formatTime = useCallback((totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }, []);

  const buildTranscriptionPrompt = useCallback(
    (recentText?: string) => {
      const normalizedHint = transcriptionHint.replace(/\s+/g, " ").trim();
      const normalizedRecent = recentText?.replace(/\s+/g, " ").trim();
      const prompt = [normalizedHint, normalizedRecent].filter(Boolean).join(" ");
      return prompt || undefined;
    },
    [transcriptionHint]
  );

  const getChunkInputSampleCount = useCallback(() => {
    const sampleRate = audioContextRef.current?.sampleRate || inputSampleRateRef.current;
    return Math.max(1, Math.round(sampleRate * CHUNK_DURATION_SEC));
  }, []);

  const getAudioRingLength = useCallback(() => {
    return audioRingRef.current?.length ?? 0;
  }, []);

  const resetAudioRing = useCallback(() => {
    if (!audioRingRef.current) {
      audioRingRef.current = {
        buffer: new Float32Array(AUDIO_RING_BUFFER_SIZE),
        readPos: 0,
        writePos: 0,
        length: 0,
      };
      return;
    }

    audioRingRef.current.readPos = 0;
    audioRingRef.current.writePos = 0;
    audioRingRef.current.length = 0;
  }, []);

  const discardOldestAudioSamples = useCallback((sampleCount: number) => {
    const ring = audioRingRef.current;
    if (!ring || sampleCount <= 0 || ring.length === 0) return;

    const discardCount = Math.min(sampleCount, ring.length);
    ring.readPos = (ring.readPos + discardCount) % ring.buffer.length;
    ring.length -= discardCount;
    processedInputSamplesRef.current += discardCount;

    if (ring.length === 0) {
      ring.writePos = ring.readPos;
    }
  }, []);

  const ensureAudioRingCapacity = useCallback(
    (incomingLength: number) => {
      const ring = audioRingRef.current;
      if (!ring || incomingLength <= ring.buffer.length - ring.length) return;

      let nextSize = ring.buffer.length;
      while (incomingLength > nextSize - ring.length && nextSize < MAX_AUDIO_RING_BUFFER_SIZE) {
        nextSize *= 2;
      }
      nextSize = Math.min(nextSize, MAX_AUDIO_RING_BUFFER_SIZE);

      if (incomingLength > nextSize - ring.length) {
        return;
      }

      const nextBuffer = new Float32Array(nextSize);
      if (ring.length > 0) {
        if (ring.readPos < ring.writePos) {
          nextBuffer.set(ring.buffer.subarray(ring.readPos, ring.writePos), 0);
        } else {
          const tail = ring.buffer.subarray(ring.readPos);
          nextBuffer.set(tail, 0);
          if (ring.writePos > 0) {
            nextBuffer.set(ring.buffer.subarray(0, ring.writePos), tail.length);
          }
        }
      }

      ring.buffer = nextBuffer;
      ring.readPos = 0;
      ring.writePos = ring.length;
    },
    []
  );

  const appendToAudioRing = useCallback(
    (inputData: Float32Array) => {
      const ring = audioRingRef.current;
      if (!ring || inputData.length === 0) return;

      const overflowCount = ring.length + inputData.length - MAX_AUDIO_RING_BUFFER_SIZE;
      if (overflowCount > 0) {
        discardOldestAudioSamples(overflowCount);
      }

      ensureAudioRingCapacity(inputData.length);

      const firstWriteLength = Math.min(inputData.length, ring.buffer.length - ring.writePos);
      ring.buffer.set(inputData.subarray(0, firstWriteLength), ring.writePos);

      const remainingLength = inputData.length - firstWriteLength;
      if (remainingLength > 0) {
        ring.buffer.set(inputData.subarray(firstWriteLength), 0);
      }

      ring.writePos = (ring.writePos + inputData.length) % ring.buffer.length;
      ring.length += inputData.length;
    },
    [discardOldestAudioSamples, ensureAudioRingCapacity]
  );

  const drainAudioRing = useCallback((sampleCount?: number) => {
    const ring = audioRingRef.current;
    if (!ring || ring.length === 0) return null;

    const drainLength = Math.min(sampleCount ?? ring.length, ring.length);
    const drained = new Float32Array(drainLength);

    if (ring.readPos + drainLength <= ring.buffer.length) {
      drained.set(ring.buffer.subarray(ring.readPos, ring.readPos + drainLength), 0);
    } else {
      const firstSliceLength = ring.buffer.length - ring.readPos;
      drained.set(ring.buffer.subarray(ring.readPos), 0);
      drained.set(ring.buffer.subarray(0, drainLength - firstSliceLength), firstSliceLength);
    }

    ring.readPos = (ring.readPos + drainLength) % ring.buffer.length;
    ring.length -= drainLength;

    if (ring.length === 0) {
      ring.writePos = ring.readPos;
    }

    return drained;
  }, []);

  const cleanupAudioGraph = useCallback(() => {
    if (audioSourceRef.current) {
      audioSourceRef.current.disconnect();
      audioSourceRef.current = null;
    }
    if (workletNodeRef.current) {
      if (workletNodeRef.current instanceof AudioWorkletNode) {
        workletNodeRef.current.port.onmessage = null;
      }
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (silentGainRef.current) {
      silentGainRef.current.disconnect();
      silentGainRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    pendingWorkletFlushResolverRef.current?.();
    pendingWorkletFlushResolverRef.current = null;
  }, []);

  const flushAudioCaptureNode = useCallback(async () => {
    const node = workletNodeRef.current;
    if (!(node instanceof AudioWorkletNode)) return;

    await new Promise<void>((resolve) => {
      pendingWorkletFlushResolverRef.current = resolve;
      node.port.postMessage({ type: "flush" });
    });
  }, []);

  const refreshOllamaModels = useCallback(async () => {
    if (!window.electronAPI) return [];

    const models = await window.electronAPI.ollamaModels();
    setAvailableModels(models);
    setSelectedModel((prev) => {
      if (prev) {
        return prev;
      }
      if (models.length > 0) {
        return models[0];
      }
      return DEFAULT_OLLAMA_MODEL;
    });
    return models;
  }, []);

  // Check Ollama connection on mount (fetch models only once per connection)
  useEffect(() => {
    let modelsLoaded = false;
    const checkOllama = async () => {
      if (window.electronAPI) {
        const result = await window.electronAPI.ollamaCheck();
        const connected = result.connected;
        setOllamaStatus(connected ? "connected" : "disconnected");

        if (connected && !modelsLoaded) {
          const models = await refreshOllamaModels();
          if (models.length > 0) {
            modelsLoaded = true;
          }
        } else if (!connected) {
          modelsLoaded = false;
        }
      }
    };

    checkOllama();
    const interval = setInterval(checkOllama, 10000);
    return () => clearInterval(interval);
  }, [refreshOllamaModels]);

  // Check microphone availability and list devices
  useEffect(() => {
    const checkMic = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices.filter((d) => d.kind === "audioinput");
        setMicDevices(mics);
        setMicStatus(mics.length > 0 ? "connected" : "disconnected");
        if (mics.length > 0 && !selectedMicId) {
          setSelectedMicId(mics[0].deviceId);
        }
      } catch {
        setMicDevices([]);
        setMicStatus("disconnected");
      }
    };

    checkMic();
    navigator.mediaDevices?.addEventListener("devicechange", checkMic);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", checkMic);
    };
  }, [selectedMicId]);

  // Lazy Whisper initialization — only loads model on first use
  const ensureWhisperReady = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI) return false;
    if (whisperInitializedModelRef.current === whisperModel) return true;
    if (
      whisperInitPromiseRef.current &&
      whisperInitTargetModelRef.current === whisperModel
    ) {
      return whisperInitPromiseRef.current;
    }
    if (whisperInitPromiseRef.current) {
      try {
        await whisperInitPromiseRef.current;
      } catch {
        // Ignore previous init failures and retry for the latest requested model.
      }
      if (whisperInitializedModelRef.current === whisperModel) return true;
    }

    const initPromise = (async () => {
      setWhisperStatus("loading");
      const result = await window.electronAPI.whisperInit(whisperModel);
      if (result.success) {
        whisperInitializedModelRef.current = whisperModel;
        setWhisperEngine(result.runtime?.engine ?? "unknown");
        setWhisperBackend(result.runtime?.backend ?? "cpu");
        setWhisperGpuEnabled(result.runtime?.gpuEnabled ?? false);
        setWhisperRuntimeReady(true);
        setWhisperStatus("ready");
        return true;
      }

      console.error("Whisper init failed:", result.error);
      setWhisperEngine(null);
      setWhisperBackend(null);
      setWhisperGpuEnabled(false);
      setWhisperRuntimeReady(false);
      setWhisperStatus("inactive");
      return false;
    })();

    whisperInitTargetModelRef.current = whisperModel;
    whisperInitPromiseRef.current = initPromise;

    try {
      return await initPromise;
    } finally {
      whisperInitPromiseRef.current = null;
      whisperInitTargetModelRef.current = null;
    }
  }, [whisperModel]);

  // Re-init Whisper if model changes while already initialized
  useEffect(() => {
    if (whisperInitializedModelRef.current !== whisperModel) {
      setWhisperRuntimeReady(false);
    }

    if (
      whisperInitializedModelRef.current &&
      whisperInitializedModelRef.current !== whisperModel &&
      !isRecording &&
      !isProcessingFile
    ) {
      ensureWhisperReady();
    }
  }, [whisperModel, ensureWhisperReady, isRecording, isProcessingFile]);

  // Combined resample + PCM16 conversion (eliminates intermediate Float32Array)
  const resampleAndConvertToPCM16 = useCallback(
    (audioData: Float32Array, originalSampleRate: number): ArrayBuffer => {
      const ratio = originalSampleRate / SAMPLE_RATE;
      const newLength = Math.round(audioData.length / ratio);
      const buffer = new ArrayBuffer(newLength * 2);
      const view = new DataView(buffer);

      for (let i = 0; i < newLength; i++) {
        const srcIndex = i * ratio;
        const srcIndexFloor = Math.floor(srcIndex);
        const srcIndexCeil = Math.min(srcIndexFloor + 1, audioData.length - 1);
        const t = srcIndex - srcIndexFloor;
        const sample = audioData[srcIndexFloor] * (1 - t) + audioData[srcIndexCeil] * t;
        const s = Math.max(-1, Math.min(1, sample));
        view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }

      return buffer;
    },
    []
  );

  // Process accumulated audio buffer.
  const processAudioChunk = useCallback(async () => {
    if (!window.electronAPI || getAudioRingLength() === 0) return;
    if (processingChunkPromiseRef.current) {
      return processingChunkPromiseRef.current;
    }

    const processingPromise = (async () => {
      setWhisperStatus("processing");
      try {
        const inputChunkSize = getChunkInputSampleCount();
        while (getAudioRingLength() > 0) {
          const shouldWaitForMoreAudio =
            isRecording && !isStoppingRecordingRef.current && getAudioRingLength() < inputChunkSize;
          if (shouldWaitForMoreAudio) {
            break;
          }

          const audioData = drainAudioRing(inputChunkSize);
          if (!audioData) break;

          const sampleRate = audioContextRef.current?.sampleRate || inputSampleRateRef.current;
          const chunkStartSeconds = Math.floor(processedInputSamplesRef.current / sampleRate);
          processedInputSamplesRef.current += audioData.length;
          const pcmBuffer = resampleAndConvertToPCM16(audioData, sampleRate);
          const recentText = fullTranscriptRef.current.slice(-2).join(" ");

          const result = await window.electronAPI.whisperTranscribe(
            pcmBuffer,
            selectedLang,
            buildTranscriptionPrompt(recentText)
          );

          if (result.success && result.text && result.text.trim()) {
            const text = result.text.trim();

            fullTranscriptRef.current.push(text);

            setTranscriptEntries((prev) => [
              ...prev,
              {
                id: entryIdRef.current++,
                time: formatTime(chunkStartSeconds),
                text,
              },
            ]);
          }
        }
      } finally {
        processingChunkPromiseRef.current = null;
        setWhisperStatus("ready");
      }
    })();

    processingChunkPromiseRef.current = processingPromise;
    return processingPromise;
  }, [buildTranscriptionPrompt, drainAudioRing, formatTime, getAudioRingLength, getChunkInputSampleCount, isRecording, resampleAndConvertToPCM16, selectedLang]);

  const handleCapturedAudioChunk = useCallback(
    (audioData: Float32Array) => {
      appendToAudioRing(audioData);

      if (
        !processingChunkPromiseRef.current &&
        getAudioRingLength() >= getChunkInputSampleCount()
      ) {
        void processAudioChunk();
      }
    },
    [appendToAudioRing, getAudioRingLength, getChunkInputSampleCount, processAudioChunk]
  );

  // Start recording
  const startRecording = useCallback(async () => {
    if (isStartingRecordingRef.current || isStoppingRecordingRef.current || isRecording) {
      return;
    }

    isStartingRecordingRef.current = true;
    try {
      // Ensure Whisper is ready before starting
      const ready = await ensureWhisperReady();
      if (!ready) {
        setErrorMessage("Whisper 모델을 초기화할 수 없습니다.");
        setTimeout(() => setErrorMessage(null), 5000);
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: selectedMicId ? { exact: selectedMicId } : undefined,
          channelCount: 1,
          sampleRate: { ideal: SAMPLE_RATE },
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      mediaStreamRef.current = stream;
      const audioContext = new AudioContext({ sampleRate: undefined }); // Use device default
      audioContextRef.current = audioContext;
      inputSampleRateRef.current = audioContext.sampleRate;

      const source = audioContext.createMediaStreamSource(stream);
      audioSourceRef.current = source;
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      silentGainRef.current = silentGain;

      resetAudioRing();

      let captureNode: AudioWorkletNode | ScriptProcessorNode;
      try {
        await audioContext.audioWorklet.addModule(audioCaptureWorkletUrl.toString());
        const workletNode = new AudioWorkletNode(audioContext, "audio-capture-processor", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          processorOptions: {
            chunkSize: AUDIO_WORKLET_CHUNK_SIZE,
          },
        });

        workletNode.port.onmessage = (event) => {
          if (event.data?.type === "audio" && event.data.audioData instanceof ArrayBuffer) {
            handleCapturedAudioChunk(new Float32Array(event.data.audioData));
            return;
          }

          if (event.data?.type === "flushed") {
            pendingWorkletFlushResolverRef.current?.();
            pendingWorkletFlushResolverRef.current = null;
          }
        };

        captureNode = workletNode;
      } catch (workletError) {
        console.warn("AudioWorklet unavailable, falling back to ScriptProcessorNode.", workletError);

        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        processor.onaudioprocess = (e) => {
          const inputData = e.inputBuffer.getChannelData(0);
          handleCapturedAudioChunk(new Float32Array(inputData));
        };
        captureNode = processor;
      }

      source.connect(captureNode);
      captureNode.connect(silentGain);
      silentGain.connect(audioContext.destination);
      workletNodeRef.current = captureNode;

      // Set up chunk processing timer
      chunkTimerRef.current = setInterval(() => {
        processAudioChunk();
      }, CHUNK_DURATION_SEC * 1000);

      setIsRecording(true);
      durationRef.current = 0;
      processedInputSamplesRef.current = 0;
      entryIdRef.current = 0;
      setTranscriptEntries([]);
      setMinutesContent("");
      fullTranscriptRef.current = [];

      // Duration timer — only updates ref, no re-render
      timerRef.current = setInterval(() => {
        durationRef.current += 1;
      }, 1000);
    } catch (error: any) {
      console.error("Failed to start recording:", error);
      let msg = "녹음을 시작할 수 없습니다.";
      if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
        msg = "마이크를 찾을 수 없습니다. 마이크가 연결되어 있는지 확인해주세요.";
      } else if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
        msg = "마이크 접근 권한이 거부되었습니다. 설정에서 마이크 권한을 허용해주세요.";
      }
      setErrorMessage(msg);
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      isStartingRecordingRef.current = false;
    }
  }, [ensureWhisperReady, handleCapturedAudioChunk, isRecording, resetAudioRing, selectedMicId]);

  // Stop recording
  const stopRecording = useCallback(async () => {
    if (isStoppingRecordingRef.current) {
      return;
    }

    isStoppingRecordingRef.current = true;
    try {
      setIsRecording(false);

      // Stop timers
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      if (chunkTimerRef.current) {
        clearInterval(chunkTimerRef.current);
        chunkTimerRef.current = null;
      }

      if (audioSourceRef.current) {
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
      }

      if (workletNodeRef.current instanceof AudioWorkletNode) {
        try {
          await flushAudioCaptureNode();
        } catch {
          pendingWorkletFlushResolverRef.current = null;
        }
      }

      if (workletNodeRef.current) {
        if (workletNodeRef.current instanceof AudioWorkletNode) {
          workletNodeRef.current.port.onmessage = null;
        }
        workletNodeRef.current.disconnect();
        workletNodeRef.current = null;
      }
      if (silentGainRef.current) {
        silentGainRef.current.disconnect();
        silentGainRef.current = null;
      }

      if (processingChunkPromiseRef.current) {
        try {
          await processingChunkPromiseRef.current;
        } catch {
          // Surface of whisper errors is handled by the invoke response.
        }
      }

      while (getAudioRingLength() > 0) {
        await processAudioChunk();
        if (processingChunkPromiseRef.current) {
          try {
            await processingChunkPromiseRef.current;
          } catch {
            break;
          }
        }
      }

      // Stop media stream
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }

      // Clean up audio context
      cleanupAudioGraph();

      setWhisperStatus("ready");
    } finally {
      isStoppingRecordingRef.current = false;
    }
  }, [cleanupAudioGraph, flushAudioCaptureNode, getAudioRingLength, processAudioChunk]);

  const toggleRecording = useCallback(() => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Generate minutes via Ollama (with batched streaming updates)
  const generateMinutes = useCallback(async () => {
    if (!window.electronAPI || fullTranscriptRef.current.length === 0) return;
    if (ollamaStatus !== "connected") {
      setErrorMessage("Ollama 연결 대기 중입니다. 잠시 후 다시 시도해주세요.");
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }
    if (!ollamaHasModels || !selectedModel) {
      setErrorMessage("설치된 Ollama 모델이 없습니다. 먼저 모델을 내려받아 주세요.");
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }

    window.electronAPI.removeOllamaListeners();
    if (minutesRafRef.current !== null) {
      cancelAnimationFrame(minutesRafRef.current);
      minutesRafRef.current = null;
    }

    setIsGeneratingMinutes(true);
    setMinutesContent("");
    minutesBufferRef.current = "";

    const flushMinutesBuffer = () => {
      setMinutesContent(minutesBufferRef.current);
      minutesRafRef.current = null;
    };

    // Set up streaming listeners
    window.electronAPI.onOllamaChunk((chunk: string) => {
      minutesBufferRef.current += chunk;
      // Batch updates using requestAnimationFrame
      if (minutesRafRef.current === null) {
        minutesRafRef.current = requestAnimationFrame(flushMinutesBuffer);
      }
    });

    window.electronAPI.onOllamaDone(() => {
      // Flush any remaining buffered content
      if (minutesRafRef.current !== null) {
        cancelAnimationFrame(minutesRafRef.current);
        minutesRafRef.current = null;
      }
      setMinutesContent(minutesBufferRef.current);
      setIsGeneratingMinutes(false);
      window.electronAPI.removeOllamaListeners();
    });

    const transcript = fullTranscriptRef.current.join("\n");
    const result = await window.electronAPI.ollamaGenerate(transcript, selectedModel);

    if (!result.success) {
      console.error("Minutes generation failed:", result.error);
      if (minutesRafRef.current !== null) {
        cancelAnimationFrame(minutesRafRef.current);
        minutesRafRef.current = null;
      }
      setIsGeneratingMinutes(false);
      setMinutesContent("회의록 생성에 실패했습니다: " + (result.error || "알 수 없는 오류"));
      window.electronAPI.removeOllamaListeners();
    }
  }, [ollamaHasModels, ollamaStatus, selectedModel]);

  // Handle file upload: open native dialog and send file path to backend for ffmpeg decoding
  const handleFileUpload = useCallback(async () => {
    if (!window.electronAPI) return;

    const filePath = await window.electronAPI.selectAudioFile();
    if (!filePath) {
      return;
    }

    // Ensure Whisper is ready before processing
    const ready = await ensureWhisperReady();
    if (!ready) {
      setErrorMessage("Whisper 모델을 초기화할 수 없습니다.");
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }

    setIsProcessingFile(true);
    setFileProcessProgress(0);
    setTranscriptEntries([]);
    setMinutesContent("");
    entryIdRef.current = 0;
    fullTranscriptRef.current = [];
    setWhisperStatus("processing");

    // Listen to progress updates
    window.electronAPI.onWhisperFileProgress((progress, text, startSeconds) => {
      if (progress >= 0 && progress <= 100) {
        setFileProcessProgress(progress);
      }

      if (text) {
        fullTranscriptRef.current.push(text);
        setTranscriptEntries((prev) => [
          ...prev,
          {
            id: entryIdRef.current++,
            time: formatTime(Math.max(0, Math.floor(startSeconds ?? 0))),
            text,
          },
        ]);
      }
    });

    try {
      const result = await window.electronAPI.whisperTranscribeFile(
        filePath,
        selectedLang,
        buildTranscriptionPrompt()
      );

      if (!result.success) {
        throw new Error(result.error);
      }

      const finalText = result.text?.trim() ?? "";
      if (finalText) {
        const normalizedFinalText = finalText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const normalizedProgressText = fullTranscriptRef.current
          .map((line) => line.trim())
          .filter(Boolean);

        if (normalizedFinalText.join("\n") !== normalizedProgressText.join("\n")) {
          fullTranscriptRef.current = normalizedFinalText;
          entryIdRef.current = normalizedFinalText.length;
          setTranscriptEntries(
            normalizedFinalText.map((text, index) => ({
              id: index,
              time: formatTime(0),
              text,
            }))
          );
        }
      }

      setWhisperStatus("ready");
    } catch (error: any) {
      console.error("File processing error:", error);
      setErrorMessage(
        "오디오 파일 처리에 실패했습니다: " + (error.message || "알 수 없는 에러")
      );
      setTimeout(() => setErrorMessage(null), 5000);
      setWhisperStatus("ready");
    } finally {
      setIsProcessingFile(false);
      setFileProcessProgress(null);
      window.electronAPI.removeWhisperListeners();
    }
  }, [buildTranscriptionPrompt, selectedLang, formatTime, ensureWhisperReady]);

  const clearTranscript = useCallback(() => {
    setTranscriptEntries([]);
    entryIdRef.current = 0;
    fullTranscriptRef.current = [];
  }, []);

  const copyMinutes = useCallback(() => {
    navigator.clipboard.writeText(minutesContent);
  }, [minutesContent]);

  const downloadOllama = useCallback(() => {
    window.open("https://ollama.com/download", "_blank", "noopener,noreferrer");
  }, []);

  const downloadOllamaModel = useCallback(async (modelName?: string) => {
    if (!window.electronAPI) return;
    if (ollamaStatus !== "connected") {
      setErrorMessage("Ollama 연결이 먼저 필요합니다.");
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }

    const modelToDownload = modelName || selectedModel || DEFAULT_OLLAMA_MODEL;
    setIsPullingOllamaModel(true);
    setOllamaPullStatus(`${modelToDownload} 다운로드를 시작합니다...`);
    window.electronAPI.removeOllamaPullListeners();
    window.electronAPI.onOllamaPullProgress((progress) => {
      const ratio =
        typeof progress.completed === "number" &&
        typeof progress.total === "number" &&
        progress.total > 0
          ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
          : null;

      setOllamaPullStatus(ratio !== null ? `${progress.status} (${ratio}%)` : progress.status);
    });
    window.electronAPI.onOllamaPullDone(() => {
      setOllamaPullStatus(`${modelToDownload} 다운로드가 완료되었습니다.`);
      window.electronAPI.removeOllamaPullListeners();
    });

    try {
      const result = await window.electronAPI.ollamaPullModel(modelToDownload);
      if (!result.success) {
        throw new Error(result.error);
      }

      const models = await refreshOllamaModels();
      if (models.includes(modelToDownload)) {
        setSelectedModel(modelToDownload);
      }
    } catch (error: any) {
      setOllamaPullStatus(null);
      setErrorMessage(`모델 다운로드에 실패했습니다: ${error.message || "알 수 없는 오류"}`);
      setTimeout(() => setErrorMessage(null), 5000);
    } finally {
      setIsPullingOllamaModel(false);
      window.electronAPI.removeOllamaPullListeners();
    }
  }, [ollamaStatus, refreshOllamaModels, selectedModel]);

  const handleOllamaModelChange = useCallback(
    (nextModel: string) => {
      setSelectedModel(nextModel);

      if (!availableModels.includes(nextModel) && !isPullingOllamaModel) {
        void downloadOllamaModel(nextModel);
      }
    },
    [availableModels, downloadOllamaModel, isPullingOllamaModel]
  );

  const downloadMinutes = useCallback(() => {
    const blob = new Blob([minutesContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `회의록_${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [minutesContent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
      if (minutesRafRef.current) cancelAnimationFrame(minutesRafRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      }
      cleanupAudioGraph();
    };
  }, [cleanupAudioGraph]);

  return (
    <div
      className="size-full flex flex-col overflow-hidden"
      style={{
        background: "linear-gradient(145deg, #0c0c14 0%, #0a0a12 50%, #0d0b16 100%)",
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <TitleBar />

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar - Settings */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
              }}
            >
              <span className="text-white/30">언어</span>
              <span className="text-white/60">{selectedLang === "ko" ? "한국어" : selectedLang === "en" ? "English" : selectedLang === "ja" ? "日本語" : "中文"}</span>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
              }}
            >
              <span className="text-white/30">모델</span>
              <span className="text-white/60">whisper-{whisperModel}</span>
              <span className="text-white/20">/</span>
              <span className="text-white/50">
                {whisperRuntimeReady && whisperEngine && whisperBackend
                  ? `${whisperEngine} · ${whisperGpuEnabled ? `GPU ${whisperBackend}` : whisperBackend.toUpperCase()}`
                  : "미초기화"}
              </span>
            </div>
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                fontSize: "12px",
              }}
            >
              <span className="text-white/30">LLM</span>
              <span className="text-white/60">{selectedModel}</span>
            </div>
          </div>
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/5 transition-all cursor-pointer"
          >
            <Settings size={16} />
          </button>
        </div>

        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-white/5"
            >
              <div className="px-6 py-4 grid grid-cols-4 gap-4" style={{ fontSize: "13px" }}>
                {/* Mic Select */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    마이크
                  </label>
                  <div className="relative">
                    <select
                      value={selectedMicId}
                      onChange={(e) => setSelectedMicId(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                      }}
                    >
                      {micDevices.length === 0 ? (
                        <option value="">마이크 없음</option>
                      ) : (
                        micDevices.map((device) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {device.label || `마이크 ${device.deviceId.slice(0, 8)}`}
                          </option>
                        ))
                      )}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                {/* Language Select */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    인식 언어
                  </label>
                  <div className="relative">
                    <select
                      value={selectedLang}
                      onChange={(e) => setSelectedLang(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                      }}
                    >
                      <option value="ko">한국어</option>
                      <option value="en">English</option>
                      <option value="ja">日本語</option>
                      <option value="zh">中文</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                {/* Whisper Model */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    Whisper 모델
                  </label>
                  <div className="relative">
                    <select
                      value={whisperModel}
                      onChange={(e) => setWhisperModel(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                      }}
                    >
                      <option value="base">base (~150MB)</option>
                      <option value="small">small (~500MB)</option>
                      <option value="medium">medium (~1.5GB)</option>
                      <option value="turbo">turbo (~6GB VRAM 권장)</option>
                      <option value="large-v3">large-v3 (~10GB VRAM 권장)</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                {/* Ollama Model */}
                <div className="flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    Ollama 모델
                  </label>
                  <div className="relative">
                    <select
                      value={selectedModel}
                      onChange={(e) => handleOllamaModelChange(e.target.value)}
                      className="w-full appearance-none px-3 py-2 rounded-lg text-white/70 cursor-pointer outline-none"
                      style={{
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: "13px",
                        color: selectedModelInstalled ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.4)",
                      }}
                    >
                      {ollamaModelOptions.map((model) => {
                        const installed = availableModels.includes(model);
                        return (
                          <option
                            key={model}
                            value={model}
                            style={{
                              color: installed ? "#ffffff" : "rgba(255,255,255,0.45)",
                              backgroundColor: "#0c0c14",
                            }}
                          >
                            {getOllamaModelLabel(model)}
                          </option>
                        );
                      })}
                    </select>
                    <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 pointer-events-none" />
                  </div>
                </div>

                <div className="col-span-4 flex flex-col gap-2">
                  <label className="text-white/30" style={{ fontSize: "11px" }}>
                    전사 힌트
                  </label>
                  <input
                    value={transcriptionHint}
                    onChange={(e) => setTranscriptionHint(e.target.value)}
                    placeholder="예: 작업일보, 작업지시, 툴 체인지, 설비 이상, 자재결품, 가부족, 미납, 종품검사"
                    className="w-full px-3 py-2 rounded-lg text-white/70 outline-none"
                    style={{
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      fontSize: "13px",
                    }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Recording Control */}
        <RecordingControl
          isRecording={isRecording}
          isPaused={false}
          isProcessingFile={isProcessingFile}
          fileProcessProgress={fileProcessProgress}
          onToggleRecording={toggleRecording}
          onStop={stopRecording}
          onFileUpload={handleFileUpload}
        />

        {/* Panels */}
        <div className="flex-1 flex gap-3 px-4 pb-3 overflow-hidden min-h-0">
          <div className="flex-1 min-w-0">
            <TranscriptPanel
              entries={transcriptEntries}
              isRecording={isRecording}
              onClear={clearTranscript}
            />
          </div>
          <div className="flex-1 min-w-0">
            <MinutesPanel
              content={minutesContent}
              isGenerating={isGeneratingMinutes}
              hasTranscript={transcriptEntries.length > 0}
              ollamaConnected={ollamaStatus === "connected"}
              ollamaHasModels={ollamaHasModels}
              selectedModelInstalled={selectedModelInstalled}
              isPullingModel={isPullingOllamaModel}
              modelPullStatus={ollamaPullStatus}
              downloadModelName={getOllamaModelLabel(selectedModel || DEFAULT_OLLAMA_MODEL)}
              onGenerate={generateMinutes}
              onDownloadOllama={
                ollamaStatus === "connected"
                  ? () => downloadOllamaModel(selectedModel || DEFAULT_OLLAMA_MODEL)
                  : downloadOllama
              }
              onCopy={copyMinutes}
              onDownload={downloadMinutes}
            />
          </div>
        </div>
      </div>

      <StatusBar
        whisperStatus={whisperStatus}
        ollamaStatus={ollamaStatus}
        micStatus={micStatus}
        whisperModel={whisperModel}
        whisperEngine={whisperEngine}
        whisperBackend={whisperBackend}
        whisperGpuEnabled={whisperGpuEnabled}
        whisperRuntimeReady={whisperRuntimeReady}
        modelName={selectedModel}
      />

      {/* Error Toast */}
      <AnimatePresence>
        {errorMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-12 left-1/2 -translate-x-1/2 px-5 py-3 rounded-xl z-50"
            style={{
              background: "rgba(239,68,68,0.9)",
              backdropFilter: "blur(10px)",
              fontSize: "13px",
              color: "white",
              maxWidth: "400px",
            }}
          >
            {errorMessage}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
