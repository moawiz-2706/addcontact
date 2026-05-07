// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";
import { Pool } from "pg";

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

type StoragePutOptions = {
  stableKey?: boolean;
  deleteBeforePut?: boolean;
};

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
  options?: StoragePutOptions,
): Promise<{ key: string; url: string }> {
  const normalizedKey = normalizeKey(relKey);
  const key = options?.stableKey ? normalizedKey : appendHashSuffix(normalizedKey);

  console.log("[storagePut] Starting upload for key:", key);
  // If Supabase Storage is configured, use it first.
  if (ENV.supabaseUrl && ENV.supabaseServiceKey) {
    const supaUrl = ENV.supabaseUrl.replace(/\/+$/, "");
    const bucket = ENV.supabaseBucket || "dynamic-images";
    try {
      console.log("[storagePut] Uploading to Supabase Storage", bucket, key);
      if (options?.deleteBeforePut) {
        const deleteUrl = `${supaUrl}/storage/v1/object/${bucket}/${encodeURIComponent(key)}`;
        const deleteResp = await fetch(deleteUrl, {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${ENV.supabaseServiceKey}`,
            apikey: ENV.supabaseServiceKey,
          },
        });

        // 404 is expected when there is no prior image; ignore it.
        if (!deleteResp.ok && deleteResp.status !== 404) {
          const body = await deleteResp.text().catch(() => deleteResp.statusText);
          throw new Error(`Supabase delete failed (${deleteResp.status}): ${body}`);
        }
      }

      const uploadUrl = `${supaUrl}/storage/v1/object/${bucket}/${encodeURIComponent(key)}`;
      const blob =
        typeof data === "string"
          ? new Blob([data], { type: contentType })
          : new Blob([data as any], { type: contentType });

      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${ENV.supabaseServiceKey}`,
          apikey: ENV.supabaseServiceKey,
          "Content-Type": contentType,
          "x-upsert": "true",
        },
        body: blob,
      });

      if (!uploadResp.ok) {
        const body = await uploadResp.text().catch(() => uploadResp.statusText);
        throw new Error(`Supabase upload failed (${uploadResp.status}): ${body}`);
      }

      // For image rendering, use the public URL directly (no signing needed if bucket is public)
      const publicUrl = `${supaUrl}/storage/v1/object/public/${bucket}/${encodeURIComponent(key)}`;
      console.log("[storagePut] Supabase upload complete, url:", publicUrl);
      return { key, url: publicUrl };
    } catch (err) {
      console.error("[storagePut] Supabase upload error:", err);
      // fall through to other backends or DB fallback
    }
  }

  // If Forge storage is configured, use it. Otherwise fallback to DB storage.
  if (ENV.forgeApiUrl && ENV.forgeApiKey) {
    const { forgeUrl, forgeKey } = getForgeConfig();
    try {
      // 1. Get presigned PUT URL from Forge with timeout
      console.log("[storagePut] Requesting presigned URL from Forge...");
      const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
      presignUrl.searchParams.set("path", key);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout for presign

      let presignResp;
      try {
        presignResp = await fetch(presignUrl, {
          headers: { Authorization: `Bearer ${forgeKey}` },
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!presignResp.ok) {
        const msg = await presignResp.text().catch(() => presignResp.statusText);
        throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
      }

      const { url: s3Url } = (await presignResp.json()) as { url: string };
      if (!s3Url) throw new Error("Forge returned empty presign URL");
      console.log("[storagePut] Got presigned S3 URL");

      // 2. PUT file directly to S3 with timeout
      console.log("[storagePut] Uploading to S3...");
      const blob =
        typeof data === "string"
          ? new Blob([data], { type: contentType })
          : new Blob([data as any], { type: contentType });

      const uploadController = new AbortController();
      const uploadTimeoutId = setTimeout(() => uploadController.abort(), 60000); // 60 second timeout for upload

      let uploadResp;
      try {
        uploadResp = await fetch(s3Url, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: blob,
          signal: uploadController.signal,
        });
      } finally {
        clearTimeout(uploadTimeoutId);
      }

      if (!uploadResp.ok) {
        throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
      }

      console.log("[storagePut] Upload completed successfully for key:", key);
      return { key, url: `/manus-storage/${key}` };
    } catch (error) {
      console.error("[storagePut] Error:", error);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Storage upload timed out: ${error.message}`);
      }
      throw error;
    }
  }

  // Fallback: store base64 data in Postgres so the app can run without Forge.
  try {
    if (!ENV.databaseUrl) throw new Error("DATABASE_URL not configured for DB fallback storage");

    const pool = new Pool({ connectionString: ENV.databaseUrl });
    // ensure table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS stored_files (
        key varchar PRIMARY KEY,
        data text NOT NULL,
        content_type varchar(128) NOT NULL,
        created_at timestamptz DEFAULT now()
      )
    `);

    let base64str: string;
    if (typeof data === "string") {
      // Assume already base64 or raw string; if it's raw path, this may be incorrect
      base64str = data;
    } else if (Buffer.isBuffer(data)) {
      base64str = (data as Buffer).toString("base64");
    } else if (data instanceof Uint8Array) {
      base64str = Buffer.from(data).toString("base64");
    } else {
      // Last resort: convert via Blob -> arrayBuffer
      base64str = Buffer.from(String(data)).toString("base64");
    }

    await pool.query(`INSERT INTO stored_files (key, data, content_type) VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, content_type = EXCLUDED.content_type, created_at = now()
    `, [key, base64str, contentType]);

    await pool.end();
    console.log("[storagePut] Stored file in DB with key:", key);
    return { key, url: `/manus-storage/${key}` };
  } catch (err) {
    console.error("[storagePut] DB fallback failed:", err);
    throw err;
  }
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);

  // Supabase: return public URL directly (assumes bucket is public)
  if (ENV.supabaseUrl && ENV.supabaseServiceKey) {
    const supaUrl = ENV.supabaseUrl.replace(/\/+$/, "");
    const bucket = ENV.supabaseBucket || "dynamic-images";
    const publicUrl = `${supaUrl}/storage/v1/object/public/${bucket}/${encodeURIComponent(key)}`;
    console.log("[storageGetSignedUrl] Using Supabase public URL:", publicUrl);
    return publicUrl;
  }

  // Forge signing fallback
  const { forgeUrl, forgeKey } = getForgeConfig();
  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}
