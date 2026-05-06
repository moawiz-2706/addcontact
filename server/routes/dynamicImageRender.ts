import type { Express, Request, Response } from "express";
import { storageGetSignedUrl } from "../storage";
import { compositeName, type OverlayConfig } from "../services/imageCompositor";

function asNum(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function asColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function asWeight(value: unknown): "normal" | "bold" {
  return value === "normal" ? "normal" : "bold";
}

function asPositionType(value: unknown): "center" | "custom" {
  return value === "custom" ? "custom" : "center";
}

function readOverlayConfig(req: Request): OverlayConfig {
  return {
    fontSize: asNum(req.query.fontSize, 72, 12, 300),
    fontColor: asColor(req.query.fontColor, "#ffffff"),
    fontWeight: asWeight(req.query.fontWeight),
    positionType: asPositionType(req.query.positionType),
    xPercent: asNum(req.query.xPercent, 50, 0, 100),
    yPercent: asNum(req.query.yPercent, 50, 0, 100),
    bgColor: asColor(req.query.bgColor, "#000000"),
    bgOpacity: asNum(req.query.bgOpacity, 0, 0, 1),
    padding: asNum(req.query.padding, 16, 0, 100),
  };
}

export function registerDynamicImageRenderRoute(app: Express) {
  app.get("/api/dynamic-image/*", async (req: Request, res: Response) => {
    const rawKey = (req.params as Record<string, string>)[0] ?? "";
    const key = rawKey ? decodeURIComponent(rawKey) : "";
    const name = typeof req.query.name === "string" && req.query.name.trim().length > 0 ? req.query.name.trim() : "";

    if (!key) {
      res.status(400).send("Missing image key");
      return;
    }

    if (!name) {
      res.status(400).send("Missing name query parameter");
      return;
    }

    try {
      const signedUrl = await storageGetSignedUrl(key);
      const baseResponse = await fetch(signedUrl);
      if (!baseResponse.ok) {
        res.status(502).send("Failed to fetch base image");
        return;
      }

      const baseImage = Buffer.from(await baseResponse.arrayBuffer());
      const config = readOverlayConfig(req);
      const output = await compositeName(baseImage, name, config);

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.status(200).send(output);
    } catch (error) {
      console.error("[dynamicImage.render]", error);
      res.status(500).send("Failed to render dynamic image");
    }
  });
}
