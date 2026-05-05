import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure, router } from "../_core/trpc";
import { getLocationAccessToken } from "../helpers/tokenHelper";
import { getCustomFieldIdByName } from "../ghl-service";

const TIMING_MAP = {
  0: "within_24h",
  1: "24h",
  2: "48h",
  3: "1week",
} as const;

const REVERSE_TIMING_MAP: Record<string, 0 | 1 | 2 | 3> = {
  within_24h: 0,
  "24h": 1,
  "48h": 2,
  "1week": 3,
};

function ghlHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Version: "2023-02-21",
    "Content-Type": "application/json",
  };
}

/**
 * Discover custom field IDs for a location by name.
 * These field IDs are generic across subaccounts and are discovered at runtime.
 */
async function getRequestSchedulingFieldIds(locationId: string): Promise<{
  initialDelayFieldId: string;
  followUpLimitFieldId: string;
}> {
  const initialDelayFieldId = await getCustomFieldIdByName(locationId, "initial_request_delay");
  const followUpLimitFieldId = await getCustomFieldIdByName(locationId, "follow_up_limit");

  if (!initialDelayFieldId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Custom field 'initial_request_delay' not found in your GHL account. Please create this field in Settings > Custom Fields.",
    });
  }

  if (!followUpLimitFieldId) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Custom field 'follow_up_limit' not found in your GHL account. Please create this field in Settings > Custom Fields.",
    });
  }

  return {
    initialDelayFieldId,
    followUpLimitFieldId,
  };
}

export const requestSchedulingRouter = router({
  getSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
      })
    )
    .query(async ({ input }) => {
      const accessToken = await getLocationAccessToken(input.locationId.trim());

      const response = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(input.contactId.trim())}`, {
        method: "GET",
        headers: ghlHeaders(accessToken),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to load request scheduling settings: ${response.status} ${errorBody}`,
        });
      }

      const data = (await response.json()) as {
        contact?: {
          customFields?: Array<{ id?: string; key?: string; value?: string | number }>;
          tags?: string[];
        };
      };

      const customFields = data.contact?.customFields ?? [];
      const tags = data.contact?.tags ?? [];

      const delayField = customFields.find((field) => field.key === "initial_request_delay");
      const followUpField = customFields.find((field) => field.key === "follow_up_limit");

      const delayValue = typeof delayField?.value === "string" ? delayField.value : "";
      const followUpValue = typeof followUpField?.value === "string" ? followUpField.value : String(followUpField?.value ?? "");

      return {
        initialTiming: REVERSE_TIMING_MAP[delayValue] ?? 0,
        followUpCount: Number.parseInt(followUpValue, 10) || 3,
        isPaused: tags.includes("Pause_Reviews"),
      };
    }),

  saveSettings: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contactId: z.string().min(1),
        initialTiming: z.number().int().min(0).max(3),
        followUpCount: z.number().int().min(0).max(3),
        isPaused: z.boolean(),
      })
    )
    .mutation(async ({ input }) => {
      const { initialDelayFieldId, followUpLimitFieldId } = await getRequestSchedulingFieldIds(input.locationId.trim());
      const accessToken = await getLocationAccessToken(input.locationId.trim());
      const contactId = input.contactId.trim();

      await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
        method: "PUT",
        headers: ghlHeaders(accessToken),
        body: JSON.stringify({
          customFields: [
            {
              id: initialDelayFieldId,
              key: "initial_request_delay",
              field_value: TIMING_MAP[input.initialTiming],
            },
            {
              id: followUpLimitFieldId,
              key: "follow_up_limit",
              field_value: input.followUpCount,
            },
          ],
        }),
      }).then(async (response) => {
        if (!response.ok) {
          const errorBody = await response.text();
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to update request scheduling settings: ${response.status} ${errorBody}`,
          });
        }
      });

      if (input.isPaused) {
        const response = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/tags`, {
          method: "POST",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ tags: ["Pause_Reviews"] }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to add Pause_Reviews tag: ${response.status} ${errorBody}`,
          });
        }
      } else {
        const response = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}/tags`, {
          method: "DELETE",
          headers: ghlHeaders(accessToken),
          body: JSON.stringify({ tags: ["Pause_Reviews"] }),
        });

        if (!response.ok) {
          const errorBody = await response.text();
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Failed to remove Pause_Reviews tag: ${response.status} ${errorBody}`,
          });
        }
      }

      return { success: true };
    }),
});