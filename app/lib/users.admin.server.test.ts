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

const ctx = { userId: "admin", userEmail: "admin@example.com" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.invite.mockResolvedValue({ data: { user: { id: "new-id" } }, error: null });
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
});
