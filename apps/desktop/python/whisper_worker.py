import base64
import json
import os
import sys
import traceback
from typing import Any

REALTIME_BEAM_SIZE = int(os.environ.get("BREVOCA_REALTIME_BEAM_SIZE", "1"))
REALTIME_BEST_OF = int(os.environ.get("BREVOCA_REALTIME_BEST_OF", "1"))
REALTIME_VAD_FILTER = os.environ.get("BREVOCA_REALTIME_VAD_FILTER", "0").strip().lower() in {
    "1",
    "true",
    "yes",
}
FILE_BEAM_SIZE = int(os.environ.get("BREVOCA_FILE_BEAM_SIZE", "5"))
FILE_BEST_OF = int(os.environ.get("BREVOCA_FILE_BEST_OF", "5"))
FILE_BATCH_SIZE_CPU = int(os.environ.get("BREVOCA_FILE_BATCH_SIZE_CPU", "8"))
FILE_BATCH_SIZE_CUDA = int(os.environ.get("BREVOCA_FILE_BATCH_SIZE_CUDA", "32"))
FILE_CHUNK_LENGTH_CPU = int(os.environ.get("BREVOCA_FILE_CHUNK_LENGTH_CPU", "20"))
FILE_CHUNK_LENGTH_CUDA = int(os.environ.get("BREVOCA_FILE_CHUNK_LENGTH_CUDA", "30"))
FILE_CONDITION_ON_PREVIOUS_TEXT = os.environ.get("BREVOCA_FILE_PREV_TEXT", "1").strip().lower() in {
    "1",
    "true",
    "yes",
}
CUDA_NUM_WORKERS = int(os.environ.get("BREVOCA_CUDA_NUM_WORKERS", "2"))
CPU_NUM_WORKERS = int(os.environ.get("BREVOCA_CPU_NUM_WORKERS", "1"))


def emit(message: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(message, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class WorkerError(RuntimeError):
    pass


class FasterWhisperWorker:
    def __init__(self) -> None:
        try:
            import numpy as np
            import ctranslate2
            from faster_whisper import BatchedInferencePipeline, WhisperModel
        except Exception as exc:
            raise WorkerError(
                "Python STT dependencies are missing. Install python/requirements-stt.txt first."
            ) from exc

        self.np = np
        self.ctranslate2 = ctranslate2
        self.BatchedInferencePipeline = BatchedInferencePipeline
        self.WhisperModel = WhisperModel
        self.model = None
        self.file_pipeline = None
        self.model_name = ""
        self.file_batch_size = FILE_BATCH_SIZE_CPU
        self.file_chunk_length = FILE_CHUNK_LENGTH_CPU
        self.runtime: dict[str, Any] = {
            "engine": "faster-whisper",
            "backend": "cpu",
            "gpuEnabled": False,
            "notes": [],
        }

    def init_model(self, model_name: str) -> dict[str, Any]:
        device = os.environ.get("BREVOCA_FASTER_WHISPER_DEVICE", "").strip().lower()
        compute_type = os.environ.get("BREVOCA_FASTER_WHISPER_COMPUTE_TYPE", "").strip().lower()
        device_index_env = os.environ.get("BREVOCA_FASTER_WHISPER_DEVICE_INDEX", "").strip()
        cuda_device_count = self._get_cuda_device_count()

        if not device:
            device = "cuda" if cuda_device_count > 0 else "cpu"

        if not compute_type:
            compute_type = "float16" if device == "cuda" else "int8"

        cpu_threads = max(1, min(8, os.cpu_count() or 1))
        device_index = self._resolve_device_index(device_index_env, cuda_device_count)
        num_workers = CUDA_NUM_WORKERS if device == "cuda" else CPU_NUM_WORKERS
        self.file_batch_size = FILE_BATCH_SIZE_CUDA if device == "cuda" else FILE_BATCH_SIZE_CPU
        self.file_chunk_length = FILE_CHUNK_LENGTH_CUDA if device == "cuda" else FILE_CHUNK_LENGTH_CPU
        self.model = self.WhisperModel(
            model_name,
            device=device,
            device_index=device_index,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            num_workers=num_workers,
        )
        self.file_pipeline = self.BatchedInferencePipeline(self.model)
        self.model_name = model_name
        self.runtime = {
            "engine": "faster-whisper",
            "backend": device,
            "gpuEnabled": device != "cpu",
            "modelName": model_name,
            "notes": [
                f"compute_type={compute_type}",
                f"device_index={device_index}",
                f"num_workers={num_workers}",
                f"realtime_beam={REALTIME_BEAM_SIZE}",
                f"realtime_best_of={REALTIME_BEST_OF}",
                f"realtime_vad={'on' if REALTIME_VAD_FILTER else 'off'}",
                f"file_beam={FILE_BEAM_SIZE}",
                f"file_best_of={FILE_BEST_OF}",
                f"file_batch_size={self.file_batch_size}",
                f"file_chunk_length={self.file_chunk_length}",
                f"file_prev_text={'on' if FILE_CONDITION_ON_PREVIOUS_TEXT else 'off'}",
            ],
        }
        return self.runtime

    def transcribe_chunk(self, pcm_base64: str, language: str, prompt: str | None) -> dict[str, Any]:
        self._ensure_model()
        audio = self._decode_pcm16le(pcm_base64)
        segments, info = self._run_with_cuda_fallback(
            lambda: self.model.transcribe(
                audio,
                language=language,
                initial_prompt=prompt or None,
                beam_size=REALTIME_BEAM_SIZE,
                best_of=REALTIME_BEST_OF,
                temperature=0.0,
                condition_on_previous_text=True,
                vad_filter=REALTIME_VAD_FILTER,
                vad_parameters={
                    "min_silence_duration_ms": 400,
                    "speech_pad_ms": 200,
                },
                word_timestamps=False,
            )
        )
        text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
        return {
            "text": text,
            "language": getattr(info, "language", language),
        }

    def transcribe_file(
        self,
        file_path: str,
        language: str,
        prompt: str | None,
        request_id: int,
    ) -> dict[str, Any]:
        self._ensure_model()
        transcribe_kwargs = {
            "language": language,
            "initial_prompt": prompt or None,
            "beam_size": FILE_BEAM_SIZE,
            "best_of": FILE_BEST_OF,
            "temperature": 0.0,
            "condition_on_previous_text": FILE_CONDITION_ON_PREVIOUS_TEXT,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 500,
                "speech_pad_ms": 250,
            },
            "word_timestamps": False,
        }

        def run_file_transcribe():
            if self.file_pipeline is not None:
                return self.file_pipeline.transcribe(
                    file_path,
                    batch_size=self.file_batch_size,
                    chunk_length=self.file_chunk_length,
                    **transcribe_kwargs,
                )

            return self.model.transcribe(file_path, **transcribe_kwargs)

        segments, info = self._run_with_cuda_fallback(run_file_transcribe)

        full_text: list[str] = []
        total_duration = float(getattr(info, "duration", 0.0) or 0.0)

        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue

            full_text.append(text)
            progress = -1
            if total_duration > 0:
                progress = min(99, round((float(segment.end) / total_duration) * 100))

            emit(
                {
                    "event": "file_progress",
                    "request_id": request_id,
                    "progress": progress,
                    "text": text,
                    "start_seconds": float(getattr(segment, "start", 0.0) or 0.0),
                }
            )

        emit(
            {
                "event": "file_progress",
                "request_id": request_id,
                "progress": 100,
                "text": "",
            }
        )

        return {
            "text": "\n".join(full_text).strip(),
            "language": getattr(info, "language", language),
        }

    def shutdown(self) -> dict[str, Any]:
        self.model = None
        self.file_pipeline = None
        return {"ok": True}

    def _ensure_model(self) -> None:
        if self.model is None:
            raise WorkerError("Model is not initialized.")

    def _decode_pcm16le(self, pcm_base64: str):
        pcm_bytes = base64.b64decode(pcm_base64.encode("ascii"))
        int_samples = self.np.frombuffer(pcm_bytes, dtype=self.np.int16)
        return int_samples.astype(self.np.float32) / 32768.0

    def _run_with_cuda_fallback(self, operation):
        try:
            return operation()
        except Exception as exc:
            if not self._should_fallback_to_cpu(exc):
                raise

            emit(
                {
                    "event": "warning",
                    "warning": "CUDA runtime DLL not available. Falling back to CPU transcription.",
                }
            )
            self._reinitialize_model_on_cpu()
            return operation()

    def _get_cuda_device_count(self) -> int:
        try:
            return int(self.ctranslate2.get_cuda_device_count())
        except Exception:
            return 0

    def _resolve_device_index(self, raw_value: str, cuda_device_count: int):
        if raw_value:
            if "," in raw_value:
                return [int(part.strip()) for part in raw_value.split(",") if part.strip()]
            return int(raw_value)

        if cuda_device_count > 1:
            return list(range(cuda_device_count))

        return 0

    def _should_fallback_to_cpu(self, exc: Exception) -> bool:
        if not self.runtime.get("gpuEnabled"):
            return False

        message = str(exc).lower()
        return any(
            token in message
            for token in (
                "cublas64_12.dll",
                "cudnn",
                "cuda",
                "nvcuda",
                "cannot be loaded",
                "not found",
            )
        )

    def _reinitialize_model_on_cpu(self) -> None:
        cpu_threads = max(1, min(8, os.cpu_count() or 1))
        self.model = self.WhisperModel(
            self.model_name,
            device="cpu",
            device_index=0,
            compute_type="int8",
            cpu_threads=cpu_threads,
            num_workers=CPU_NUM_WORKERS,
        )
        self.file_pipeline = self.BatchedInferencePipeline(self.model)
        self.file_batch_size = FILE_BATCH_SIZE_CPU
        self.file_chunk_length = FILE_CHUNK_LENGTH_CPU
        existing_notes = [note for note in self.runtime.get("notes", []) if not note.startswith("fallback=")]
        self.runtime = {
            **self.runtime,
            "backend": "cpu",
            "gpuEnabled": False,
            "notes": [*existing_notes, "fallback=cpu(cuda-runtime-missing)"],
        }


def handle_request(worker: FasterWhisperWorker, request: dict[str, Any]) -> dict[str, Any]:
    request_type = request.get("type")

    if request_type == "init":
        return {"runtime": worker.init_model(str(request.get("modelName") or "small"))}

    if request_type == "transcribe_chunk":
        return worker.transcribe_chunk(
            str(request.get("audioBase64") or ""),
            str(request.get("language") or "ko"),
            request.get("prompt"),
        )

    if request_type == "transcribe_file":
        return worker.transcribe_file(
            str(request.get("filePath") or ""),
            str(request.get("language") or "ko"),
            request.get("prompt"),
            int(request.get("id") or 0),
        )

    if request_type == "dispose":
        return worker.shutdown()

    raise WorkerError(f"Unknown request type: {request_type}")


def main() -> int:
    try:
        worker = FasterWhisperWorker()
    except Exception as exc:
        emit(
            {
                "event": "startup_error",
                "error": str(exc),
                "traceback": traceback.format_exc(),
            }
        )
        return 1

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue

        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id")
            result = handle_request(worker, request)
            emit({"id": request_id, "success": True, "result": result})
        except Exception as exc:
            emit(
                {
                    "id": request_id,
                    "success": False,
                    "error": str(exc),
                    "traceback": traceback.format_exc(),
                }
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
