/**
 * Dynamic Image Router (tRPC)
 *
 * Handles image upload, composition, storage, and GHL custom field updates.
 * Uses tRPC for all endpoints to match the app's RPC architecture.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import {
  compositeName,
  normalizeImageForCompose,
  MAX_UPLOAD_BYTES,
  type OverlayConfig,
} from "../services/imageCompositor";
import { storagePut } from "../storage";

// Overlay config schema for tRPC validation
const overlayConfigSchema = z.object({
  fontSize: z.number().int().min(12).max(300).optional().default(72),
  fontColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional().default("#ffffff"),
  fontWeight: z.enum(["normal", "bold"]).optional().default("bold"),
  positionType: z.enum(["center", "custom"]).optional().default("center"),
  xPercent: z.number().min(0).max(100).optional().default(50),
  yPercent: z.number().min(0).max(100).optional().default(50),
  bgColor: z.string().regex(/^#[0-9a-f]{6}$/i).optional().default("#000000"),
  bgOpacity: z.number().min(0).max(1).optional().default(0),
  padding: z.number().int().min(0).max(100).optional().default(16),
});

/**
 * POST /api/trpc/dynamicImage.previewComposite
 *
 * Generates a preview of the composited image without saving to storage.
 * Used for live preview in the UI.
 *
 * Input: binary image file + text + overlay config
 * Output: PNG binary
 */
export const dynamicImageRouter = router({
  previewComposite: publicProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100), // base64-encoded image
        name: z.string().min(1).max(100),
        overlayConfig: overlayConfigSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        // Decode base64 image
        const imageBuffer = Buffer.from(input.imageBase64, "base64");
        if (imageBuffer.length > MAX_UPLOAD_BYTES) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Image too large. Max allowed size is 3.5 MB.",
          });
        }

        const normalizedBuffer = await normalizeImageForCompose(imageBuffer);

        // Composite
        const pngBuffer = await compositeName(
          normalizedBuffer,
          input.name,
          input.overlayConfig as OverlayConfig
        );

        // Return as base64 for client to display
        return {
          success: true,
          imageBase64: pngBuffer.toString("base64"),
          mimeType: "image/png",
        };
      } catch (error) {
        console.error("[dynamicImage.previewComposite]", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Preview failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),

  /**
   * POST /api/trpc/dynamicImage.saveAndUpdateContact
   *
   * Complete flow:
   * 1. Composite image with sample name
   * 2. Upload to storage via storagePut()
    * 3. Build dynamic URL template and return it to the client
   *
    * Input: image buffer + field config
   * Output: dynamic URL template + preview URL
   */
  saveAndUpdateContact: publicProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100), // base64-encoded image
        locationId: z.string().min(1),
        contactId: z.string().optional(),
        sampleName: z.string().min(1).max(100),
        customFieldKey: z.string().min(1), // e.g., "dynamic_image_url"
        overlayConfig: overlayConfigSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const startedAt = Date.now();
      try {
        const locationId = input.locationId.trim();
        const contactId = input.contactId?.trim() || "";
        void contactId;
        void input.customFieldKey;

        console.log("[dynamicImage.saveAndUpdateContact] Starting...", {
          locationId,
          sampleName: input.sampleName,
          base64Length: input.imageBase64.length,
        });

        // 2. Composite the base image
        console.log("[dynamicImage.saveAndUpdateContact] Step 1: Compositing image...");
        try {
          const imageBuffer = Buffer.from(input.imageBase64, "base64");
          if (imageBuffer.length > MAX_UPLOAD_BYTES) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Image too large. Max allowed size is 3.5 MB.",
            });
          }

          const normalizedBuffer = await normalizeImageForCompose(imageBuffer);
          console.log("[dynamicImage.saveAndUpdateContact] Buffer created, size:", imageBuffer.length);
          
          const compositeBuffer = await compositeName(
            normalizedBuffer,
            input.sampleName,
            input.overlayConfig as OverlayConfig
          );
          console.log("[dynamicImage.saveAndUpdateContact] Composite done, size:", compositeBuffer.length);
          
          // 3-4. Upload base image + preview in parallel for lower latency
          console.log("[dynamicImage.saveAndUpdateContact] Step 2: Starting S3 uploads...");
          const uploadStartTime = Date.now();
          
          const uploadPromises = [
            storagePut(`dynamic-images/base`, normalizedBuffer, "image/jpeg").catch(err => {
              console.error("[dynamicImage.saveAndUpdateContact] Base upload error:", err);
              throw new Error(`Base image upload failed: ${err.message}`);
            }),
            storagePut(`dynamic-images/preview`, compositeBuffer, "image/png").catch(err => {
              console.error("[dynamicImage.saveAndUpdateContact] Preview upload error:", err);
              throw new Error(`Preview image upload failed: ${err.message}`);
            }),
          ];

          const uploadResults = await Promise.all(uploadPromises);
          console.log("[dynamicImage.saveAndUpdateContact] All uploads completed in", Date.now() - uploadStartTime, "ms");

          const [baseUploadResult, previewUploadResult] = uploadResults;
          
          const { url: baseImageUrl, key: baseImageKey } = baseUploadResult;
          const { url: previewUrl } = previewUploadResult;
          
          console.log("[dynamicImage.saveAndUpdateContact] Storage upload done, building URL...");
          console.log("[dynamicImage.saveAndUpdateContact] baseImageKey:", baseImageKey);
          console.log("[dynamicImage.saveAndUpdateContact] previewUrl:", previewUrl);

          // 5. Build dynamic URL template (runtime rendered, Nifty-style)
          const protocolHeader = (ctx.req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
          const hostHeader = (ctx.req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || ctx.req.get("host") || "";
          const protocol = protocolHeader || (hostHeader.includes("localhost") ? "http" : "https");
          const origin = `${protocol}://${hostHeader}`;

          console.log("[dynamicImage.saveAndUpdateContact] Using origin:", origin);

          const effectiveConfig = {
            fontSize: input.overlayConfig?.fontSize ?? 72,
            fontColor: input.overlayConfig?.fontColor ?? "#ffffff",
            fontWeight: input.overlayConfig?.fontWeight ?? "bold",
            positionType: input.overlayConfig?.positionType ?? "center",
            xPercent: input.overlayConfig?.xPercent ?? 50,
            yPercent: input.overlayConfig?.yPercent ?? 50,
            bgColor: input.overlayConfig?.bgColor ?? "#000000",
            bgOpacity: input.overlayConfig?.bgOpacity ?? 0,
            padding: input.overlayConfig?.padding ?? 16,
          };

          const dynamicUrlTemplate =
            `${origin}/api/dynamic-image/${encodeURIComponent(baseImageKey)}` +
            `?fontSize=${encodeURIComponent(String(effectiveConfig.fontSize))}` +
            `&fontColor=${encodeURIComponent(effectiveConfig.fontColor)}` +
            `&fontWeight=${encodeURIComponent(effectiveConfig.fontWeight)}` +
            `&positionType=${encodeURIComponent(effectiveConfig.positionType)}` +
            `&xPercent=${encodeURIComponent(String(effectiveConfig.xPercent))}` +
            `&yPercent=${encodeURIComponent(String(effectiveConfig.yPercent))}` +
            `&bgColor=${encodeURIComponent(effectiveConfig.bgColor)}` +
            `&bgOpacity=${encodeURIComponent(String(effectiveConfig.bgOpacity))}` +
            `&padding=${encodeURIComponent(String(effectiveConfig.padding))}` +
            `&name=`;

          console.log("[dynamicImage.saveAndUpdateContact] URL template built, total time:", Date.now() - startedAt, "ms");

          const response = {
            success: true,
            dynamicUrlTemplate,
            previewUrl,
            baseImageUrl,
            baseImageKey,
          };
          
          console.log("[dynamicImage.saveAndUpdateContact] Returning response:", { success: true, baseImageKey, previewUrl });
          return response;
        } catch (innerError) {
          console.error("[dynamicImage.saveAndUpdateContact] Inner error:", innerError);
          throw innerError;
        }
      } catch (error) {
        console.error("[dynamicImage.saveAndUpdateContact] Error caught (total time:", Date.now() - startedAt, "ms):", error);
        if (error instanceof TRPCError) {
          console.error("[dynamicImage.saveAndUpdateContact] Already a TRPC error, re-throwing");
          throw error;
        }
        console.error("[dynamicImage.saveAndUpdateContact] Stack:", (error as any)?.stack);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Save failed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),
});
