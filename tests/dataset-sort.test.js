import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { filterRecordings, sortRecordings } from '../src/lib/dataset.js';
import { exportDataset } from '../src/lib/export.js';

const records = Object.freeze([
  ['record-80', 80, 'Most', 'front', 'quiet'],
  ['record-9a', '9', 'Most', 'front', 'quiet'],
  ['record-100', '100.5', 'Most', 'front', 'quiet'],
  ['record-other', 2, 'Sally', 'rear', 'noisy'],
  ['record-9b', 9, 'Most', 'front', 'quiet'],
].map(([id, tension_kgf, recorder, wheel_type, environment], index) => Object.freeze({
  id, tension_kgf, recorder, wheel_type, environment,
  recorded_at: `2026-11-26T03:00:0${4 - index}.000Z`,
  spoke_length_mm: 280, spoke_diameter_mm: 1.8, temperature_c: 24,
  duration_ms: 1000, sample_rate_hz: 48000, channels: 1, bitrate_kbps: 192,
  audio_size_bytes: 5,
  blob: new Blob([new Uint8Array([0xff, 0xfb, 0xb0, 0xc4, index])], { type: 'audio/mpeg' }),
})));
const ids = rows => rows.map(row => row.id);

test('tension sorting compares 9, 80 and 100.5 numerically in both directions with stable ties', () => {
  assert.deepEqual(ids(sortRecordings(records, 'tension-asc')), [
    'record-other', 'record-9a', 'record-9b', 'record-80', 'record-100',
  ]);
  assert.deepEqual(ids(sortRecordings(records, 'tension-desc')), [
    'record-100', 'record-80', 'record-9a', 'record-9b', 'record-other',
  ]);
  assert.deepEqual(ids(records), ['record-80', 'record-9a', 'record-100', 'record-other', 'record-9b']);
  assert.equal(records[1].tension_kgf, '9', 'record objects and their original scalar types remain unchanged');
});

test('newest and unknown orders restore the incoming API order and always return a separate array', () => {
  const sorted = sortRecordings(records, 'tension-asc');
  for (const order of [undefined, 'newest', 'unknown-order']) {
    const restored = sortRecordings(records, order);
    assert.notEqual(restored, records);
    assert.deepEqual(ids(restored), ids(records));
    assert.ok(restored.every((row, index) => row === records[index]));
  }
  assert.notDeepEqual(ids(sorted), ids(records));
  assert.deepEqual(ids(records), ['record-80', 'record-9a', 'record-100', 'record-other', 'record-9b']);
});

test('missing, blank, non-numeric and nonfinite tensions remain last in either direction', () => {
  const invalidValues = [undefined, null, '', ' ', 'invalid', NaN, Infinity, -Infinity, 'Infinity', true, []];
  const invalid = invalidValues.map((tension_kgf, index) => ({ id: `invalid-${index}`, tension_kgf }));
  const input = [invalid[0], { id: 'valid-80', tension_kgf: '80' }, ...invalid.slice(1), { id: 'valid-9', tension_kgf: 9 }];
  assert.deepEqual(ids(sortRecordings(input, 'tension-asc')), ['valid-9', 'valid-80', ...ids(invalid)]);
  assert.deepEqual(ids(sortRecordings(input, 'tension-desc')), ['valid-80', 'valid-9', ...ids(invalid)]);
});

test('filtering and sorting compose without discarding or reordering the original dataset', () => {
  const filters = { recorder: 'Most', wheel_type: 'front', environment: 'quiet' };
  const filtered = filterRecordings(records, filters);
  assert.deepEqual(ids(sortRecordings(filtered, 'tension-asc')), ['record-9a', 'record-9b', 'record-80', 'record-100']);
  assert.deepEqual(ids(filterRecordings(sortRecordings(records, 'tension-asc'), filters)), ['record-9a', 'record-9b', 'record-80', 'record-100']);
  assert.deepEqual(ids(sortRecordings(filtered, 'newest')), ['record-80', 'record-9a', 'record-100', 'record-9b']);
  assert.equal(records.length, 5);
});

for (const format of ['json', 'csv']) {
  test(`sorted filtered ${format.toUpperCase()} ZIP keeps display order and pairs the correct MP3 with each record`, async () => {
    const selected = sortRecordings(filterRecordings(records, {
      recorder: 'Most', wheel_type: 'front', environment: 'quiet',
    }), 'tension-desc');
    const blob = await exportDataset(selected, { mode: 'both', format, archive: true });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const metadata = await zip.file(`metadata.${format}`).async('string');
    let exportedIds;
    if (format === 'json') {
      exportedIds = JSON.parse(metadata).map(row => row.id);
    } else {
      const [header, ...rows] = metadata.trim().split('\r\n');
      const idColumn = header.split(',').indexOf('id');
      exportedIds = rows.map(row => row.split(',')[idColumn]);
    }
    assert.deepEqual(exportedIds, ['record-100', 'record-80', 'record-9a', 'record-9b']);
    assert.deepEqual(Object.values(zip.files).filter(entry => !entry.dir && entry.name.endsWith('.mp3')).map(entry => entry.name).sort(), selected.map(row => `audio/${row.id}.mp3`).sort());
    for (const row of selected) {
      const exportedAudio = await zip.file(`audio/${row.id}.mp3`).async('uint8array');
      assert.deepEqual(exportedAudio, new Uint8Array(await row.blob.arrayBuffer()), `audio must belong to ${row.id}`);
    }
    assert.equal(zip.file('audio/record-other.mp3'), null, 'the excluded record must not enter the export');
  });
}
