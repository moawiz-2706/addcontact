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
    .mutation(async ({ input }) => {
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
        contactId: z.string().min(1),
        sampleName: z.string().min(1).max(100),
        customFieldKey: z.string().min(1), // e.g., "dynamic_image_url"
        overlayConfig: overlayConfigSchema.optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const locationId = input.locationId.trim();
        const contactId = input.contactId.trim();
        const customFieldKey = input.customFieldKey.trim();

        // 1. Get access token
        const accessToken = await getValidAccessToken(locationId);

        // 2. Composite the base image
        const imageBuffer = Buffer.from(input.imageBase64, "base64");
        const compositeBuffer = await compositeName(
          imageBuffer,
          input.sampleName,
          input.overlayConfig as OverlayConfig
        );

        // 3. Upload base image to storage (for dynamic rendering)
        const { url: baseImageUrl, key: baseImageKey } = await storagePut(
          `dynamic-images/base`,
          imageBuffer,
          "image/png"
        );

        // 4. Upload composite preview to storage (for display)
        const { url: previewUrl } = await storagePut(
          `dynamic-images/preview`,
          compositeBuffer,
          "image/png"
        );

        // 5. Discover custom field ID by name
        const fieldId = await getCustomFieldIdByName(locationId, customFieldKey);
        if (!fieldId) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Custom field "${customFieldKey}" not found in your GHL account. Please create this field in Settings > Custom Fields.`,
          });
        }

        // 6. Build dynamic URL template
        // The base URL uses the storage key; client appends ?name=VALUE
        const dynamicUrlTemplate = `${baseImageUrl}?name=`;

        // 7. Update GHL contact custom field with dynamic URL
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

        return {
          success: true,
          dynamicUrlTemplate,
          previewUrl,
          baseImageUrl,
          baseImageKey,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        console.error("[dynamicImage.saveAndUpdateContact]", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Save failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
});
