import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  assertAuthorized,
  authorize,
  type Action,
  type Actor,
} from "./authorize";

const staff = (role: "User" | "Admin" | "Dev"): Actor => ({
  kind: "staff",
  userId: `user-${role}`,
  email: `${role.toLowerCase()}@example.com`,
  name: null,
  role,
});

/** External actors do not exist in the product yet; the fixture exercises the model early. */
const external: Actor = { kind: "external", userId: "ext-1" };

const STAFF_WIDE: Action[] = [
  "app.access",
  "download.attachment",
  "download.part",
  "download.quote-part",
  "download.quote",
  "download.mesh",
];
const ADMIN_ONLY: Action[] = ["export.customers", "export.vendors"];

describe("authorize", () => {
  it("covers every registered action in these tests", () => {
    expect([...STAFF_WIDE, ...ADMIN_ONLY].sort()).toEqual([...ACTIONS].sort());
  });

  it.each(["User", "Admin", "Dev"] as const)(
    "lets %s staff use staff-wide actions",
    (role) => {
      for (const action of STAFF_WIDE) {
        expect(authorize(staff(role), action).allowed, action).toBe(true);
      }
    },
  );

  it("restricts bulk export to Admin and Dev", () => {
    for (const action of ADMIN_ONLY) {
      expect(authorize(staff("User"), action)).toEqual({
        allowed: false,
        reason: "role_not_permitted",
      });
      expect(authorize(staff("Admin"), action).allowed).toBe(true);
      expect(authorize(staff("Dev"), action).allowed).toBe(true);
    }
  });

  it("denies every action to external actors", () => {
    for (const action of ACTIONS) {
      expect(authorize(external, action), action).toEqual({
        allowed: false,
        reason: "not_staff",
      });
    }
  });

  it("denies an action that is not in the registry", () => {
    expect(authorize(staff("Dev"), "billing.nuke" as Action)).toEqual({
      allowed: false,
      reason: "unknown_action",
    });
  });

  it("denies a staff role the policy does not list", () => {
    const rogue = { ...staff("User"), role: "Superuser" } as unknown as Actor;
    expect(authorize(rogue, "app.access").allowed).toBe(false);
  });

  it("denies an unrecognised actor kind", () => {
    const rogue = { kind: "service", userId: "x" } as unknown as Actor;
    expect(authorize(rogue, "app.access")).toEqual({
      allowed: false,
      reason: "not_staff",
    });
  });

  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "denies prototype key %s as an unknown action",
    (key) => {
      expect(authorize(staff("Dev"), key as Action)).toEqual({
        allowed: false,
        reason: "unknown_action",
      });
    },
  );

  it("denies a missing actor", () => {
    expect(authorize(null as unknown as Actor, "app.access")).toEqual({
      allowed: false,
      reason: "not_staff",
    });
  });

  it("denies a resource supplied for an action that targets none", () => {
    expect(
      authorize(staff("Dev"), "export.customers", { type: "part", id: "1" }),
    ).toEqual({ allowed: false, reason: "resource_mismatch" });
    expect(
      authorize(staff("Dev"), "app.access", { type: "quote", id: "1" }),
    ).toEqual({ allowed: false, reason: "resource_mismatch" });
  });

  it("checks the role before the resource", () => {
    expect(
      authorize(staff("User"), "export.customers", { type: "part", id: "1" }),
    ).toEqual({ allowed: false, reason: "role_not_permitted" });
  });

  it("denies a resource of the wrong type for the action", () => {
    expect(
      authorize(staff("Dev"), "download.attachment", { type: "quote", id: "1" }),
    ).toEqual({ allowed: false, reason: "resource_mismatch" });
  });

  it("accepts a resource of the matching type", () => {
    expect(
      authorize(staff("User"), "download.attachment", {
        type: "attachment",
        id: "abc",
      }).allowed,
    ).toBe(true);
  });
});

describe("assertAuthorized", () => {
  it("returns normally when allowed", () => {
    expect(() => assertAuthorized(staff("User"), "app.access")).not.toThrow();
  });

  it("throws a 403 Response when denied", () => {
    let thrown: unknown;
    try {
      assertAuthorized(staff("User"), "export.customers");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });
});
