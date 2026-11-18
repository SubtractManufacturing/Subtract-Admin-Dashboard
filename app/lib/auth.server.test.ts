import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  syncStaffUser: vi.fn(),
}));

vi.mock("./supabase.server", () => ({
  createServerClient: () => ({
    supabase: { auth: { getUser: mocks.getUser, signOut: mocks.signOut } },
    headers: new Headers({ "x-test": "1" }),
  }),
}));
vi.mock("./users", () => ({ syncStaffUser: mocks.syncStaffUser }));

import { getOptionalAuth, requireStaff } from "./auth.server";

const request = new Request("http://localhost/quotes?tab=open");
const supabaseUser = {
  id: "u1",
  email: "a@example.com",
  user_metadata: { name: "Ada" },
  created_at: "2026-01-01T00:00:00Z",
};

async function thrownBy(fn: () => Promise<unknown>): Promise<Response> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
  throw new Error("expected a thrown Response");
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signOut.mockResolvedValue({});
});

describe("requireStaff", () => {
  it("redirects to login, preserving the target, when there is no session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const response = await thrownBy(() => requireStaff(request));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `/login?next=${encodeURIComponent("/quotes?tab=open")}`,
    );
    expect(mocks.syncStaffUser).not.toHaveBeenCalled();
    expect(response.headers.get("x-test")).toBe("1");
  });

  it("signs out and refuses a Supabase user with no staff record", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: supabaseUser } });
    mocks.syncStaffUser.mockResolvedValue(null);
    const response = await thrownBy(() => requireStaff(request));
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/login\?error=/);
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("x-test")).toBe("1");
  });

  it("signs out and refuses a disabled user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: supabaseUser } });
    mocks.syncStaffUser.mockResolvedValue({
      role: "Admin",
      status: "disabled",
      isArchived: false,
    });
    const response = await thrownBy(() => requireStaff(request));
    expect(decodeURIComponent(response.headers.get("Location")!)).toContain(
      "Account disabled",
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(response.headers.get("x-test")).toBe("1");
  });

  it("refuses an archived user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: supabaseUser } });
    mocks.syncStaffUser.mockResolvedValue({
      role: "Admin",
      status: "active",
      isArchived: true,
    });
    const response = await thrownBy(() => requireStaff(request));
    expect(response.status).toBe(302);
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("returns the staff actor and legacy userDetails for an active user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: supabaseUser } });
    mocks.syncStaffUser.mockResolvedValue({
      role: "Dev",
      status: "active",
      isArchived: false,
    });
    const result = await requireStaff(request);
    expect(result.actor).toEqual({
      kind: "staff",
      userId: "u1",
      email: "a@example.com",
      name: "Ada",
      role: "Dev",
    });
    expect(result.userDetails).toMatchObject({ id: "u1", role: "Dev", name: "Ada" });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});

describe("getOptionalAuth", () => {
  it("signs out and returns no user for a disabled user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: supabaseUser } });
    mocks.syncStaffUser.mockResolvedValue({
      role: "User",
      status: "disabled",
      isArchived: false,
    });
    const result = await getOptionalAuth(request);
    expect(result.user).toBeNull();
    expect(mocks.signOut).toHaveBeenCalledOnce();
  });

  it("returns no user for an unprovisioned Supabase user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: supabaseUser } });
    mocks.syncStaffUser.mockResolvedValue(null);
    const result = await getOptionalAuth(request);
    expect(result.user).toBeNull();
    expect(result.userDetails).toBeNull();
  });

  it("returns the user for active staff", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: supabaseUser } });
    mocks.syncStaffUser.mockResolvedValue({
      role: "User",
      status: "active",
      isArchived: false,
    });
    const result = await getOptionalAuth(request);
    expect(result.userDetails?.role).toBe("User");
  });
});
