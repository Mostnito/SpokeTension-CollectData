import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { filterRecordings } from '../src/lib/dataset.js';
import { exportDataset } from '../src/lib/export.js';

const records = [
  ['record-a', 'Most', 'front', 'quiet'],
  ['record-b', 'Most', 'rear', 'quiet'],
  ['record-c', 'Most', 'front', 'noisy'],
  ['record-d', 'Sally', 'front', 'quiet'],
  ['record-e', 'Most', 'front', 'quiet'],
].map(([id, recorder, wheel_type, environment]) => ({
  id, recorder, wheel_type, environment,
  recorded_at: '2026-11-25T03:00:00.000Z',
  spoke_length_mm: 280, spoke_diameter_mm: 1.8, tension_kgf: 100,
  temperature_c: 24, duration_ms: 1000, sample_rate_hz: 48000,
  channels: 1, bitrate_kbps: 192, audio_size_bytes: 4,
  blob: new Blob([new Uint8Array([0xff, 0xfb, 0xb0, 0xc4])], { type: 'audio/mpeg' }),
}));

function csvIds(csv) {
  const [header, ...rows] = csv.trim().split('\r\n');
  const index = header.split(',').indexOf('id');
  return rows.map((row) => row.split(',')[index]);
}

for (const format of ['json', 'csv']) {
  test(`combined filters export exactly the matching ${format.toUpperCase()} rows and paired audio`, async () => {
    const selected = filterRecordings(records, { recorder: 'Most', wheel_type: 'front', environment: 'quiet' });
    const blob = await exportDataset(selected, { mode: 'both', format, archive: true });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const metadata = await zip.file(`metadata.${format}`).async('string');
    const ids = format === 'json' ? JSON.parse(metadata).map((row) => row.id) : csvIds(metadata);
    assert.deepEqual(ids, ['record-a', 'record-e']);
    assert.deepEqual(Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort(), [
      'audio/record-a.mp3', 'audio/record-e.mp3', `metadata.${format}`,
    ]);
    if (format === 'json') {
      for (const row of JSON.parse(metadata)) assert.ok(zip.file(row.audio_file), 'every metadata row references an included MP3');
    }
    assert.equal(records.length, 5, 'filtering/exporting never removes records from the source dataset');
  });
}

test('reset filters exports the complete original dataset in its original order', async () => {
  filterRecordings(records, { recorder: 'Sally', wheel_type: '', environment: '' });
  const selected = filterRecordings(records, { recorder: '', wheel_type: '', environment: '' });
  const zip = await JSZip.loadAsync(await (await exportDataset(selected, { mode: 'both', format: 'json', archive: true })).arrayBuffer());
  const metadata = JSON.parse(await zip.file('metadata.json').async('string'));
  assert.deepEqual(metadata.map((row) => row.id), records.map((row) => row.id));
  assert.equal(Object.values(zip.files).filter((entry) => !entry.dir && entry.name.endsWith('.mp3')).length, 5);
  assert.ok(selected.every((record, index) => record === records[index]), 'source records are preserved intact');
});

test('no matching records rejects export without silently falling back to the full dataset', async () => {
  const selected = filterRecordings(records, { recorder: 'Alexander', wheel_type: '', environment: '' });
  await assert.rejects(exportDataset(selected, { mode: 'both', format: 'json', archive: true }), /exportEmpty/);
  assert.equal(records.length, 5);
});
