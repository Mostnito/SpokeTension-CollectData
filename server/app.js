import express from 'express';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from './errors.js';
import { MAX_AUDIO_BYTES, validateDeletion, validateRecord, validateUpload } from './validation.js';
import { createUploadReservation, verifyUploadReservation } from './reservations.js';

const TABLE = 'recordings';
const PAGE_SIZE = 500;
const AUDIO_URL_SECONDS = 3600;
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);

function configuration(env) {
  const url = env.SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  let validUrl = false;
  try { validUrl = ['http:', 'https:'].includes(new URL(url).protocol); } catch { /* Configuration is not complete. */ }
  return { url, key, bucket: env.SUPABASE_STORAGE_BUCKET?.trim() || 'spoke-recordings', configured: Boolean(validUrl && key) };
}

export function createApp({ env = process.env, clientFactory = createClient, now = Date.now } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', express.json({ limit: '32kb' }));

  let cachedClient;
  let cachedIdentity;
  function services() {
    const config = configuration(env);
    if (!config.configured) throw new ApiError(503, 'NOT_CONFIGURED', 'Supabase is not connected. Complete the setup in README.md before saving records.');
    const identity = `${config.url}\n${config.key}`;
    if (!cachedClient || cachedIdentity !== identity) {
      cachedClient = clientFactory(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      cachedIdentity = identity;
    }
    return { ...config, client: cachedClient, storage: cachedClient.storage.from(config.bucket) };
  }

  async function withAudioUrls(records, storage) {
    if (!records.length) return [];
    const output = [];
    for (let offset = 0; offset < records.length; offset += PAGE_SIZE) {
      const chunk = records.slice(offset, offset + PAGE_SIZE);
      const { data, error } = await storage.createSignedUrls(chunk.map((item) => item.audio_path), AUDIO_URL_SECONDS);
      if (error) throw new ApiError(502, 'STORAGE_ERROR', 'Could not prepare audio downloads. Please try again.');
      const urls = new Map((data || []).map((item) => [item.path, item.error ? null : item.signedUrl]));
      for (const item of chunk) output.push({ ...item, audio_url: urls.get(item.audio_path) || null });
    }
    return output;
  }

  app.get('/api/status', asyncRoute(async (_req, res) => {
    const { configured } = configuration(env);
    const status = { configured, connected: false, storage: 'supabase', max_audio_bytes: MAX_AUDIO_BYTES };
    if (!configured) return res.json(status);
    try {
      const { client, bucket } = services();
      const [tableResult, bucketResult] = await Promise.all([
        client.from(TABLE).select('id').limit(1),
        client.storage.getBucket(bucket),
      ]);
      if (tableResult.error || bucketResult.error || !bucketResult.data) {
        return res.json({ ...status, error: { code: 'CONNECTION_FAILED', message: 'Supabase could not be reached. Check the server credentials, recordings table, and storage bucket setup.' } });
      }
      if (bucketResult.data.public !== false) {
        return res.json({ ...status, error: { code: 'BUCKET_NOT_PRIVATE', message: 'The recording storage bucket must be private. Run supabase/schema.sql to complete setup.' } });
      }
      return res.json({ ...status, connected: true });
    } catch {
      return res.json({ ...status, error: { code: 'CONNECTION_FAILED', message: 'Supabase could not be reached. Check the server settings and try again.' } });
    }
  }));

  app.get('/api/records', asyncRoute(async (_req, res) => {
    const { client, storage } = services();
    const records = [];
    // Supabase returns bounded pages by default. Read every page for Export all.
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await client.from(TABLE).select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
      if (error) throw new ApiError(502, 'DATABASE_ERROR', 'Could not load recordings. Check the Supabase setup and try again.');
      records.push(...(data || []));
      if (!data || data.length < PAGE_SIZE) break;
    }
    res.json({ records: await withAudioUrls(records, storage) });
  }));

  app.post('/api/uploads', asyncRoute(async (req, res) => {
    const { audio_size_bytes: size } = validateUpload(req.body);
    const { key, storage } = services();
    const id = randomUUID();
    const audioPath = `${id}.mp3`;
    const { data, error } = await storage.createSignedUploadUrl(audioPath, { upsert: false });
    if (error || !data?.signedUrl) throw new ApiError(502, 'STORAGE_ERROR', 'Could not prepare the audio upload. Check that the private storage bucket exists.');
    const receipt = createUploadReservation(id, size, key, now());
    res.status(201).json({ id, audio_path: audioPath, upload_url: data.signedUrl, upload_token: receipt.token, expires_at: new Date(receipt.expiresAt).toISOString() });
  }));

  app.post('/api/records', asyncRoute(async (req, res) => {
    const record = validateRecord(req.body);
    const { client, storage, key } = services();
    // Authenticate even an old receipt before looking up its id. A completed save
    // remains retryable after token expiry if the original response was lost.
    const reservation = verifyUploadReservation(req.body.upload_token, record.id, key, now(), { allowExpired: true });

    // A client can safely retry finalization after a lost network response.
    const { data: existing, error: lookupError } = await client.from(TABLE).select('*').eq('id', record.id).maybeSingle();
    if (lookupError) throw new ApiError(502, 'DATABASE_ERROR', 'Could not check the recording. Please try saving again.');
    if (existing) return res.json({ record: (await withAudioUrls([existing], storage))[0] });

    // Expired receipts can never create new records, including when the lookup
    // itself crossed the expiry boundary.
    verifyUploadReservation(req.body.upload_token, record.id, key, now());

    const { data: object, error: objectError } = await storage.info(record.audio_path);
    if (objectError || !object) throw new ApiError(409, 'UPLOAD_NOT_FOUND', 'The MP3 upload has not completed. Please save the recording again.');
    if (Number(object.size) !== reservation.size || object.contentType?.split(';')[0].trim().toLowerCase() !== 'audio/mpeg') {
      throw new ApiError(400, 'INVALID_AUDIO', 'The uploaded file must match the MP3 recording and its expected size.');
    }
    record.audio_size_bytes = reservation.size;
    const { data: saved, error: insertError } = await client.from(TABLE).insert(record).select('*').single();
    if (insertError) {
      // Concurrent retries may have inserted the same id between lookup and insert.
      if (insertError.code === '23505') {
        const { data: duplicate, error: duplicateError } = await client.from(TABLE).select('*').eq('id', record.id).maybeSingle();
        if (!duplicateError && duplicate) return res.json({ record: (await withAudioUrls([duplicate], storage))[0] });
      }
      throw new ApiError(502, 'DATABASE_ERROR', 'Audio was uploaded but metadata could not be saved. Keep this page open and try saving again.');
    }
    res.status(201).json({ record: (await withAudioUrls([saved], storage))[0] });
  }));

  app.delete('/api/records/:id', asyncRoute(async (req, res) => {
    const id = validateDeletion(req.params.id, req.body);
    const { client, storage } = services();
    const { data: record, error: lookupError } = await client.from(TABLE).select('id,audio_path').eq('id', id).maybeSingle();
    if (lookupError) throw new ApiError(502, 'DATABASE_ERROR', 'Could not check the recording. Nothing was deleted. Please try again.');
    // Only a saved recording can authorize a storage deletion. Repeated requests
    // are successful once the row is gone, without touching unreserved files.
    if (!record) return res.json({ deleted: true, id, already_deleted: true });
    if (record.audio_path !== `${id}.mp3`) throw new ApiError(500, 'INVALID_STORAGE_PATH', 'The saved audio path is invalid. Nothing was deleted.');

    try {
      const { error } = await storage.remove([record.audio_path]);
      if (error) throw error;
      // A successful empty array means the MP3 was already absent. Supabase's
      // batch removal is idempotent, which also allows partial-delete retries.
    } catch {
      throw new ApiError(502, 'STORAGE_DELETE_FAILED', 'The audio could not be deleted. Metadata is still saved. Please try deleting again.');
    }

    try {
      const { error } = await client.from(TABLE).delete().eq('id', id);
      if (error) throw error;
    } catch {
      throw new ApiError(502, 'METADATA_DELETE_FAILED', 'Audio was deleted, but metadata could not be removed. Please try deleting this recording again to finish.');
    }
    return res.json({ deleted: true, id });
  }));

  app.use('/api', (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', 'This API endpoint does not exist.')));
  app.use((error, _req, res, _next) => {
    if (res.headersSent) return;
    if (error instanceof ApiError) return res.status(error.status).json({ error: { code: error.code, message: error.message } });
    if (error.type === 'entity.too.large') return res.status(413).json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Metadata is too large. Upload audio directly using the signed upload URL.' } });
    if (error instanceof SyntaxError && error.status === 400) return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON.' } });
    // Do not send provider responses or credentials to the browser.
    console.error('API request failed:', error?.name || 'Error');
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' } });
  });
  return app;
}

export default createApp();
