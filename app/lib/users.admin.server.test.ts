import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invite: vi.fn(),
  deleteAuthUser: vi.fn(),
  onConflictDoNothing: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock("./db", () => ({
  db: {
    insert: () => ({ values: () => ({ onConflictDoNothing: mocks.onConflictDoNothing }) }),
  },
}));
vi.mock("./events", () => ({ createEvent: mocks.createEvent }));
vi.mock("./users", () => ({ getUserById: vi.fn() }));
vi.mock("./supabase.admin.server", () => ({
  createAdminClient: () => ({
    auth: {
      admin: { inviteUserByEmail: mocks.invite, deleteUser: mocks.deleteAuthUser },
    },
  }),
}));

import { inviteUser } from "./users.admin.server";

const freshUser = {
  id: "new-id",
  created_at: "2026-11-18T10:00:00.000Z",
  invited_at: "2026-11-18T10:00:00.200Z",
};

const ctx = { userId: "admin", userEmail: "admin@example.com" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.invite.mockResolvedValue({ data: { user: freshUser }, error: null });
  mocks.deleteAuthUser.mockResolvedValue({ error: null });
});

describe("inviteUser", () => {
  it("records the pending staff row after sending the invite", async () => {
    mocks.onConflictDoNothing.mockResolvedValue(undefined);
    await inviteUser("n@example.com", "http://x", ctx);
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
    expect(mocks.createEvent).toHaveBeenCalledOnce();
  });

  it("removes the auth user when the pending row cannot be saved", async () => {
    mocks.onConflictDoNothing.mockRejectedValue(new Error("db down"));
    await expect(inviteUser("n@example.com", "http://x", ctx)).rejects.toThrow();
    expect(mocks.deleteAuthUser).toHaveBeenCalledWith("new-id");
  });

  it("keeps an existing auth user that a re-invite returned", async () => {
    mocks.invite.mockResolvedValue({
      data: {
        user: {
          id: "old-id",
          created_at: "2026-10-01T10:00:00.000Z",
          invited_at: "2026-11-18T10:00:00.000Z",
        },
      },
      error: null,
    });
    mocks.onConflictDoNothing.mockRejectedValue(new Error("db down"));
    await expect(inviteUser("n@example.com", "http://x", ctx)).rejects.toThrow();
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
  });

  it("does not roll back when it cannot tell the user was just created", async () => {
    mocks.invite.mockResolvedValue({
      data: { user: { id: "x", created_at: "2026-11-18T10:00:00.000Z" } },
      error: null,
    });
    mocks.onConflictDoNothing.mockRejectedValue(new Error("db down"));
    await expect(inviteUser("n@example.com", "http://x", ctx)).rejects.toThrow();
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
  });
});
