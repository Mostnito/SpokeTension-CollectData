import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRecord, validateUpload, MAX_AUDIO_BYTES } from './validation.js';
import { createUploadReservation, verifyUploadReservation } from './reservations.js';

const id = 'a416ac07-11bd-4842-9b64-a4231d269f57';
const valid = {
  id, upload_token: 'receipt', recorded_at: '2026-11-25T04:00:00.000Z',
  recorder: 'Most', wheel_type: 'front', spoke_length_mm: 290, spoke_diameter_mm: 2,
  tension_kgf: 100, temperature_c: 24, environment: 'quiet', duration_ms: 3000,
  sample_rate_hz: 48000, channels: 1, bitrate_kbps: 192,
};

test('validation derives storage fields and does not accept client storage overrides', () => {
  const record = validateRecord({ ...valid, audio_path: '../other.mp3', audio_mime: 'text/plain', audio_size_bytes: 10, extra: 'discarded' });
  assert.equal(record.audio_path, `${id}.mp3`);
  assert.equal(record.audio_mime, 'audio/mpeg');
  assert.equal(record.schema_version, 1);
  assert.equal('upload_token' in record, false);
  assert.equal('audio_size_bytes' in record, false);
  assert.equal('extra' in record, false);
});

test('validation rejects missing, coerced, nonfinite and physically impossible values', () => {
  for (const patch of [
    { tension_kgf: '' }, { tension_kgf: 0 }, { spoke_length_mm: -1 },
    { spoke_diameter_mm: Infinity }, { temperature_c: NaN }, { temperature_c: -274 },
    { duration_ms: 1.5 }, { sample_rate_hz: 0 }, { channels: 2 }, { bitrate_kbps: 128 },
    { recorder: 'Someone' }, { wheel_type: 'other' }, { environment: 'outside' },
    { recorded_at: 'invalid' }, { recorded_at: '1' }, { recorded_at: '2026-11-25T04:00:00' }, { id: '../object' },
  ]) assert.throws(() => validateRecord({ ...valid, ...patch }), { code: 'INVALID_DATA' });
  assert.throws(() => validateRecord(null), { code: 'INVALID_DATA' });
  assert.throws(() => validateRecord([]), { code: 'INVALID_DATA' });
  assert.equal(validateRecord({ ...valid, temperature_c: 0 }).temperature_c, 0);
});

test('upload validation applies the documented Supabase Free file ceiling', () => {
  assert.equal(validateUpload({ audio_size_bytes: MAX_AUDIO_BYTES }).audio_size_bytes, MAX_AUDIO_BYTES);
  for (const size of [0, -1, '100', 1.5, MAX_AUDIO_BYTES + 1]) {
    assert.throws(() => validateUpload({ audio_size_bytes: size }), { code: 'INVALID_DATA' });
  }
});

test('upload reservation is bound to an id, byte length, signing key and expiry', () => {
  const { token, expiresAt } = createUploadReservation(id, 1234, 'test-secret', 1000);
  assert.deepEqual(verifyUploadReservation(token, id, 'test-secret', 1001), { id, size: 1234, expiresAt });
  assert.throws(() => verifyUploadReservation(token, id, 'wrong-secret', 1001), { code: 'INVALID_UPLOAD' });
  assert.throws(() => verifyUploadReservation(token, 'different-id', 'test-secret', 1001), { code: 'INVALID_UPLOAD' });
  assert.throws(() => verifyUploadReservation(token, id, 'test-secret', expiresAt), { code: 'INVALID_UPLOAD' });
  assert.equal(verifyUploadReservation(token, id, 'test-secret', expiresAt, { allowExpired: true }).id, id);
  assert.throws(() => verifyUploadReservation(token, 'different-id', 'test-secret', expiresAt, { allowExpired: true }), { code: 'INVALID_UPLOAD' });
  assert.throws(() => verifyUploadReservation(token, id, 'wrong-secret', expiresAt, { allowExpired: true }), { code: 'INVALID_UPLOAD' });
  const [payload, signature] = token.split('.');
  const tampered = Buffer.from(JSON.stringify({ id, size: 999, expiresAt })).toString('base64url');
  assert.throws(() => verifyUploadReservation(`${tampered}.${signature}`, id, 'test-secret', 1001), { code: 'INVALID_UPLOAD' });
  assert.throws(() => verifyUploadReservation(`${payload}.x`, id, 'test-secret', 1001), { code: 'INVALID_UPLOAD' });
});
