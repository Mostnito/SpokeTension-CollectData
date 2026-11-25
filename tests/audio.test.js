import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { encodeMp3 } from '../src/audio/encode-mp3.js';
import { SpokeRecorder } from '../src/audio/recorder.js';

function inspectMp3(bytes) {
  const bitrateTable = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
  const sampleRates = [44100, 48000, 32000];
  const frames = [];
  let offset = 0;
  while (offset < bytes.length) {
    assert.equal(bytes[offset], 0xff, 'MP3 sync byte');
    assert.equal(bytes[offset + 1] & 0xfe, 0xfa, 'MPEG-1 Layer III frame header');
    const bitrate = bitrateTable[bytes[offset + 2] >> 4];
    const sampleRate = sampleRates[(bytes[offset + 2] >> 2) & 3];
    const padding = (bytes[offset + 2] >> 1) & 1;
    const channelMode = bytes[offset + 3] >> 6;
    const size = Math.floor(144_000 * bitrate / sampleRate) + padding;
    assert.ok(size > 0 && offset + size <= bytes.length, 'complete MPEG frame');
    frames.push({ bitrate, sampleRate, channelMode });
    offset += size;
  }
  assert.equal(offset, bytes.length, 'no truncated or unrelated trailing bytes');
  return frames;
}

for (const sampleRate of [32000, 44100, 48000]) {
  test(`produces actual mono 192 kbps MPEG audio at ${sampleRate} Hz with the final partial block`, () => {
    const samples = new Float32Array(5003);
    for (let i = 0; i < samples.length; i += 1) samples[i] = Math.sin(2 * Math.PI * 440 * i / sampleRate) * 0.5;
    // Deliberately split across both encoder and worklet block boundaries.
    const { bytes, sampleCount } = encodeMp3([samples.slice(0, 4096), samples.slice(4096)], sampleRate);
    const frames = inspectMp3(bytes);
    assert.equal(sampleCount, samples.length);
    assert.ok(frames.length * 1152 >= samples.length, 'last partial PCM block was encoded');
    assert.ok(frames.length * 1152 < samples.length + 3456, 'normal encoder delay/padding only');
    for (const frame of frames) {
      assert.equal(frame.sampleRate, sampleRate);
      assert.equal(frame.bitrate, 192);
      assert.equal(frame.channelMode, 3, 'mono');
    }
  });
}

test('refuses empty PCM and unsupported MP3 sample rates instead of mislabelling output', () => {
  assert.throws(() => encodeMp3([], 44100), /audioEmpty/);
  assert.throws(() => encodeMp3(new Float32Array(50), 96000), /audioUnsupportedSampleRate/);
});

test('audio worklet preserves every final sample and mixes multiple input channels to mono', async () => {
  const messages = [];
  let Processor;
  const context = {
    AudioWorkletProcessor: class {
      constructor() { this.port = { postMessage: (message) => messages.push(message) }; }
    },
    registerProcessor: (_name, implementation) => { Processor = implementation; },
    Float32Array,
  };
  vm.runInNewContext(await readFile(new URL('../src/audio/capture-worklet.js', import.meta.url), 'utf8'), context);
  const processor = new Processor();
  const left = Float32Array.from({ length: 5003 }, (_, i) => Math.sin(i / 50));
  const right = Float32Array.from({ length: 5003 }, (_, i) => Math.cos(i / 50));
  processor.process([[left, right]]);
  processor.port.onmessage({ data: { type: 'stop' } });
  assert.equal(messages.at(-1).type, 'stopped', 'flush ack is sent after all captured PCM');
  const pcm = messages.filter((message) => message.type === 'samples').flatMap((message) => [...message.samples]);
  assert.equal(pcm.length, 5003);
  for (let i = 0; i < pcm.length; i += 1) assert.ok(Math.abs(pcm[i] - (left[i] + right[i]) / 2) < 1e-7);
  assert.equal(processor.process([[left]]), false, 'stopped worklet does not capture more samples');
});

function replaceGlobal(t, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  });
}

test('cancelling a pending microphone request also stops a stream that arrives after cancellation', async (t) => {
  let resolveStream;
  let trackStopped = 0;
  let contextClosed = 0;
  replaceGlobal(t, 'isSecureContext', true);
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia: () => new Promise((resolve) => { resolveStream = resolve; }) } });
  replaceGlobal(t, 'AudioContext', class {
    sampleRate = 48000;
    state = 'running';
    async resume() {}
    async close() { this.state = 'closed'; contextClosed += 1; }
  });
  replaceGlobal(t, 'AudioWorkletNode', class {});
  replaceGlobal(t, 'Worker', class {});
  replaceGlobal(t, 'cancelAnimationFrame', () => {});
  const recorder = new SpokeRecorder();
  const pending = recorder.start();
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await Promise.resolve();
  assert.equal(recorder.status, 'requesting');
  await recorder.cancel();
  resolveStream({ getTracks: () => [{ stop: () => { trackStopped += 1; } }] });
  await rejected;
  assert.equal(trackStopped, 1);
  assert.equal(contextClosed, 1);
  assert.equal(recorder.status, 'idle');
});
