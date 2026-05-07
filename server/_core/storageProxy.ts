import type { Express } from "express";
import { ENV } from "./env";
import { Pool } from "pg";

export function registerStorageProxy(app: Express) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = (req.params as Record<string, string>)[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }

    if (ENV.supabaseUrl && ENV.supabaseServiceKey) {
      try {
        const supaUrl = ENV.supabaseUrl.replace(/\/+$/, "");
        const bucket = ENV.supabaseBucket || "dynamic-images";
        const publicUrl = `${supaUrl}/storage/v1/object/public/${bucket}/${encodeURIComponent(key)}`;
        res.set("Cache-Control", "public, max-age=300");
        res.redirect(307, publicUrl);
        return;
      } catch (err) {
        console.error("[StorageProxy] Supabase redirect failed:", err);
        res.status(502).send("Storage proxy Supabase error");
        return;
      }
    }

    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      // Try to serve from DB fallback
      if (!ENV.databaseUrl) {
        res.status(500).send("Storage proxy not configured");
        return;
      }

      try {
        const pool = new Pool({ connectionString: ENV.databaseUrl });
        const result = await pool.query('SELECT data, content_type FROM stored_files WHERE key = $1 LIMIT 1', [key]);
        await pool.end();

        if (result.rowCount === 0) {
          res.status(404).send("Stored file not found");
          return;
        }

        const row = result.rows[0];
        const buf = Buffer.from(row.data, 'base64');
        res.setHeader('Content-Type', row.content_type || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.status(200).send(buf);
        return;
      } catch (err) {
        console.error('[StorageProxy] DB serve failed:', err);
        res.status(502).send('Storage proxy DB error');
        return;
      }
    }

    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
      );
      forgeUrl.searchParams.set("path", key);

      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
      });

      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }

      const { url } = (await forgeResp.json()) as { url: string };
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }

      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}
