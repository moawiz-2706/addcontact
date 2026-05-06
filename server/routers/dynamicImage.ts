/**
 * Dynamic Image Router (tRPC)
 *
 * Handles image upload, composition, storage, and GHL custom field updates.
 * Uses tRPC for all endpoints to match the app's RPC architecture.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, router } from "../_core/trpc";
import { compositeName, type OverlayConfig } from "../services/imageCompositor";
import { getValidAccessToken, getCustomFieldIdByName } from "../ghl-service";
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

        // Composite
        const pngBuffer = await compositeName(
          imageBuffer,
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
   * 3. Discover or use custom field ID
   * 4. Save URL to GHL contact custom field
   *
   * Input: image buffer + contact ID + field config
   * Output: dynamic URL template + preview URL
   */
  saveAndUpdateContact: publicProcedure
    .input(
      z.object({
        imageBase64: z.string().min(100), // base64-encoded image
        locationId: z.string().min(1),
        contactId: z.string().min(1).optional(),
        sampleName: z.string().min(1).max(100),
        customFieldKey: z.string().min(1), // e.g., "dynamic_image_url"
        overlayConfig: overlayConfigSchema.optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const startedAt = Date.now();
        const locationId = input.locationId.trim();
        const contactId = input.contactId?.trim() || "";
        const customFieldKey = input.customFieldKey.trim();

        console.log("[dynamicImage.saveAndUpdateContact] Starting...", {
          locationId,
          contactId,
          sampleName: input.sampleName,
          base64Length: input.imageBase64.length,
        });

        // 2. Composite the base image
        console.log("[dynamicImage.saveAndUpdateContact] Compositing image...");
        const imageBuffer = Buffer.from(input.imageBase64, "base64");
        const compositeBuffer = await compositeName(
          imageBuffer,
          input.sampleName,
          input.overlayConfig as OverlayConfig
        );
        console.log("[dynamicImage.saveAndUpdateContact] Composite done, uploading to storage...");

        // 3-4. Upload base image + preview in parallel for lower latency
        const [{ url: baseImageUrl, key: baseImageKey }, { url: previewUrl }] = await Promise.all([
          storagePut(`dynamic-images/base`, imageBuffer, "image/png"),
          storagePut(`dynamic-images/preview`, compositeBuffer, "image/png"),
        ]);

        console.log("[dynamicImage.saveAndUpdateContact] Storage upload done, building URL...");

        // 5. Build dynamic URL template (runtime rendered, Nifty-style)
        const protocolHeader = (ctx.req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
        const hostHeader = (ctx.req.headers["x-forwarded-host"] as string | undefined)?.split(",")[0]?.trim() || ctx.req.get("host") || "";
        const protocol = protocolHeader || (hostHeader.includes("localhost") ? "http" : "https");
        const origin = `${protocol}://${hostHeader}`;

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

        // 6. Optionally update the selected contact custom field
        if (contactId) {
          console.log("[dynamicImage.saveAndUpdateContact] Updating contact custom field...");
          const accessToken = await getValidAccessToken(locationId);
          const fieldId = await getCustomFieldIdByName(locationId, customFieldKey);
          if (!fieldId) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Custom field "${customFieldKey}" not found in your GHL account. Please create this field in Settings > Custom Fields.`,
            });
          }

          const ghlResponse = await fetch(
            `https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`,
            {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                Version: "2023-02-21",
              },
              body: JSON.stringify({
                customFields: [
                  {
                    id: fieldId,
                    key: `contact.${customFieldKey}`,
                    field_value: dynamicUrlTemplate,
                  },
                ],
              }),
            }
          );

          if (!ghlResponse.ok) {
            const errorBody = await ghlResponse.text();
            console.error("[dynamicImage] GHL update failed:", errorBody);
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Failed to update GHL contact: ${ghlResponse.status}`,
            });
          }
          console.log("[dynamicImage.saveAndUpdateContact] Contact updated successfully");
        }

        console.log(`[dynamicImage.saveAndUpdateContact] completed in ${Date.now() - startedAt}ms (contactSync=${Boolean(contactId)})`);

        return {
          success: true,
          dynamicUrlTemplate,
          previewUrl,
          baseImageUrl,
          baseImageKey,
        };
      } catch (error) {
        console.error("[dynamicImage.saveAndUpdateContact] Error caught:", error);
        if (error instanceof TRPCError) throw error;
        console.error("[dynamicImage.saveAndUpdateContact]", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Save failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
});
