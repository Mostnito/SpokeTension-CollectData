// Capture the unprocessed mono input. The output remains silent.
class SpokeCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = true;
    this.buffer = new Float32Array(4096);
    this.length = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'stop') {
        this.active = false;
        this.flush();
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }

  flush() {
    if (!this.length) return;
    const samples = this.buffer.slice(0, this.length);
    this.port.postMessage({ type: 'samples', samples }, [samples.buffer]);
    this.length = 0;
  }

  process(inputs) {
    if (!this.active) return false;
    const channels = inputs[0];
    if (!channels?.length) return true;
    const frames = channels[0].length;
    for (let i = 0; i < frames; i += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[i] || 0;
      this.buffer[this.length++] = sample / channels.length;
      if (this.length === this.buffer.length) this.flush();
    }
    return true;
  }
}

registerProcessor('spoke-capture', SpokeCaptureProcessor);
