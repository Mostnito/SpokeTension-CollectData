const SUPPORTED_SAMPLE_RATES = [32000, 44100, 48000];

function captureWaveform(chunks, points = 200) {
  const total = chunks.reduce((length, chunk) => length + chunk.length, 0);
  const peaks = new Float32Array(points);
  let offset = 0;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      const bucket = Math.min(points - 1, Math.floor(offset++ / total * points));
      if (Number.isFinite(sample) && Math.abs(sample) > Math.abs(peaks[bucket])) peaks[bucket] = sample;
    }
  }
  return Uint8Array.from(peaks, (peak) => 128 + Math.round(Math.max(-1, Math.min(1, peak)) * 127));
}

export class RecordingError extends Error {
  constructor(code, cause) {
    super(code, { cause });
    this.name = 'RecordingError';
    this.code = code;
  }
}

function cancelled() {
  return new DOMException('Recording cancelled', 'AbortError');
}

function mapCaptureError(error) {
  if (error.name === 'AbortError' || error instanceof RecordingError) return error;
  const codes = {
    NotAllowedError: 'microphoneDenied',
    PermissionDeniedError: 'microphoneDenied',
    NotFoundError: 'microphoneMissing',
    DevicesNotFoundError: 'microphoneMissing',
    NotReadableError: 'microphoneBusy',
    TrackStartError: 'microphoneBusy',
    SecurityError: 'microphoneInsecure',
  };
  return new RecordingError(codes[error.name] || 'microphoneFailed', error);
}

export class SpokeRecorder {
  constructor() {
    this._status = 'idle';
    this._generation = 0;
    this._chunks = [];
    this._resources = null;
    this._worker = null;
    this._rejectEncoding = null;
    this._flush = null;
    this._animation = null;
  }

  get status() {
    return this._status;
  }

  async start({ onWaveform, onInterrupted } = {}) {
    if (this._status !== 'idle') throw new RecordingError('recorderBusy');
    if (!globalThis.isSecureContext || !globalThis.navigator?.mediaDevices?.getUserMedia) {
      throw new RecordingError('microphoneInsecure');
    }
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Context || !globalThis.AudioWorkletNode || !globalThis.Worker) {
      throw new RecordingError('audioUnsupported');
    }
    const generation = ++this._generation;
    this._status = 'requesting';
    this._chunks = [];
    const resources = { context: null, stream: null, source: null, analyser: null, capture: null, gain: null };
    this._resources = resources;
    const checkCancelled = () => {
      if (generation !== this._generation) throw cancelled();
    };
    try {
      const context = new Context();
      resources.context = context;
      if (!SUPPORTED_SAMPLE_RATES.includes(context.sampleRate)) {
        throw new RecordingError('audioUnsupportedSampleRate');
      }
      // Resume while this call still belongs to the user's click/tap gesture.
      await context.resume();
      checkCancelled();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });
      resources.stream = stream;
      checkCancelled();
      if (!context.audioWorklet) throw new RecordingError('audioUnsupported');
      await context.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url));
      checkCancelled();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const capture = new AudioWorkletNode(context, 'spoke-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      const gain = context.createGain();
      gain.gain.value = 0;
      Object.assign(resources, { source, analyser, capture, gain });
      capture.port.onmessage = ({ data }) => {
        if (generation !== this._generation) return;
        if (data.type === 'samples') this._chunks.push(data.samples);
        if (data.type === 'stopped') this._flush?.resolve();
      };
      capture.onprocessorerror = () => this._interrupt(generation, onInterrupted);
      source.connect(analyser);
      analyser.connect(capture);
      capture.connect(gain);
      gain.connect(context.destination);
      this._recordedAt = new Date().toISOString();
      this._sampleRate = context.sampleRate;
      this._status = 'recording';
      const interrupt = () => this._interrupt(generation, onInterrupted);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', interrupt, { once: true });
      context.onstatechange = () => {
        if (context.state !== 'running') interrupt();
      };
      if (onWaveform) {
        const draw = () => {
          if (generation !== this._generation || this._status !== 'recording') return;
          const values = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(values);
          onWaveform(values);
          this._animation = requestAnimationFrame(draw);
        };
        this._animation = requestAnimationFrame(draw);
      }
      if (context.state !== 'running') throw new RecordingError('recordingInterrupted');
    } catch (error) {
      await this._cleanupResources(resources);
      if (generation === this._generation) {
        this._status = 'idle';
        this._resources = null;
        this._chunks = [];
      }
      throw mapCaptureError(error);
    }
  }

  _interrupt(generation, callback) {
    if (generation !== this._generation || this._status !== 'recording') return;
    void this.cancel();
    callback?.(new RecordingError('recordingInterrupted'));
  }

  async stop() {
    if (this._status !== 'recording') throw new RecordingError('recorderNotRecording');
    const generation = this._generation;
    const resources = this._resources;
    this._status = 'encoding';
    cancelAnimationFrame(this._animation);
    this._animation = null;
    try {
      // Messages share one port: the flush acknowledgement follows every final PCM block.
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new RecordingError('recordingInterrupted')), 3000);
        this._flush = {
          resolve: () => { clearTimeout(timeout); resolve(); },
          reject: (error) => { clearTimeout(timeout); reject(error); },
        };
        resources.capture.port.postMessage({ type: 'stop' });
      });
      this._flush = null;
      await this._cleanupResources(resources);
      if (generation !== this._generation) throw cancelled();
      this._resources = null;
      const chunks = this._chunks;
      this._chunks = [];
      if (!chunks.some((chunk) => chunk.length)) throw new RecordingError('audioEmpty');
      const sampleRate = this._sampleRate;
      const recordedAt = this._recordedAt;
      const waveform = captureWaveform(chunks);
      const result = await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./mp3-worker.js', import.meta.url), { type: 'module' });
        this._worker = worker;
        this._rejectEncoding = reject;
        worker.onmessage = ({ data }) => {
          if (data.error) reject(new RecordingError(data.error));
          else resolve(data);
        };
        worker.onerror = (event) => reject(new RecordingError('audioEncodingFailed', event.error));
        worker.postMessage({ chunks, sampleRate }, chunks.map((chunk) => chunk.buffer));
      });
      if (generation !== this._generation) throw cancelled();
      const blob = new Blob([result.bytes], { type: 'audio/mpeg' });
      return {
        blob,
        recorded_at: recordedAt,
        duration_ms: Math.round(result.sampleCount / sampleRate * 1000),
        sample_rate_hz: sampleRate,
        channels: 1,
        bitrate_kbps: 192,
        audio_size_bytes: blob.size,
        audio_mime: 'audio/mpeg',
        waveform,
      };
    } finally {
      if (generation === this._generation) {
        this._flush = null;
        this._worker?.terminate();
        this._worker = null;
        this._rejectEncoding = null;
        this._chunks = [];
        this._status = 'idle';
        await this._cleanupResources(resources);
        this._resources = null;
      }
    }
  }

  async cancel() {
    ++this._generation;
    const resources = this._resources;
    this._resources = null;
    this._flush?.reject(cancelled());
    this._flush = null;
    this._worker?.terminate();
    this._worker = null;
    this._rejectEncoding?.(cancelled());
    this._rejectEncoding = null;
    this._chunks = [];
    cancelAnimationFrame(this._animation);
    this._animation = null;
    this._status = 'idle';
    await this._cleanupResources(resources);
  }

  dispose() {
    return this.cancel();
  }

  async _cleanupResources(resources) {
    if (!resources) return;
    if (resources.context) resources.context.onstatechange = null;
    if (resources.capture) {
      resources.capture.port.onmessage = null;
      resources.capture.onprocessorerror = null;
    }
    for (const node of [resources.source, resources.analyser, resources.capture, resources.gain]) {
      try { node?.disconnect(); } catch { /* A pending start may already have been cancelled. */ }
    }
    for (const track of resources.stream?.getTracks() || []) track.stop();
    if (resources.context && resources.context.state !== 'closed') {
      try { await resources.context.close(); } catch { /* Closing twice is harmless during cancellation. */ }
    }
  }
}
