import test from 'node:test';
import assert from 'node:assert/strict';
import { saveRecording, request } from '../src/lib/api.js';
import { encodeMp3 } from '../src/audio/encode-mp3.js';

const metadata = {
  recorder: 'Sally', wheel_type: 'rear', spoke_length_mm: 284,
  spoke_diameter_mm: 1.8, tension_kgf: 104.25, temperature_c: 23.5,
  environment: 'quiet',
};
const reservation = {
  id: '65d1705c-5675-417f-8f9e-439466d83f80',
  upload_url: 'https://storage.example.test/signed-upload',
  upload_token: 'server-signed-upload-receipt',
};
const samples = Float32Array.from({ length: 4800 }, (_, i) => 0.4 * Math.sin(2 * Math.PI * 550 * i / 48000));
const { bytes } = encodeMp3(samples, 48000);
const audio = {
  blob: new Blob([bytes], { type: 'audio/mpeg' }),
  recorded_at: '2026-11-25T04:30:00.000Z', duration_ms: 100,
  sample_rate_hz: 48000, channels: 1, bitrate_kbps: 192,
  waveform: new Uint8Array(200).fill(128),
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const saved = { ...metadata, id: reservation.id, audio_mime: 'audio/mpeg' };

test('saving uploads actual MPEG bytes with audio/mpeg and finalizes exactly matching capture metadata', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/uploads') return json(reservation, 201);
    if (url === reservation.upload_url) return new Response(null, { status: 200 });
    if (url === '/api/records') return json({ record: saved }, 201);
    assert.fail(`Unexpected URL ${url}`);
  });
  assert.deepEqual(await saveRecording(metadata, audio), saved);
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['/api/uploads', 'POST'], [reservation.upload_url, 'PUT'], ['/api/records', 'POST'],
  ]);
  const upload = calls[1].options;
  assert.equal(upload.headers['Content-Type'], 'audio/mpeg');
  assert.equal(upload.body.type, 'audio/mpeg');
  const uploaded = new Uint8Array(await upload.body.arrayBuffer());
  assert.equal(uploaded[0], 0xff, 'real MP3 frame sync, not a renamed WebM or WAV file');
  assert.equal(uploaded[1] & 0xfe, 0xfa, 'MPEG-1 Layer III');
  assert.deepEqual(uploaded, bytes);
  assert.deepEqual(JSON.parse(calls[0].options.body), { audio_size_bytes: bytes.length });
  const commit = JSON.parse(calls[2].options.body);
  assert.deepEqual(commit, {
    ...metadata, id: reservation.id, upload_token: reservation.upload_token,
    recorded_at: audio.recorded_at, duration_ms: 100, sample_rate_hz: 48000,
    channels: 1, bitrate_kbps: 192, audio_size_bytes: bytes.length,
  });
  assert.equal('blob' in commit, false, 'binary audio never passes through the Vercel JSON API');
  assert.equal('waveform' in commit, false);
});

test('an ambiguous commit failure preserves the receipt so retry only finalizes the same id', async (t) => {
  const calls = [];
  let failedCommit = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/uploads') return json(reservation, 201);
    if (url === reservation.upload_url) return new Response(null, { status: 200 });
    if (url === '/api/records' && !failedCommit) {
      failedCommit = true;
      throw new TypeError('Network connection lost after upload');
    }
    return json({ record: saved });
  });
  let retry;
  await assert.rejects(saveRecording(metadata, audio), (error) => {
    retry = error.reservation;
    assert.deepEqual(retry, reservation);
    return true;
  });
  assert.deepEqual(await saveRecording(metadata, audio, retry), saved);
  assert.equal(calls.length, 4);
  assert.equal(calls.filter(({ url }) => url === '/api/uploads').length, 1);
  assert.equal(calls.filter(({ options }) => options.method === 'PUT').length, 1);
  const commits = calls.filter(({ url }) => url === '/api/records').map(({ options }) => JSON.parse(options.body));
  assert.equal(commits[0].id, commits[1].id);
  assert.equal(commits[0].upload_token, commits[1].upload_token);
});

test('a transient database error keeps the already uploaded object available for commit retry', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => json({ error: {
    code: 'DATABASE_ERROR', message: 'Audio uploaded, metadata temporarily unavailable.',
  } }, 502));
  await assert.rejects(saveRecording(metadata, audio, reservation), (error) => {
    assert.equal(error.code, 'DATABASE_ERROR');
    assert.deepEqual(error.reservation, reservation);
    return true;
  });
});

for (const code of ['INVALID_UPLOAD', 'UPLOAD_NOT_FOUND', 'INVALID_AUDIO']) {
  test(`${code} clears a failed reservation so the next save can obtain a new upload`, async (t) => {
    const calls = [];
    const next = { ...reservation, id: '0aa2e784-fd3b-45b0-9cdc-c8c54f49f27d', upload_token: 'new-receipt' };
    let rejectCommit = true;
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, options });
      if (rejectCommit) {
        rejectCommit = false;
        return json({ error: { code, message: 'The previous upload cannot be reused.' } }, 400);
      }
      if (url === '/api/uploads') return json(next, 201);
      if (url === next.upload_url) return new Response(null, { status: 200 });
      return json({ record: { ...saved, id: next.id } }, 201);
    });
    let retry;
    await assert.rejects(saveRecording(metadata, audio, reservation), (error) => {
      retry = error.reservation;
      assert.equal(error.code, code);
      assert.equal(retry, null);
      return true;
    });
    const result = await saveRecording(metadata, audio, retry);
    assert.equal(result.id, next.id);
    assert.deepEqual(calls.map(({ url }) => url), ['/api/records', '/api/uploads', next.upload_url, '/api/records']);
    assert.equal(JSON.parse(calls.at(-1).options.body).upload_token, next.upload_token);
  });
}

test('an upload HTTP failure never attempts metadata commit or returns a reusable reservation', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    calls.push(url);
    return url === '/api/uploads' ? json(reservation, 201) : new Response(null, { status: 503 });
  });
  await assert.rejects(saveRecording(metadata, audio), (error) => {
    assert.match(error.message, /Audio upload failed/);
    assert.equal(error.reservation, undefined);
    return true;
  });
  assert.deepEqual(calls, ['/api/uploads', reservation.upload_url]);
});

test('request preserves API error codes and rejects an invalid successful JSON response', async (t) => {
  let first = true;
  t.mock.method(globalThis, 'fetch', async () => {
    if (first) {
      first = false;
      return json({ error: { code: 'NOT_CONFIGURED', message: 'Supabase is not connected.' } }, 503);
    }
    return new Response('<html>Bad upstream response</html>', { status: 200 });
  });
  await assert.rejects(request('/status'), { code: 'NOT_CONFIGURED', message: 'Supabase is not connected.' });
  await assert.rejects(request('/status'), /invalid response/);
});
