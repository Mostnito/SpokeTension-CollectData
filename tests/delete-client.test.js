import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteRecording } from '../src/lib/api.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

for (const id of ['65d1705c-5675-417f-8f9e-439466d83f80', 'record/with?reserved=value&characters']) {
  test(`delete targets one encoded id and sends the same explicit confirmation: ${id}`, async (t) => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      calls.push({ url, options });
      return json({ deleted: true, id });
    });
    assert.deepEqual(await deleteRecording(id), { deleted: true, id });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `/api/records/${encodeURIComponent(id)}`);
    assert.equal(calls[0].options.method, 'DELETE');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].options.body), { confirm_id: id });
    assert.ok(calls[0].options.signal instanceof AbortSignal, 'request can time out without reporting success');
  });
}

for (const code of ['METADATA_DELETE_FAILED', 'STORAGE_DELETE_FAILED']) {
  test(`delete preserves ${code} so the dialog can report the actual partial failure`, async (t) => {
    const message = code === 'METADATA_DELETE_FAILED'
      ? 'Audio was deleted, but metadata could not be removed.'
      : 'The audio could not be deleted. Metadata is still saved.';
    t.mock.method(globalThis, 'fetch', async () => json({ error: { code, message } }, 502));
    await assert.rejects(deleteRecording('65d1705c-5675-417f-8f9e-439466d83f80'), { code, message });
  });
}

test('lost delete response rejects instead of reporting success, and an explicit retry targets the same record', async (t) => {
  const id = '65d1705c-5675-417f-8f9e-439466d83f80';
  const failure = new TypeError('Network response was lost');
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) throw failure;
    return json({ deleted: true, id, already_deleted: true });
  });
  await assert.rejects(deleteRecording(id), (error) => error === failure);
  assert.equal(calls.length, 1, 'no hidden destructive retry is issued');
  assert.deepEqual(await deleteRecording(id), { deleted: true, id, already_deleted: true });
  assert.equal(calls.length, 2);
  for (const { url, options } of calls) {
    assert.equal(url, `/api/records/${id}`);
    assert.deepEqual(JSON.parse(options.body), { confirm_id: id });
  }
});
