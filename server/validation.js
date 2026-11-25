import { badRequest } from './errors.js';

export const MAX_AUDIO_BYTES = 50_000_000;
export const RECORDERS = ['Most', 'Alexander', 'Sally', 'Devolia'];
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function objectBody(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('A JSON object is required.');
  }
  return value;
}

function oneOf(value, options, name) {
  if (!options.includes(value)) throw badRequest(`${name} must be one of: ${options.join(', ')}.`);
  return value;
}

function positiveNumber(value, name, { integer = false, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max || (integer && !Number.isInteger(value))) {
    throw badRequest(`${name} must be a positive ${integer ? 'integer' : 'number'}${max !== Number.MAX_SAFE_INTEGER ? ` no greater than ${max}` : ''}.`);
  }
  return value;
}

export function validateUpload(body) {
  objectBody(body);
  return {
    audio_size_bytes: positiveNumber(body.audio_size_bytes, 'audio_size_bytes', { integer: true, max: MAX_AUDIO_BYTES }),
  };
}

export function validateDeletion(id, body) {
  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) throw badRequest('A valid recording id is required.');
  objectBody(body);
  if (typeof body.confirm_id !== 'string' || body.confirm_id.toLowerCase() !== id.toLowerCase()) {
    throw badRequest('confirm_id must match the recording selected for permanent deletion.');
  }
  return id.toLowerCase();
}

export function validateRecord(body) {
  objectBody(body);
  if (typeof body.id !== 'string' || !UUID_PATTERN.test(body.id)) throw badRequest('A valid recording id is required.');
  if (typeof body.upload_token !== 'string' || body.upload_token.length > 2048) throw badRequest('An upload_token is required.');
  if (typeof body.recorded_at !== 'string' || !ISO_TIMESTAMP_PATTERN.test(body.recorded_at) || !Number.isFinite(Date.parse(body.recorded_at))) throw badRequest('recorded_at must be an ISO date and time with a timezone.');
  if (typeof body.temperature_c !== 'number' || !Number.isFinite(body.temperature_c) || body.temperature_c < -273.15) {
    throw badRequest('temperature_c must be a finite Celsius temperature at or above absolute zero.');
  }
  if (body.channels !== 1) throw badRequest('Audio must be mono (channels = 1).');
  if (body.bitrate_kbps !== 192) throw badRequest('MP3 bitrate must be 192 kbps.');
  return {
    id: body.id.toLowerCase(),
    schema_version: 1,
    recorded_at: new Date(body.recorded_at).toISOString(),
    recorder: oneOf(body.recorder, RECORDERS, 'recorder'),
    wheel_type: oneOf(body.wheel_type, ['front', 'rear'], 'wheel_type'),
    spoke_length_mm: positiveNumber(body.spoke_length_mm, 'spoke_length_mm'),
    spoke_diameter_mm: positiveNumber(body.spoke_diameter_mm, 'spoke_diameter_mm'),
    tension_kgf: positiveNumber(body.tension_kgf, 'tension_kgf'),
    temperature_c: body.temperature_c,
    environment: oneOf(body.environment, ['quiet', 'noisy'], 'environment'),
    duration_ms: positiveNumber(body.duration_ms, 'duration_ms', { integer: true }),
    sample_rate_hz: positiveNumber(body.sample_rate_hz, 'sample_rate_hz', { integer: true, max: 2_147_483_647 }),
    channels: 1,
    bitrate_kbps: 192,
    audio_path: `${body.id.toLowerCase()}.mp3`,
    audio_mime: 'audio/mpeg',
  };
}
