import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.js';
import { createUploadReservation } from './reservations.js';

const id = 'a416ac07-11bd-4842-9b64-a4231d269f57';
const otherId = '07f5e142-c5c3-4f5c-932f-ab8dd53eec06';

function fixture({ missingRecord = false, audioMissing = false } = {}) {
  const state = {
    row: missingRecord ? null : { id, audio_path: `${id}.mp3` }, audioExists: !audioMissing,
    lookupError: null, storageError: null, databaseDeleteError: null,
    storageThrow: false, databaseDeleteThrow: false,
    calls: [],
  };
  const storage = {
    remove: async (paths) => {
      state.calls.push(['storage.remove', paths]);
      if (state.storageThrow) throw new Error('Storage transport failed');
      if (state.storageError) return { data: null, error: state.storageError };
      const data = state.audioExists ? [{ name: `${id}.mp3` }] : [];
      state.audioExists = false;
      return { data, error: null };
    },
    info: async () => {
      state.calls.push(['storage.info']);
      return state.audioExists
        ? { data: { size: 2048, contentType: 'audio/mpeg' }, error: null }
        : { data: null, error: { code: 'NoSuchKey' } };
    },
    createSignedUrls: async (paths) => ({ data: paths.map((path) => ({ path, signedUrl: `https://storage.example/${path}` })), error: null }),
  };
  const client = {
    storage: { from: () => storage },
    from: () => {
      state.calls.push(['database.from']);
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          state.calls.push(['database.lookup']);
          return { data: state.row, error: state.lookupError };
        },
        delete: () => ({
          eq: async (column, selectedId) => {
            state.calls.push(['database.delete', column, selectedId]);
            if (state.databaseDeleteThrow) throw new Error('Database transport failed');
            if (state.databaseDeleteError) return { error: state.databaseDeleteError };
            state.row = null;
            return { error: null };
          },
        }),
        insert: () => { throw new Error('A deleted recording must never be inserted by this flow.'); },
      };
      return query;
    },
  };
  return {
    state,
    options: { env: { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'server-secret' }, clientFactory: () => client, now: () => 1000 },
  };
}

async function serve(t, options) {
  const server = createApp(options).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async (selectedId = id, body = { confirm_id: selectedId }, method = 'DELETE') => {
    const response = await fetch(`${base}/api/records${method === 'DELETE' ? `/${selectedId}` : ''}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { response, data: await response.json() };
  };
}

test('permanent deletion removes only the saved canonical MP3 before metadata, then retries without touching storage', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  const result = await request(id, { confirm_id: id, audio_path: `${otherId}.mp3` });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.data, { deleted: true, id });
  assert.equal(state.row, null);
  assert.equal(state.audioExists, false);
  assert.deepEqual(state.calls.filter(([call]) => call === 'storage.remove'), [['storage.remove', [`${id}.mp3`]]]);
  assert.equal(state.calls.findIndex(([call]) => call === 'storage.remove') < state.calls.findIndex(([call]) => call === 'database.delete'), true);
  state.calls.length = 0;
  const retry = await request();
  assert.equal(retry.response.status, 200);
  assert.equal(retry.data.already_deleted, true);
  assert.equal(state.calls.some(([call]) => call === 'storage.remove' || call === 'database.delete'), false);
});

test('invalid id or mismatched confirmation cannot invoke the database or storage provider', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  for (const [selectedId, body] of [
    ['not-a-uuid', { confirm_id: 'not-a-uuid' }], [id, {}], [id, { confirm_id: otherId }],
    [id, null], [id, { confirm_id: '../file.mp3' }],
  ]) {
    const result = await request(selectedId, body);
    assert.equal(result.response.status, 400);
    assert.equal(result.data.error.code, body === null ? 'INVALID_JSON' : 'INVALID_DATA');
  }
  assert.deepEqual(state.calls, []);
});

test('missing saved row cannot authorize deletion of a storage object', async (t) => {
  const { state, options } = fixture({ missingRecord: true });
  const request = await serve(t, options);
  const result = await request();
  assert.equal(result.response.status, 200);
  assert.equal(result.data.already_deleted, true);
  assert.equal(state.audioExists, true);
  assert.equal(state.calls.some(([call]) => call === 'storage.remove'), false);
});

test('lookup failure and invalid saved path leave every object unchanged', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  state.lookupError = { message: 'provider details server-secret' };
  const failed = await request();
  assert.equal(failed.response.status, 502);
  assert.equal(failed.data.error.code, 'DATABASE_ERROR');
  assert.equal(JSON.stringify(failed.data).includes('server-secret'), false);
  state.lookupError = null;
  state.row.audio_path = `${otherId}.mp3`;
  const invalid = await request();
  assert.equal(invalid.response.status, 500);
  assert.equal(invalid.data.error.code, 'INVALID_STORAGE_PATH');
  assert.equal(state.calls.some(([call]) => call === 'storage.remove' || call === 'database.delete'), false);
});

test('storage failure preserves metadata and does not treat permission or bucket 404 as successful deletion', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  for (const error of [{ code: 'AccessDenied' }, { code: 'NoSuchBucket', statusCode: 404 }, { code: 'NoSuchKey', statusCode: 404 }]) {
    state.storageError = error;
    const result = await request();
    assert.equal(result.response.status, 502);
    assert.equal(result.data.error.code, 'STORAGE_DELETE_FAILED');
    assert.notEqual(state.row, null);
    assert.equal(state.audioExists, true);
  }
  assert.equal(state.calls.some(([call]) => call === 'database.delete'), false);
});

test('metadata failure after audio removal reports partial deletion and an idempotent retry finishes with absent audio', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  state.databaseDeleteError = { message: 'database temporarily unavailable' };
  const partial = await request();
  assert.equal(partial.response.status, 502);
  assert.equal(partial.data.error.code, 'METADATA_DELETE_FAILED');
  assert.equal(state.audioExists, false);
  assert.notEqual(state.row, null);
  state.databaseDeleteError = null;
  const retry = await request();
  assert.equal(retry.response.status, 200);
  assert.equal(state.row, null);
  assert.equal(state.calls.filter(([call]) => call === 'storage.remove').length, 2);
});

test('transport failures report the correct deletion phase and retain metadata for retry', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  state.storageThrow = true;
  const storageFailure = await request();
  assert.equal(storageFailure.data.error.code, 'STORAGE_DELETE_FAILED');
  assert.notEqual(state.row, null);
  assert.equal(state.audioExists, true);
  state.storageThrow = false;
  state.databaseDeleteThrow = true;
  const metadataFailure = await request();
  assert.equal(metadataFailure.data.error.code, 'METADATA_DELETE_FAILED');
  assert.notEqual(state.row, null);
  assert.equal(state.audioExists, false);
});

test('simultaneous deletion requests safely finish with the same recording absent', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  const results = await Promise.all([request(), request()]);
  assert.deepEqual(results.map(({ response }) => response.status), [200, 200]);
  assert.equal(results.every(({ data }) => data.deleted === true && data.id === id), true);
  assert.equal(state.row, null);
  assert.equal(state.audioExists, false);
});

test('an ordinary stale save receipt cannot recreate a deleted recording after the MP3 is removed', async (t) => {
  const { state, options } = fixture();
  const request = await serve(t, options);
  const reservation = createUploadReservation(id, 2048, 'server-secret', 1000);
  await request();
  const result = await request(id, {
    id, upload_token: reservation.token, recorded_at: '2026-11-25T04:00:00.000Z',
    recorder: 'Most', wheel_type: 'front', spoke_length_mm: 290, spoke_diameter_mm: 2,
    tension_kgf: 100, temperature_c: 24, environment: 'quiet', duration_ms: 3000,
    sample_rate_hz: 48000, channels: 1, bitrate_kbps: 192,
  }, 'POST');
  assert.equal(result.response.status, 409);
  assert.equal(result.data.error.code, 'UPLOAD_NOT_FOUND');
  assert.equal(state.row, null);
});
