import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the env module before importing ghl-service
vi.mock("./_core/env", () => ({
  ENV: {
    ghlClientId: "test_client_id",
    ghlClientSecret: "test_client_secret",
    appId: "",
    cookieSecret: "",
    databaseUrl: "",
    oAuthServerUrl: "",
    ownerOpenId: "",
    isProduction: false,
    forgeApiUrl: "",
    forgeApiKey: "",
  },
}));

// Mock the db module
vi.mock("./db", () => ({
  getDb: vi.fn(),
}));

import {
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  getInstallation,
  upsertInstallation,
} from "./ghl-service";

// We need to mock fetch globally
const originalFetch = globalThis.fetch;

describe("exchangeCodeForTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exchanges authorization code for tokens successfully", async () => {
    const mockTokenResponse = {
      access_token: "access_abc123",
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: "refresh_xyz789",
      scope: "contacts.write contacts.readonly",
      userType: "Location",
      locationId: "loc_test_123",
      companyId: "comp_test_456",
      userId: "user_test_789",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockTokenResponse),
    });

    const result = await exchangeCodeForTokens(
      "auth_code_123",
      "https://example.com/api/ghl/oauth/callback"
    );

    expect(result.access_token).toBe("access_abc123");
    expect(result.refresh_token).toBe("refresh_xyz789");
    expect(result.locationId).toBe("loc_test_123");
    expect(result.expires_in).toBe(86400);

    // Verify the fetch was called with correct parameters
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://services.leadconnectorhq.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      })
    );

    // Verify the body contains the correct parameters
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = fetchCall[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth_code_123");
    expect(body.get("client_id")).toBe("test_client_id");
    expect(body.get("client_secret")).toBe("test_client_secret");
    expect(body.get("redirect_uri")).toBe(
      "https://example.com/api/ghl/oauth/callback"
    );
  });

  it("throws error when token exchange fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve("Invalid authorization code"),
    });

    await expect(
      exchangeCodeForTokens(
        "invalid_code",
        "https://example.com/api/ghl/oauth/callback"
      )
    ).rejects.toThrow("GHL token exchange failed: 400");
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("refreshes token successfully", async () => {
    const mockRefreshResponse = {
      access_token: "new_access_token",
      token_type: "Bearer",
      expires_in: 86400,
      refresh_token: "new_refresh_token",
      scope: "contacts.write",
      userType: "Location",
      locationId: "loc_123",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockRefreshResponse),
    });

    const result = await refreshAccessToken("old_refresh_token");

    expect(result.access_token).toBe("new_access_token");
    expect(result.refresh_token).toBe("new_refresh_token");

    // Verify the body contains refresh_token grant type
    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = fetchCall[1].body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old_refresh_token");
  });

  it("throws error when refresh fails", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Invalid refresh token"),
    });

    await expect(refreshAccessToken("expired_refresh_token")).rejects.toThrow(
      "GHL token refresh failed: 401"
    );
  });
});

describe("getValidAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns existing token when not expired", async () => {
    // Mock getInstallation to return a valid installation
    const { getDb } = await import("./db");
    const mockedGetDb = vi.mocked(getDb);

    // Create a mock DB that returns a valid installation
    const futureExpiry = Date.now() + 3600000; // 1 hour from now
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([
            {
              id: 1,
              locationId: "loc_valid",
              companyId: "comp_1",
              accessToken: "valid_token_123",
              refreshToken: "refresh_abc",
              expiresAt: futureExpiry,
              scopes: "contacts.write",
              userId: "user_1",
              workflowId: "wf_1",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]),
        }),
      }),
    });

    mockedGetDb.mockResolvedValue({
      select: mockSelect,
      insert: vi.fn(),
      update: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof getDb>>);

    const token = await getValidAccessToken("loc_valid");
    expect(token).toBe("valid_token_123");
  });

  it("throws error when no installation exists", async () => {
    const { getDb } = await import("./db");
    const mockedGetDb = vi.mocked(getDb);

    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    mockedGetDb.mockResolvedValue({
      select: mockSelect,
    } as unknown as Awaited<ReturnType<typeof getDb>>);

    await expect(getValidAccessToken("loc_nonexistent")).rejects.toThrow(
      "No GHL installation found"
    );
  });
});
