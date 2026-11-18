import { describe, expect, it, vi } from "vitest";
import { resolveStaffActor, type StaffRecord } from "./staff-gate";

const authUser = { id: "u1", email: "a@example.com", name: "Ada" };

const record = (over: Partial<StaffRecord> = {}): StaffRecord => ({
  role: "User",
  status: "active",
  isArchived: false,
  ...over,
});

describe("resolveStaffActor", () => {
  it("returns a staff actor for a provisioned, active user", async () => {
    const syncStaffUser = vi.fn().mockResolvedValue(record({ role: "Admin" }));
    const result = await resolveStaffActor(authUser, { syncStaffUser });
    expect(result).toEqual({
      ok: true,
      actor: {
        kind: "staff",
        userId: "u1",
        email: "a@example.com",
        name: "Ada",
        role: "Admin",
      },
    });
    expect(syncStaffUser).toHaveBeenCalledWith("u1", "a@example.com", "Ada");
  });

  it("does not treat an unknown Supabase user as staff", async () => {
    const syncStaffUser = vi.fn().mockResolvedValue(null);
    expect(await resolveStaffActor(authUser, { syncStaffUser })).toEqual({
      ok: false,
      reason: "not_provisioned",
    });
  });

  it("rejects disabled users", async () => {
    const syncStaffUser = vi
      .fn()
      .mockResolvedValue(record({ status: "disabled" }));
    expect(await resolveStaffActor(authUser, { syncStaffUser })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("rejects archived users even when their status is active", async () => {
    const syncStaffUser = vi.fn().mockResolvedValue(record({ isArchived: true }));
    expect(await resolveStaffActor(authUser, { syncStaffUser })).toEqual({
      ok: false,
      reason: "archived",
    });
  });

  it("rejects users still pending after sync (invite not activated)", async () => {
    const syncStaffUser = vi
      .fn()
      .mockResolvedValue(record({ status: "pending" }));
    expect(await resolveStaffActor(authUser, { syncStaffUser })).toEqual({
      ok: false,
      reason: "not_provisioned",
    });
  });

  it("rejects a role outside the staff roles", async () => {
    const syncStaffUser = vi
      .fn()
      .mockResolvedValue(record({ role: "Customer" as never }));
    expect(await resolveStaffActor(authUser, { syncStaffUser })).toEqual({
      ok: false,
      reason: "not_provisioned",
    });
  });

  it("normalises a missing email to an empty string and name to null", async () => {
    const syncStaffUser = vi.fn().mockResolvedValue(record());
    const result = await resolveStaffActor(
      { id: "u2", email: null, name: undefined },
      { syncStaffUser },
    );
    expect(syncStaffUser).toHaveBeenCalledWith("u2", "", null);
    expect(result.ok && result.actor.email).toBe("");
  });
});
