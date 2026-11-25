export async function request(path, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(`/api${path}`, {
    ...rest,
    headers: { "Content-Type": "application/json", ...headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      body?.error?.message || `Request failed (${response.status})`,
    );
    error.code = body?.error?.code || "REQUEST_FAILED";
    throw error;
  }
  if (!body) throw new Error("The server returned an invalid response.");
  return body;
}

export async function deleteRecording(id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    return await request(`/records/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirm_id: id }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function saveRecording(metadata, audio, reservation) {
  const upload =
    reservation ||
    (await request("/uploads", {
      method: "POST",
      body: JSON.stringify({ audio_size_bytes: audio.blob.size }),
    }));
  if (!reservation) {
    const response = await fetch(upload.upload_url, {
      method: "PUT",
      headers: { "Content-Type": "audio/mpeg" },
      body: audio.blob,
    });
    if (!response.ok)
      throw new Error(
        "Audio upload failed. Your recording is still available.",
      );
  }
  try {
    const result = await request("/records", {
      method: "POST",
      body: JSON.stringify({
        ...metadata,
        id: upload.id,
        upload_token: upload.upload_token,
        recorded_at: audio.recorded_at,
        duration_ms: audio.duration_ms,
        sample_rate_hz: audio.sample_rate_hz,
        channels: audio.channels,
        bitrate_kbps: audio.bitrate_kbps,
        audio_size_bytes: audio.blob.size,
      }),
    });
    return result.record;
  } catch (error) {
    // Reuse an already uploaded object when committing a record is retried.
    error.reservation = [
      "INVALID_UPLOAD",
      "UPLOAD_NOT_FOUND",
      "INVALID_AUDIO",
    ].includes(error.code)
      ? null
      : upload;
    throw error;
  }
}
