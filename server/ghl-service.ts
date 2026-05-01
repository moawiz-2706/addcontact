/**
 * GoHighLevel Service Module
 *
 * Handles:
 * - OAuth token exchange (authorization code → access + refresh tokens)
 * - Automatic token refresh before expiry
 * - GHL API calls (create contact, add to workflow)
 * - Installation management (CRUD on ghl_installations table)
 */

import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { ghlInstallations, type GHLInstallation } from "../drizzle/schema";
import { ENV } from "./_core/env";

const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
// Refresh tokens 10 minutes before they expire
const TOKEN_REFRESH_BUFFER_MS = 10 * 60 * 1000;

// ─── Types ───────────────────────────────────────────────────────────

export interface GHLTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  userType: string;
  locationId?: string;
  companyId?: string;
  userId?: string;
}

export interface GHLContactData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dnd?: boolean;
}

export interface GHLCreateContactResponse {
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    locationId: string;
    dnd: boolean;
  };
}

// ─── Token Exchange ──────────────────────────────────────────────────

/**
 * Exchange an authorization code for access + refresh tokens.
 * Called when a sub-account installs the app and GHL redirects back with a code.
 */
export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string
): Promise<GHLTokenResponse> {
  const response = await fetch(`${GHL_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: ENV.ghlClientId,
      client_secret: ENV.ghlClientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[GHL] Token exchange failed:", response.status, errorBody);
    throw new Error(`GHL token exchange failed: ${response.status}`);
  }

  return response.json() as Promise<GHLTokenResponse>;
}

/**
 * Refresh an access token using the refresh token.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<GHLTokenResponse> {
  const response = await fetch(`${GHL_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: ENV.ghlClientId,
      client_secret: ENV.ghlClientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[GHL] Token refresh failed:", response.status, errorBody);
    throw new Error(`GHL token refresh failed: ${response.status}`);
  }

  return response.json() as Promise<GHLTokenResponse>;
}

// ─── Installation Management ─────────────────────────────────────────

/**
 * Save or update a GHL installation after OAuth token exchange.
 */
export async function upsertInstallation(
  tokenResponse: GHLTokenResponse,
  locationId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const expiresAt = Date.now() + tokenResponse.expires_in * 1000;

  await db
    .insert(ghlInstallations)
    .values({
      locationId,
      companyId: tokenResponse.companyId ?? null,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      scopes: tokenResponse.scope ?? null,
      userId: tokenResponse.userId ?? null,
    })
    .onConflictDoUpdate({
      target: ghlInstallations.locationId,
      set: {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt,
        scopes: tokenResponse.scope ?? null,
        companyId: tokenResponse.companyId ?? null,
        userId: tokenResponse.userId ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * Get an installation by locationId.
 */
export async function getInstallation(
  locationId: string
): Promise<GHLInstallation | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(ghlInstallations)
    .where(eq(ghlInstallations.locationId, locationId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

/**
 * Get all installations (for admin view).
 */
export async function getAllInstallations(): Promise<GHLInstallation[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(ghlInstallations);
}

/**
 * Update the workflow ID for a specific installation.
 */
export async function updateWorkflowId(
  locationId: string,
  workflowId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(ghlInstallations)
    .set({ workflowId })
    .where(eq(ghlInstallations.locationId, locationId));
}

/**
 * Get a valid access token for a location, refreshing if needed.
 */
export async function getValidAccessToken(
  locationId: string
): Promise<string> {
  const installation = await getInstallation(locationId);
  if (!installation) {
    throw new Error(`No GHL installation found for location: ${locationId}`);
  }

  // Check if token needs refresh
  if (Date.now() + TOKEN_REFRESH_BUFFER_MS >= installation.expiresAt) {
    console.log(`[GHL] Refreshing token for location ${locationId}`);
    try {
      const newTokens = await refreshAccessToken(installation.refreshToken);
      await upsertInstallation(newTokens, locationId);
      return newTokens.access_token;
    } catch (error) {
      console.error(`[GHL] Failed to refresh token for ${locationId}:`, error);
      throw new Error("Failed to refresh GHL access token. The app may need to be reinstalled.");
    }
  }

  return installation.accessToken;
}

// ─── GHL API Calls ───────────────────────────────────────────────────

/**
 * Create a single contact in GHL.
 */
export async function createContact(
  locationId: string,
  contact: GHLContactData
): Promise<GHLCreateContactResponse> {
  const accessToken = await getValidAccessToken(locationId);

  const response = await fetch(`${GHL_BASE_URL}/contacts/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      Version: GHL_API_VERSION,
    },
    body: JSON.stringify({
      firstName: contact.firstName,
      lastName: contact.lastName,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email || undefined,
      phone: contact.phone || undefined,
      locationId,
      dnd: contact.dnd || false,
      source: "Royal Review - Add Contacts",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      (errorBody as Record<string, string>).message ||
        `Failed to create contact: ${response.status}`
    );
  }

  return response.json() as Promise<GHLCreateContactResponse>;
}

/**
 * Add a contact to the review reactivation workflow.
 */
export async function addContactToWorkflow(
  locationId: string,
  contactId: string,
  workflowId: string
): Promise<{ success: boolean }> {
  const accessToken = await getValidAccessToken(locationId);

  const response = await fetch(
    `${GHL_BASE_URL}/contacts/${contactId}/workflow/${workflowId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify({
        eventStartTime: new Date().toISOString(),
      }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    throw new Error(
      (errorBody as Record<string, string>).message ||
        `Failed to add to workflow: ${response.status}`
    );
  }

  return { success: true };
}

/**
 * Process a single contact: create + optionally add to workflow.
 */
export async function processContact(
  locationId: string,
  contact: GHLContactData,
  workflowId?: string
): Promise<{ contactId: string; enrolledInWorkflow: boolean }> {
  const result = await createContact(locationId, contact);
  const contactId = result.contact.id;

  let enrolledInWorkflow = false;
  if (!contact.dnd && workflowId) {
    try {
      await addContactToWorkflow(locationId, contactId, workflowId);
      enrolledInWorkflow = true;
    } catch (error) {
      console.warn(
        `[GHL] Failed to enroll contact ${contactId} in workflow:`,
        error
      );
    }
  }

  return { contactId, enrolledInWorkflow };
}
