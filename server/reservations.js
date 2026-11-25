import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';

const LIFETIME_MS = 2 * 60 * 60 * 1000;

function sign(payload, secret) {
  return createHmac('sha256', secret).update(`spoke-upload-v1.${payload}`).digest('base64url');
}

export function createUploadReservation(id, size, secret, now = Date.now()) {
  const expiresAt = now + LIFETIME_MS;
  const payload = Buffer.from(JSON.stringify({ id, size, expiresAt })).toString('base64url');
  return { token: `${payload}.${sign(payload, secret)}`, expiresAt };
}

export function verifyUploadReservation(token, id, secret, now = Date.now(), { allowExpired = false } = {}) {
  const fail = () => { throw new ApiError(400, 'INVALID_UPLOAD', 'This upload is invalid or has expired. Please save the recording again.'); };
  if (typeof token !== 'string' || token.length > 2048) return fail();
  const parts = token.split('.');
  if (parts.length !== 2) return fail();
  const [payload, signature] = parts;
  const expected = Buffer.from(sign(payload, secret));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return fail();
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return fail(); }
  if (!decoded || decoded.id !== id || !Number.isSafeInteger(decoded.size) || decoded.size <= 0 || !Number.isSafeInteger(decoded.expiresAt) || (!allowExpired && decoded.expiresAt <= now)) return fail();
  return decoded;
}
