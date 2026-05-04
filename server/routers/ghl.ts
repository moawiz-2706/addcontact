/**
 * GHL tRPC Router
 *
 * Provides backend-proxied GHL API operations:
 * - Connection status check
 * - Create single contact
 * - Process batch contacts
 * - Update workflow ID
 * - List installations (admin)
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { publicProcedure, protectedProcedure, router } from "../_core/trpc";
import {
  getInstallation,
  getAllInstallations,
  searchContacts,
  processContact,
  updateWorkflowId,
  getValidAccessToken,
  type GHLContactData,
  type GHLContactStatusFilter,
} from "../ghl-service";

// Contact data schema
const contactSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().optional().default(""),
  email: z.string().optional().default(""),
  phone: z.string().optional().default(""),
  dnd: z.boolean().optional().default(false),
});

// Batch contact schema
const batchContactSchema = z.object({
  locationId: z.string().min(1),
  contacts: z.array(contactSchema).min(1).max(500),
  dnd: z.boolean().optional().default(false),
});

const contactsQuerySchema = z.object({
  locationId: z.string().min(1),
  query: z.string().optional().default(""),
  pageLimit: z.number().int().min(1).max(100).optional().default(25),
  searchAfter: z.array(z.string()).optional(),
  statusFilters: z.array(z.enum(["stopped", "clicked", "dnc"])).optional().default([]),
});

export const ghlRouter = router({
  /**
   * Check if a GHL location is connected (has valid OAuth tokens).
   */
  connectionStatus: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const normalizedLocationId = input.locationId.trim();
      const installation = await getInstallation(normalizedLocationId);
      if (!installation) {
        console.warn(`[GHL] No installation found for location/company id: ${normalizedLocationId}`);
        return {
          connected: false,
          locationId: normalizedLocationId,
          workflowId: null,
          expiresAt: null,
        };
      }

      return {
        connected: true,
        locationId: normalizedLocationId,
        workflowId: installation.workflowId,
        expiresAt: installation.expiresAt,
      };
    }),

  /**
   * Create a single contact and optionally enroll in workflow.
   */
  createContact: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        contact: contactSchema,
      })
    )
    .mutation(async ({ input }) => {
      const normalizedLocationId = input.locationId.trim();
      const installation = await getInstallation(normalizedLocationId);
      if (!installation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "GHL location not connected. Please install the app first.",
        });
      }

      const contactData: GHLContactData = {
        firstName: input.contact.firstName,
        lastName: input.contact.lastName ?? "",
        email: input.contact.email ?? "",
        phone: input.contact.phone ?? "",
        dnd: input.contact.dnd ?? false,
      };

      const result = await processContact(
        normalizedLocationId,
        contactData,
        installation.workflowId ?? undefined
      );

      return result;
    }),

  /**
   * Process a batch of contacts (CSV upload).
   */
  processBatch: publicProcedure
    .input(batchContactSchema)
    .mutation(async ({ input }) => {
      const normalizedLocationId = input.locationId.trim();
      const installation = await getInstallation(normalizedLocationId);
      if (!installation) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "GHL location not connected. Please install the app first.",
        });
      }

      let successful = 0;
      let failed = 0;
      let enrolled = 0;
      const errors: Array<{ index: number; name: string; error: string }> = [];

      for (let i = 0; i < input.contacts.length; i++) {
        const contact = input.contacts[i];
        const contactData: GHLContactData = {
          firstName: contact.firstName,
          lastName: contact.lastName ?? "",
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          dnd: input.dnd,
        };

        try {
          const result = await processContact(
            normalizedLocationId,
            contactData,
            installation.workflowId ?? undefined
          );
          successful++;
          if (result.enrolledInWorkflow) enrolled++;
        } catch (error) {
          failed++;
          errors.push({
            index: i,
            name: `${contact.firstName} ${contact.lastName}`.trim(),
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }

        // Rate limiting: wait 500ms between requests
        if (i < input.contacts.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      return { successful, failed, enrolled, errors, total: input.contacts.length };
    }),

  /**
   * Update the workflow ID for a location.
   */
  updateWorkflowId: publicProcedure
    .input(
      z.object({
        locationId: z.string().min(1),
        workflowId: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await updateWorkflowId(input.locationId.trim(), input.workflowId);
      return { success: true };
    }),

  /**
   * Get all installations (admin view).
   */
  listInstallations: protectedProcedure.query(async () => {
    const installations = await getAllInstallations();
    return installations.map((inst) => ({
      locationId: inst.locationId,
      companyId: inst.companyId,
      workflowId: inst.workflowId,
      connected: Date.now() < inst.expiresAt,
      createdAt: inst.createdAt,
      updatedAt: inst.updatedAt,
    }));
  }),

  /**
   * Fetch and normalize contacts from GHL for the read-only Contacts page.
   */
  listContacts: publicProcedure
    .input(contactsQuerySchema)
    .query(async ({ input }) => {
      const result = await searchContacts(input.locationId.trim(), {
        query: input.query,
        pageLimit: input.pageLimit,
        searchAfter: input.searchAfter,
        statusFilters: input.statusFilters as GHLContactStatusFilter[],
      });

      return result;
    }),

  /**
   * Verify that the access token is valid by attempting to use it.
   */
  verifyConnection: publicProcedure
    .input(z.object({ locationId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const token = await getValidAccessToken(input.locationId.trim());
        return { valid: true, message: "Connection is active" };
      } catch (error) {
        return {
          valid: false,
          message: error instanceof Error ? error.message : "Connection failed",
        };
      }
    }),
});
