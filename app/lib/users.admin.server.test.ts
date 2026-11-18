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
    expect(mocks.onConflictDoNothing).toHaveBeenCalledOnce();
    expect(mocks.createEvent).toHaveBeenCalledOnce();
  });

  it("retries the pending-row insert once before failing", async () => {
    mocks.onConflictDoNothing
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce(undefined);
    await inviteUser("n@example.com", "http://x", ctx);
    expect(mocks.onConflictDoNothing).toHaveBeenCalledTimes(2);
    expect(mocks.createEvent).toHaveBeenCalledOnce();
  });

  it("never deletes the auth user when the row cannot be saved", async () => {
    // A re-invite returns an existing auth id, so creation cannot be proven.
    // Re-inviting is idempotent and repairs the missing row.
    for (const timing of [
      { created_at: "2026-11-18T10:00:00.000Z", invited_at: "2026-11-18T10:00:00.200Z" },
      { created_at: "2026-10-01T10:00:00.000Z", invited_at: "2026-11-18T10:00:00.000Z" },
      { created_at: "2026-11-18T10:00:00.000Z" },
    ]) {
      mocks.invite.mockResolvedValue({ data: { user: { id: "x", ...timing } }, error: null });
      mocks.onConflictDoNothing.mockRejectedValue(new Error("db down"));
      await expect(inviteUser("n@example.com", "http://x", ctx)).rejects.toThrow(
        /invite the user again/i,
      );
    }
    expect(mocks.deleteAuthUser).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });
});
