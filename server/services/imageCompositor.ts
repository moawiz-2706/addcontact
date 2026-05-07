/**
 * Image Compositing Service
 *
 * Uses Sharp to overlay personalized text on image buffers.
 * Returns PNG buffers ready for storage.
 */

import sharp from "sharp";

export const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;
const MAX_RENDER_DIMENSION = 2200;
const MAX_INPUT_PIXELS = 40_000_000;
const TARGET_NORMALIZED_BYTES = 15 * 1024;
const MIN_RENDER_DIMENSION = 700;

export interface OverlayConfig {
  fontSize?: number;
  fontColor?: string;
  fontWeight?: "normal" | "bold";
  positionType?: "center" | "custom";
  xPercent?: number;
  yPercent?: number;
  bgColor?: string;
  bgOpacity?: number;
  padding?: number;
}

export async function normalizeImageForCompose(imageBuffer: Buffer): Promise<Buffer> {
  // Aggressively normalize to keep memory use low in serverless functions.
  const base = sharp(imageBuffer, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
  const meta = await base.metadata();
  const originalW = Math.max(1, meta.width ?? MAX_RENDER_DIMENSION);
  const originalH = Math.max(1, meta.height ?? MAX_RENDER_DIMENSION);

  let best = await base
    .clone()
    .resize({
      width: MAX_RENDER_DIMENSION,
      height: MAX_RENDER_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();

  if (best.length <= TARGET_NORMALIZED_BYTES) return best;

  const qualitySteps = [72, 62, 52, 42, 34, 28, 24];
  for (const quality of qualitySteps) {
    const candidate = await base
      .clone()
      .resize({
        width: MAX_RENDER_DIMENSION,
        height: MAX_RENDER_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    best = candidate;
    if (candidate.length <= TARGET_NORMALIZED_BYTES) return candidate;
  }

  // If still above target, reduce dimensions gradually.
  const maxEdge = Math.max(originalW, originalH);
  const dimensionSteps = [1600, 1400, 1200, 1000, 900, 800, 700];
  for (const targetEdge of dimensionSteps) {
    const clampedEdge = Math.max(MIN_RENDER_DIMENSION, Math.min(MAX_RENDER_DIMENSION, targetEdge));
    const scale = Math.min(1, clampedEdge / maxEdge);
    const w = Math.max(MIN_RENDER_DIMENSION, Math.round(originalW * scale));
    const h = Math.max(MIN_RENDER_DIMENSION, Math.round(originalH * scale));

    const candidate = await base
      .clone()
      .resize({ width: w, height: h, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 22, mozjpeg: true })
      .toBuffer();

    best = candidate;
    if (candidate.length <= TARGET_NORMALIZED_BYTES) return candidate;
  }

  // Best effort if the source image cannot practically reach target size.
  return best;
}

/**
 * Escape XML special characters for SVG text
 */
function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Composite a personalized name onto a base image buffer.
 *
 * @param imageBuffer - Raw bytes of the base image (JPG, PNG, etc.)
 * @param name - The personalized name/text to overlay
 * @param config - Overlay configuration options
 * @returns PNG buffer of the composited image
 */
export async function compositeName(
  imageBuffer: Buffer,
  name: string,
  config: OverlayConfig = {}
): Promise<Buffer> {
  const {
    fontSize = 72,
    fontColor = "#111111",
    fontWeight = "bold",
    bgColor = "#ffffff",
    bgOpacity = 1,
    padding = 20,
  } = config;

  try {
    // Get image metadata
    const meta = await sharp(imageBuffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
    const W = meta.width || 800;
    const H = meta.height || 600;

    // Estimate a label box that sits below the center of the image.
    const estimatedTextWidth = name.length * fontSize * 0.58;
    const boxW = Math.min(W - 48, Math.max(240, Math.round(estimatedTextWidth + padding * 2)));
    const boxH = Math.max(Math.round(fontSize + padding * 2), 84);

    // Fixed placement: centered horizontally, slightly below the middle of the image.
    const left = Math.max(24, Math.round((W - boxW) / 2));
    const desiredTop = Math.round(H * 0.72 - boxH / 2);
    const top = Math.max(24, Math.min(H - boxH - 24, desiredTop));

    // Always render the label on a solid white background, per product requirement.
    const bgHex = "#ffffff";
    const bgR = 255;
    const bgG = 255;
    const bgB = 255;
    const rectOpacity = 1;

    // Create SVG overlay
    const svgText = `
      <svg width="${Math.round(boxW)}" height="${Math.round(boxH)}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="rgba(0,0,0,0.18)" />
          </filter>
        </defs>
        <rect
          x="0" y="0"
          width="${Math.round(boxW)}" height="${Math.round(boxH)}"
          fill="rgba(${bgR},${bgG},${bgB},${rectOpacity})"
          rx="18"
          ry="18"
          filter="url(#shadow)"
        />
        <text
          x="${Math.round(boxW / 2)}"
          y="${Math.round(boxH / 2 + fontSize * 0.35)}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fontSize}"
          font-weight="${fontWeight}"
          fill="${fontColor}"
          text-anchor="middle"
          dominant-baseline="middle"
        >${escapeXml(name)}</text>
      </svg>
    `;

    const svgBuffer = Buffer.from(svgText);

    // Composite SVG onto base image
    const output = await sharp(imageBuffer, { limitInputPixels: MAX_INPUT_PIXELS })
      .composite([
        {
          input: svgBuffer,
          top: Math.max(0, top),
          left: Math.max(0, left),
        },
      ])
      .png()
      .toBuffer();

    return output;
  } catch (error) {
    console.error("[imageCompositor] Error:", error);
    throw new Error(`Image composition failed: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
}
