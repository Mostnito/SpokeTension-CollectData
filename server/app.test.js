import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.js';

async function serve(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (path, body) => {
    const response = await fetch(`${base}${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { response, data: await response.json() };
  };
}

function fixture(initial = []) {
  const rows = [...initial];
  let inserts = 0;
  const storage = {
    createSignedUploadUrl: async (path) => ({ data: { signedUrl: `https://storage.example/${path}?token=storage-token` }, error: null }),
    info: async () => ({ data: { size: 2048, contentType: 'audio/mpeg' }, error: null }),
    createSignedUrls: async (paths) => ({ data: paths.map((path) => ({ path, signedUrl: `https://storage.example/${path}?token=download-token`, error: null })), error: null }),
  };
  const client = {
    storage: { from: () => storage, getBucket: async () => ({ data: { id: 'spoke-recordings', public: false }, error: null }) },
    from: () => {
      let selectedId;
      let inserted;
      const query = {
        select: () => query,
        order: () => query,
        limit: async (count) => ({ data: rows.slice(0, count), error: null }),
        eq: (_column, value) => { selectedId = value; return query; },
        maybeSingle: async () => ({ data: rows.find((row) => row.id === selectedId) || null, error: null }),
        range: async (start, end) => ({ data: rows.slice(start, end + 1), error: null }),
        insert: (row) => { inserted = row; return query; },
        single: async () => {
          inserts++;
          const row = { ...inserted, created_at: '2026-11-25T04:00:01.000Z' };
          rows.push(row);
          return { data: row, error: null };
        },
      };
      return query;
    },
  };
  return { rows, storage, client, get inserts() { return inserts; }, options: { env: { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' }, clientFactory: () => client, now: () => 1000 } };
}

const metadata = {
  recorded_at: '2026-11-25T04:00:00.000Z', recorder: 'Most', wheel_type: 'front',
  spoke_length_mm: 290, spoke_diameter_mm: 2, tension_kgf: 100, temperature_c: 24,
  environment: 'quiet', duration_ms: 3000, sample_rate_hz: 48000, channels: 1, bitrate_kbps: 192,
};

test('unconfigured API reports setup state without pretending to save', async (t) => {
  const request = await serve(t, { env: {} });
  const status = await request('/api/status');
  assert.equal(status.response.status, 200);
  assert.equal(status.data.configured, false);
  assert.equal(status.data.connected, false);
  assert.equal(status.response.headers.get('cache-control'), 'no-store');
  for (const [path, body] of [['/api/records', undefined], ['/api/uploads', { audio_size_bytes: 2048 }]]) {
    const result = await request(path, body);
    assert.equal(result.response.status, 503);
    assert.equal(result.data.error.code, 'NOT_CONFIGURED');
  }
});

test('status verifies both database access and private storage before reporting connected', async (t) => {
  const mock = fixture();
  const request = await serve(t, mock.options);
  const healthy = await request('/api/status');
  assert.equal(healthy.data.configured, true);
  assert.equal(healthy.data.connected, true);
  mock.client.storage.getBucket = async () => ({ data: null, error: { message: 'Provider response contains server-secret' } });
  const missingBucket = await request('/api/status');
  assert.equal(missingBucket.data.configured, true);
  assert.equal(missingBucket.data.connected, false);
  assert.equal(missingBucket.data.error.code, 'CONNECTION_FAILED');
  assert.equal(JSON.stringify(missingBucket.data).includes('server-secret'), false);
  mock.client.storage.getBucket = async () => ({ data: { public: true }, error: null });
  const publicBucket = await request('/api/status');
  assert.equal(publicBucket.data.connected, false);
  assert.equal(publicBucket.data.error.code, 'BUCKET_NOT_PRIVATE');
});

test('status reports configured but disconnected when database access fails', async (t) => {
  const mock = fixture();
  const from = mock.client.from;
  mock.client.from = (...args) => {
    const query = from(...args);
    query.limit = async () => ({ data: null, error: { message: 'bad credentials server-secret' } });
    return query;
  };
  const request = await serve(t, mock.options);
  const result = await request('/api/status');
  assert.equal(result.response.status, 200);
  assert.equal(result.data.configured, true);
  assert.equal(result.data.connected, false);
  assert.equal(JSON.stringify(result.data).includes('server-secret'), false);
});

test('signed upload and finalization save validated metadata and retry idempotently', async (t) => {
  const mock = fixture();
  const request = await serve(t, mock.options);
  const { data: upload, response } = await request('/api/uploads', { audio_size_bytes: 2048 });
  assert.equal(response.status, 201);
  assert.equal(upload.audio_path, `${upload.id}.mp3`);
  assert.equal(upload.upload_url.includes('storage-token'), true);
  assert.equal(JSON.stringify(upload).includes('server-secret'), false);
  const body = { ...metadata, id: upload.id, upload_token: upload.upload_token, audio_path: 'injected.mp3', audio_size_bytes: 500 };
  const saved = await request('/api/records', body);
  assert.equal(saved.response.status, 201);
  assert.equal(saved.data.record.audio_size_bytes, 2048);
  assert.equal(saved.data.record.audio_path, upload.audio_path);
  assert.equal(saved.data.record.audio_url.includes('download-token'), true);
  const retry = await request('/api/records', body);
  assert.equal(retry.response.status, 200);
  assert.equal(mock.inserts, 1);
});

test('an expired receipt can recover a completed save but cannot insert a new recording', async (t) => {
  const mock = fixture();
  let clock = 1000;
  mock.options.now = () => clock;
  const request = await serve(t, mock.options);
  const { data: upload } = await request('/api/uploads', { audio_size_bytes: 2048 });
  const body = { ...metadata, id: upload.id, upload_token: upload.upload_token };
  const saved = await request('/api/records', body);
  assert.equal(saved.response.status, 201);
  clock += 2 * 60 * 60 * 1000;
  const retry = await request('/api/records', body);
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.record.id, upload.id);
  assert.equal(mock.inserts, 1);
  const { data: unfinished } = await request('/api/uploads', { audio_size_bytes: 2048 });
  clock += 2 * 60 * 60 * 1000;
  const expired = await request('/api/records', { ...metadata, id: unfinished.id, upload_token: unfinished.upload_token });
  assert.equal(expired.response.status, 400);
  assert.equal(expired.data.error.code, 'INVALID_UPLOAD');
  assert.equal(mock.inserts, 1);
});

test('finalization rejects failed or mismatched storage uploads before any insert', async (t) => {
  const mock = fixture();
  const request = await serve(t, mock.options);
  const { data: upload } = await request('/api/uploads', { audio_size_bytes: 2048 });
  const body = { ...metadata, id: upload.id, upload_token: upload.upload_token };
  for (const object of [{ size: 2047, contentType: 'audio/mpeg' }, { size: 2048, contentType: 'text/plain' }]) {
    mock.storage.info = async () => ({ data: object, error: null });
    const result = await request('/api/records', body);
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, 'INVALID_AUDIO');
  }
  mock.storage.info = async () => ({ data: null, error: { message: 'missing' } });
  const missing = await request('/api/records', body);
  assert.equal(missing.response.status, 409);
  assert.equal(mock.inserts, 0);
});

test('record listing includes every database page and matching signed audio URL', async (t) => {
  const mock = fixture(Array.from({ length: 1003 }, (_, i) => ({ id: String(i), audio_path: `${i}.mp3` })));
  const request = await serve(t, mock.options);
  const result = await request('/api/records');
  assert.equal(result.response.status, 200);
  assert.equal(result.data.records.length, 1003);
  assert.equal(result.data.records[1002].audio_url, 'https://storage.example/1002.mp3?token=download-token');
});
