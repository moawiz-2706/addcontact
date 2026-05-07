import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the ghl-service module
vi.mock("./ghl-service", () => ({
  getInstallation: vi.fn(),
  getAllInstallations: vi.fn(),
  processContact: vi.fn(),
  getValidAccessToken: vi.fn(),
}));

import {
  getInstallation,
  getAllInstallations,
  processContact,
  getValidAccessToken,
} from "./ghl-service";

const mockedGetInstallation = vi.mocked(getInstallation);
const mockedGetAllInstallations = vi.mocked(getAllInstallations);
const mockedProcessContact = vi.mocked(processContact);
const mockedGetValidAccessToken = vi.mocked(getValidAccessToken);

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("ghl.connectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns connected=false when no installation exists", async () => {
    mockedGetInstallation.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createPublicContext());

    const result = await caller.ghl.connectionStatus({
      locationId: "loc_123",
    });

    expect(result.connected).toBe(false);
    expect(result.locationId).toBe("loc_123");
  });

  it("returns connected=true when installation exists", async () => {
    mockedGetInstallation.mockResolvedValue({
      id: 1,
      locationId: "loc_123",
      companyId: "comp_456",
      accessToken: "token_abc",
      refreshToken: "refresh_xyz",
      expiresAt: Date.now() + 3600000,
      scopes: "contacts.write",
      userId: "user_789",
      workflowId: "wf_001",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const caller = appRouter.createCaller(createPublicContext());

    const result = await caller.ghl.connectionStatus({
      locationId: "loc_123",
    });

    expect(result.connected).toBe(true);
    expect(result.locationId).toBe("loc_123");
  });
});

describe("ghl.createContact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a contact and returns result", async () => {
    mockedGetInstallation.mockResolvedValue({
      id: 1,
      locationId: "loc_123",
      companyId: "comp_456",
      accessToken: "token_abc",
      refreshToken: "refresh_xyz",
      expiresAt: Date.now() + 3600000,
      scopes: "contacts.write",
      userId: "user_789",
      workflowId: "wf_001",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    mockedProcessContact.mockResolvedValue({
      contactId: "contact_123",
      enrolledInWorkflow: true,
    });

    const caller = appRouter.createCaller(createPublicContext());

    const result = await caller.ghl.createContact({
      locationId: "loc_123",
      contact: {
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "+1234567890",
        dnd: false,
      },
    });

    expect(result.contactId).toBe("contact_123");
    expect(result.enrolledInWorkflow).toBe(true);
    expect(mockedProcessContact).toHaveBeenCalledWith(
      "loc_123",
      {
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "+1234567890",
        dnd: false,
      }
    );
  });

  it("throws NOT_FOUND when location is not connected", async () => {
    mockedGetInstallation.mockResolvedValue(undefined);
    const caller = appRouter.createCaller(createPublicContext());

    await expect(
      caller.ghl.createContact({
        locationId: "loc_unknown",
        contact: {
          firstName: "Jane",
        },
      })
    ).rejects.toThrow("GHL location not connected");
  });
});

describe("ghl.verifyConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns valid=true when token is valid", async () => {
    mockedGetValidAccessToken.mockResolvedValue("valid_token");
    const caller = appRouter.createCaller(createPublicContext());

    const result = await caller.ghl.verifyConnection({
      locationId: "loc_123",
    });

    expect(result.valid).toBe(true);
  });

  it("returns valid=false when token refresh fails", async () => {
    mockedGetValidAccessToken.mockRejectedValue(
      new Error("Token refresh failed")
    );
    const caller = appRouter.createCaller(createPublicContext());

    const result = await caller.ghl.verifyConnection({
      locationId: "loc_123",
    });

    expect(result.valid).toBe(false);
    expect(result.message).toContain("Token refresh failed");
  });
});

describe("ghl.listInstallations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all installations for admin users", async () => {
    mockedGetAllInstallations.mockResolvedValue([
      {
        id: 1,
        locationId: "loc_1",
        companyId: "comp_1",
        accessToken: "token_1",
        refreshToken: "refresh_1",
        expiresAt: Date.now() + 3600000,
        scopes: "contacts.write",
        userId: "user_1",
        workflowId: "wf_1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const caller = appRouter.createCaller(createAuthContext());
    const result = await caller.ghl.listInstallations();

    expect(result).toHaveLength(1);
    expect(result[0].locationId).toBe("loc_1");
    expect(result[0].connected).toBe(true);
    // Ensure tokens are not exposed
    expect((result[0] as Record<string, unknown>).accessToken).toBeUndefined();
    expect((result[0] as Record<string, unknown>).refreshToken).toBeUndefined();
  });
});
