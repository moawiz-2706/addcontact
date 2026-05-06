/**
 * Image Compositing Service
 *
 * Uses Sharp to overlay personalized text on image buffers.
 * Returns PNG buffers ready for storage.
 */

import sharp from "sharp";

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
    fontColor = "#ffffff",
    fontWeight = "bold",
    positionType = "center",
    xPercent = 50,
    yPercent = 50,
    bgColor = "transparent",
    bgOpacity = 0,
    padding = 16,
  } = config;

  try {
    // Get image metadata
    const meta = await sharp(imageBuffer).metadata();
    const W = meta.width || 800;
    const H = meta.height || 600;

    // Estimate text box dimensions
    // Rough estimate: 0.6 * fontSize per character width
    const estimatedTextWidth = name.length * fontSize * 0.6;
    const boxW = estimatedTextWidth + padding * 2;
    const boxH = fontSize + padding * 2;

    // Calculate anchor position based on positionType
    let cx: number, cy: number;
    if (positionType === "center") {
      cx = W / 2;
      cy = H / 2;
    } else {
      cx = (xPercent / 100) * W;
      cy = (yPercent / 100) * H;
    }

    // Calculate top-left corner for text box
    const left = Math.round(cx - boxW / 2);
    const top = Math.round(cy - boxH / 2);

    // Parse hex color to rgba for background
    const bgHex = bgColor.startsWith("#") ? bgColor : "#000000";
    const bgR = parseInt(bgHex.slice(1, 3), 16) || 0;
    const bgG = parseInt(bgHex.slice(3, 5), 16) || 0;
    const bgB = parseInt(bgHex.slice(5, 7), 16) || 0;

    // Create SVG overlay
    const svgText = `
      <svg width="${Math.round(boxW)}" height="${Math.round(boxH)}" xmlns="http://www.w3.org/2000/svg">
        <rect
          x="0" y="0"
          width="${Math.round(boxW)}" height="${Math.round(boxH)}"
          fill="rgba(${bgR},${bgG},${bgB},${bgOpacity})"
          rx="4"
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
    const output = await sharp(imageBuffer)
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
