import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { csvCell, exportDataset, exportFilename, metadataRows, serializeMetadata } from '../src/lib/export.js';

const recording = {
  id: '21d6c7b6-f53d-4130-90ed-d74759bbfd19', recorded_at: '2026-11-25T03:00:00.000Z',
  recorder: 'Most', wheel_type: 'front', spoke_length_mm: 280.5, spoke_diameter_mm: 1.8,
  tension_kgf: 103.75, temperature_c: -1.5, environment: 'quiet', duration_ms: 1200,
  sample_rate_hz: 48000, channels: 1, bitrate_kbps: 192, audio_size_bytes: 4,
  blob: new Blob([new Uint8Array([0xff, 0xfb, 0xb0, 0xc4])], { type: 'audio/mpeg' }),
};

test('CSV and JSON preserve numeric values and stable English metadata names across UI locales', () => {
  const csv = serializeMetadata([recording], 'csv');
  assert.match(csv, /103\.75,-1\.5,quiet/);
  const json = JSON.parse(serializeMetadata([recording], 'json'));
  assert.equal(json[0].tension_kgf, 103.75);
  assert.equal(json[0].schema_version, 1);
  assert.equal(json[0].audio_file, `audio/${recording.id}.mp3`);
  assert.equal('blob' in json[0], false);
  assert.equal('audio_url' in json[0], false, 'temporary signed URLs do not enter datasets');
});

test('CSV quoting handles punctuation, line breaks and spreadsheet formulas without changing negative numbers', () => {
  assert.equal(csvCell('a,"b"\nc'), '"a,""b""\nc"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell(' +SUM(1)'), "' +SUM(1)");
  assert.equal(csvCell(-1.5), '-1.5');
});

for (const format of ['csv', 'json']) {
  test(`ZIP contains both intact audio and matching ${format.toUpperCase()} metadata`, async () => {
    const blob = await exportDataset([recording], { format, mode: 'both' });
    assert.equal(blob.type, 'application/zip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const audioFile = metadataRows([recording])[0].audio_file;
    assert.deepEqual([...await zip.file(audioFile).async('uint8array')], [0xff, 0xfb, 0xb0, 0xc4]);
    assert.equal(await zip.file(`metadata.${format}`).async('string'), serializeMetadata([recording], format));
  });
}

test('single audio/metadata exports use native files and archive:true forces Export all to ZIP', async () => {
  assert.equal((await exportDataset([recording], { mode: 'audio' })).type, 'audio/mpeg');
  assert.equal((await exportDataset([recording], { mode: 'metadata', format: 'json' })).type, 'application/json;charset=utf-8');
  assert.equal((await exportDataset([recording], { mode: 'audio', archive: true })).type, 'application/zip');
  assert.match(exportFilename([recording], { mode: 'audio' }), /\.mp3$/);
  assert.match(exportFilename([recording], { mode: 'metadata', format: 'csv', archive: true }), /\.zip$/);
});

test('failed audio downloads reject the export instead of silently generating an incomplete dataset', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 403 }));
  const remote = { ...recording, blob: undefined, audio_url: 'https://example.com/signed-audio' };
  await assert.rejects(exportDataset([remote]), /exportAudioFailed/);
});

test('duplicate or unsafe identifiers cannot overwrite audio files inside a ZIP', async () => {
  await assert.rejects(exportDataset([recording, recording]), /exportDuplicateIds/);
  await assert.rejects(exportDataset([{ ...recording, id: '../outside' }]), /exportInvalidId/);
});
