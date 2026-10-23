import { describe, expect, it } from "vitest";
import { resolveToAddressFromTemplate } from "./resolve-to-address.server";

describe("resolveToAddressFromTemplate", () => {
  it("resolves a valid email from merge tokens", () => {
    const result = resolveToAddressFromTemplate("{{customerEmail}}", {
      customerEmail: "buyer@example.com",
    });
    expect(result).toEqual({ ok: true, address: "buyer@example.com" });
  });

  it("accepts a bare token key without braces", () => {
    const result = resolveToAddressFromTemplate("customerEmail", {
      customerEmail: "buyer@example.com",
    });
    expect(result).toEqual({ ok: true, address: "buyer@example.com" });
  });

  it("fails when tokens are missing", () => {
    const result = resolveToAddressFromTemplate("{{submissionEmail}}", {});
    expect(result.ok).toBe(false);
  });

  it("fails when resolved value is not an email", () => {
    const result = resolveToAddressFromTemplate("{{customerEmail}}", {
      customerEmail: "not-an-email",
    });
    expect(result.ok).toBe(false);
  });
});
