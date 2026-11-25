import JSZip from 'jszip';

export const METADATA_FIELDS = [
  'schema_version', 'id', 'recorded_at', 'recorder', 'wheel_type',
  'spoke_length_mm', 'spoke_diameter_mm', 'tension_kgf', 'temperature_c',
  'environment', 'duration_ms', 'sample_rate_hz', 'channels', 'bitrate_kbps',
  'audio_size_bytes', 'audio_mime', 'audio_file',
];

function checkAbort(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Export cancelled', 'AbortError');
}

function recordId(record) {
  const id = String(record.id || '');
  // Prevent duplicate paths, path traversal and platform-specific file separators.
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('exportInvalidId');
  return id;
}

export function metadataRows(records) {
  return records.map((record) => {
    const id = recordId(record);
    return Object.fromEntries(METADATA_FIELDS.map((field) => {
      if (field === 'schema_version') return [field, 1];
      if (field === 'audio_file') return [field, `audio/${id}.mp3`];
      if (field === 'audio_mime') return [field, 'audio/mpeg'];
      return [field, record[field] ?? null];
    }));
  });
}

export function csvCell(value) {
  if (value === null || value === undefined) return '';
  // Numbers remain numbers, including negative room temperatures.
  let text = String(value);
  if (typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeMetadata(records, format = 'json') {
  const rows = metadataRows(records);
  if (format === 'json') return JSON.stringify(rows, null, 2);
  if (format !== 'csv') throw new Error('exportInvalidFormat');
  return `${METADATA_FIELDS.join(',')}\r\n${rows.map((row) => METADATA_FIELDS.map((field) => csvCell(row[field])).join(',')).join('\r\n')}\r\n`;
}

async function fetchAudio(record, signal) {
  checkAbort(signal);
  const local = record.blob || record.audio_blob;
  if (local instanceof Blob) {
    if (!local.size) throw new Error('exportAudioMissing');
    return local;
  }
  if (!record.audio_url) throw new Error('exportAudioMissing');
  const response = await fetch(record.audio_url, { signal });
  if (!response.ok) throw new Error('exportAudioFailed');
  const blob = await response.blob();
  checkAbort(signal);
  if (!blob.size) throw new Error('exportAudioMissing');
  return blob;
}

/**
 * Build exports before triggering a download so missing files never create an incomplete ZIP.
 * Set `archive: true` to force a ZIP for a one-item "Export all" action.
 */
export async function exportDataset(records, { format = 'json', mode = 'both', signal, archive = false } = {}) {
  if (!Array.isArray(records) || !records.length) throw new Error('exportEmpty');
  if (!['csv', 'json'].includes(format)) throw new Error('exportInvalidFormat');
  if (!['metadata', 'audio', 'both'].includes(mode)) throw new Error('exportInvalidMode');
  const ids = records.map(recordId);
  if (new Set(ids).size !== ids.length) throw new Error('exportDuplicateIds');
  checkAbort(signal);
  if (mode === 'metadata' && records.length === 1 && !archive) {
    const type = format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
    return new Blob([serializeMetadata(records, format)], { type });
  }
  if (mode === 'audio' && records.length === 1 && !archive) {
    return fetchAudio(records[0], signal);
  }
  const zip = new JSZip();
  if (mode !== 'audio') {
    zip.file(`metadata.${format}`, serializeMetadata(records, format));
  }
  if (mode !== 'metadata') {
    // Keep at most one download buffer in flight on mobile devices.
    for (let index = 0; index < records.length; index += 1) {
      const blob = await fetchAudio(records[index], signal);
      checkAbort(signal);
      zip.file(`audio/${ids[index]}.mp3`, await blob.arrayBuffer(), { compression: 'STORE' });
    }
  }
  checkAbort(signal);
  // JSZip has no public cancellation method; finish generation, then suppress the
  // download if cancelled. Throwing from its progress callback is not safely caught.
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
  checkAbort(signal);
  return blob;
}

export function exportFilename(records, { mode = 'both', format = 'json', archive = false } = {}) {
  const isZip = archive || records.length !== 1 || mode === 'both';
  const name = records.length === 1 ? `spoke-${recordId(records[0])}` : `spoke-tension-${new Date().toISOString().slice(0, 10)}`;
  return `${name}.${isZip ? 'zip' : mode === 'audio' ? 'mp3' : format}`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Leave time for mobile browsers to claim the URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
