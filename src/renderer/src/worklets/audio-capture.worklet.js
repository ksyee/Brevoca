class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.chunkSize = options.processorOptions?.chunkSize ?? 2048;
    this.buffer = new Float32Array(this.chunkSize);
    this.writePos = 0;

    this.port.onmessage = (event) => {
      if (event.data?.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  flush() {
    if (this.writePos === 0) return;

    const chunk = this.buffer.slice(0, this.writePos);
    this.port.postMessage({ type: "audio", audioData: chunk.buffer }, [chunk.buffer]);
    this.writePos = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input?.[0];
    if (!channel || channel.length === 0) {
      return true;
    }

    let offset = 0;
    while (offset < channel.length) {
      const writable = Math.min(this.chunkSize - this.writePos, channel.length - offset);
      this.buffer.set(channel.subarray(offset, offset + writable), this.writePos);
      this.writePos += writable;
      offset += writable;

      if (this.writePos === this.chunkSize) {
        const chunk = this.buffer.slice(0, this.writePos);
        this.port.postMessage({ type: "audio", audioData: chunk.buffer }, [chunk.buffer]);
        this.writePos = 0;
      }
    }

    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
