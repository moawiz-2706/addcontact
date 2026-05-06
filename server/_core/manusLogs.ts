import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

const LOG_DIR = path.resolve(import.meta.dirname, "..", "..", ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) return;
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;
    const target = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const b = Buffer.byteLength(lines[i] + "\n", "utf-8");
      if (keptBytes + b > target) break;
      keptLines.unshift(lines[i]);
      keptBytes += b;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch (e) {
    // ignore trimming errors
  }
}

function writeLinesToFile(name: string, entries: unknown[]) {
  if (!entries || entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${name}.log`);
  const lines = entries.map((entry) => `[${new Date().toISOString()}] ${JSON.stringify(entry)}`);
  try {
    fs.appendFileSync(logPath, lines.join("\n") + "\n", "utf-8");
    trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
  } catch (e) {
    // swallow errors; logging shouldn't crash the server
  }
}

export function registerManusLogsRoute(app: Express) {
  app.post("/__manus__/logs", async (req: Request, res: Response) => {
    try {
      const payload = req.body ?? {};
      if (payload.consoleLogs && Array.isArray(payload.consoleLogs)) writeLinesToFile("browserConsole", payload.consoleLogs);
      if (payload.networkRequests && Array.isArray(payload.networkRequests)) writeLinesToFile("networkRequests", payload.networkRequests);
      if (payload.sessionEvents && Array.isArray(payload.sessionEvents)) writeLinesToFile("sessionReplay", payload.sessionEvents);
      res.status(200).json({ success: true });
    } catch (e) {
      res.status(500).json({ success: false });
    }
  });
}
