import { Mp3Encoder } from '@breezystack/lamejs';

export const MP3_BITRATE_KBPS = 192;
// MPEG-1 sample rates retain the requested 192 kbps bitrate.
export const MP3_SAMPLE_RATES = [32000, 44100, 48000];

export function floatToPcm16(value) {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return Math.round(clamped * (clamped < 0 ? 32768 : 32767));
}

/** Encode captured PCM without normalizing, trimming, or changing its sample rate. */
export function encodeMp3(chunks, sampleRate) {
  if (!MP3_SAMPLE_RATES.includes(sampleRate)) {
    throw new Error('audioUnsupportedSampleRate');
  }
  const source = chunks instanceof Float32Array ? [chunks] : chunks;
  const sampleCount = source.reduce((count, chunk) => count + chunk.length, 0);
  if (!sampleCount) throw new Error('audioEmpty');
  const encoder = new Mp3Encoder(1, sampleRate, MP3_BITRATE_KBPS);
  const frame = new Int16Array(1152);
  const output = [];
  let length = 0;
  const append = (part) => {
    if (part.length) output.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength).slice());
  };
  for (const chunk of source) {
    for (const sample of chunk) {
      frame[length++] = floatToPcm16(sample);
      if (length === frame.length) {
        append(encoder.encodeBuffer(frame));
        length = 0;
      }
    }
  }
  if (length) append(encoder.encodeBuffer(frame.subarray(0, length)));
  append(encoder.flush());
  const bytes = new Uint8Array(output.reduce((size, part) => size + part.byteLength, 0));
  let offset = 0;
  for (const part of output) {
    bytes.set(part, offset);
    offset += part.length;
  }
  if (!bytes.length) throw new Error('audioEncodingFailed');
  return { bytes, sampleCount };
}
