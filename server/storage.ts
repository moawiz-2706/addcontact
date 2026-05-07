// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";

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

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));

  console.log("[storagePut] Starting upload for key:", key);

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

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

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
