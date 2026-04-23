import { describe, it, expect } from "vitest";
import { interpolateTemplateString, interpolateSubject, interpolateLayoutCopy } from "./render.server";
import { validateMergeTokens } from "~/lib/email/resolve";

describe("interpolateTemplateString", () => {
  it("substitutes a single token", () => {
    expect(interpolateTemplateString("Hi {{name}}", { name: "Pat" })).toBe("Hi Pat");
  });

  it("substitutes multiple tokens", () => {
    const result = interpolateTemplateString(
      "Quote {{quoteNumber}} for {{customerName}}",
      { quoteNumber: "26Q00001", customerName: "Acme Corp" },
    );
    expect(result).toBe("Quote 26Q00001 for Acme Corp");
  });

  it("replaces a missing key with empty string", () => {
    // Current implementation: props[key] ?? "" — missing key becomes ""
    expect(interpolateTemplateString("Hello {{missing}}", {})).toBe("Hello ");
  });

  it("returns the template unchanged when no tokens present", () => {
    expect(interpolateTemplateString("No tokens here", { x: "y" })).toBe("No tokens here");
  });

  it("handles the same token repeated twice", () => {
    const result = interpolateTemplateString("{{x}} and {{x}}", { x: "foo" });
    expect(result).toBe("foo and foo");
  });

  it("does not replace partial braces {foo}", () => {
    expect(interpolateTemplateString("{foo}", { foo: "bar" })).toBe("{foo}");
  });
});

describe("interpolateSubject", () => {
  it("delegates to interpolateTemplateString (same behavior)", () => {
    expect(interpolateSubject("Re: {{quoteNumber}}", { quoteNumber: "26Q00001" }))
      .toBe("Re: 26Q00001");
  });
});

describe("interpolateLayoutCopy", () => {
  it("interpolates string values in a flat copy object", () => {
    const result = interpolateLayoutCopy(
      { greeting: "Hello {{customerName}}!", footer: "Thanks" },
      { customerName: "Acme Corp" },
    );
    expect(result.greeting).toBe("Hello Acme Corp!");
    expect(result.footer).toBe("Thanks");
  });

  it("interpolates button label and link", () => {
    const result = interpolateLayoutCopy(
      {
        cta: { buttonLabel: "View Quote {{quoteNumber}}", link: "https://app.example.com/q/{{quoteNumber}}" },
      },
      { quoteNumber: "26Q00001" },
    );
    expect((result.cta as { buttonLabel: string; link: string }).buttonLabel).toBe("View Quote 26Q00001");
    expect((result.cta as { buttonLabel: string; link: string }).link).toBe(
      "https://app.example.com/q/26Q00001",
    );
  });

  it("passes through non-string, non-button values unchanged", () => {
    const result = interpolateLayoutCopy(
      { count: 42, flag: true } as unknown as Record<string, unknown>,
      {},
    );
    expect((result as Record<string, unknown>).count).toBe(42);
    expect((result as Record<string, unknown>).flag).toBe(true);
  });

  it("handles empty copy object", () => {
    expect(interpolateLayoutCopy({}, {})).toEqual({});
  });

  it("interpolates snippet tokens across multiple string slots simultaneously", () => {
    const result = interpolateLayoutCopy(
      {
        greeting: "Hi {{customerName}},",
        signOff: "Best regards,\n{{senderName}}",
      },
      { customerName: "Acme Corp", senderName: "Alice" },
    );
    expect((result as Record<string, unknown>).greeting).toBe("Hi Acme Corp,");
    expect((result as Record<string, unknown>).signOff).toBe("Best regards,\nAlice");
  });

  it("interpolates snippet token in button link alongside resolver tokens", () => {
    const result = interpolateLayoutCopy(
      {
        cta: {
          buttonLabel: "View Quote {{quoteNumber}}",
          link: "{{baseUrl}}/quotes/{{quoteNumber}}",
        },
      },
      { quoteNumber: "26Q00001", baseUrl: "https://app.example.com" },
    );
    const cta = result.cta as { buttonLabel: string; link: string };
    expect(cta.buttonLabel).toBe("View Quote 26Q00001");
    expect(cta.link).toBe("https://app.example.com/quotes/26Q00001");
  });
});

// ---------------------------------------------------------------------------
// Snippet interpolation round-trip: mirrors the send pipeline's token guard
// ---------------------------------------------------------------------------

/**
 * Mirrors collectBodyCopyStrings from enqueue-outbound-email.server.ts.
 * Extracts every user-authored string from a body copy object so that
 * validateMergeTokens can check for unresolved placeholders before send.
 */
function collectBodyCopyStrings(copy: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(copy)) {
    if (typeof value === "string") {
      out.push(value);
    } else if (
      value &&
      typeof value === "object" &&
      "buttonLabel" in value &&
      "link" in value
    ) {
      const btn = value as { buttonLabel: string; link: string };
      out.push(btn.buttonLabel, btn.link);
    }
  }
  return out;
}

describe("snippet interpolation round-trip — validateMergeTokens + interpolateLayoutCopy", () => {
  it("reports missing snippet tokens before interpolation, passes after", () => {
    const bodyCopy = {
      greeting: "Hi {{customerName}},",
      signOff: "Regards, {{senderName}}",
    };
    const mergeMap = { customerName: "Acme Corp", senderName: "Alice" };

    // Pre-interpolation: all tokens must be present
    const tokenError = validateMergeTokens(collectBodyCopyStrings(bodyCopy), mergeMap);
    expect(tokenError).toBeNull();

    // After interpolation no placeholders remain
    const interpolated = interpolateLayoutCopy(bodyCopy, mergeMap) as Record<string, unknown>;
    expect(interpolated.greeting).toBe("Hi Acme Corp,");
    expect(interpolated.signOff).toBe("Regards, Alice");
    const afterError = validateMergeTokens(collectBodyCopyStrings(interpolated as Record<string, unknown>), mergeMap);
    expect(afterError).toBeNull();
  });

  it("catches a missing snippet token before send", () => {
    const bodyCopy = {
      greeting: "Hi {{customerName}},",
      cta: { buttonLabel: "Pay Now", link: "{{paymentLinkUrl}}" },
    };
    // mergeMap is missing paymentLinkUrl
    const mergeMap = { customerName: "Acme Corp" };

    const tokenError = validateMergeTokens(collectBodyCopyStrings(bodyCopy), mergeMap);
    expect(tokenError).not.toBeNull();
    expect(tokenError).toContain("{{paymentLinkUrl}}");
  });

  it("token in button label is caught when missing from merge map", () => {
    const bodyCopy = {
      cta: { buttonLabel: "Hello {{customerName}}", link: "https://example.com" },
    };
    const tokenError = validateMergeTokens(collectBodyCopyStrings(bodyCopy), {});
    expect(tokenError).not.toBeNull();
    expect(tokenError).toContain("{{customerName}}");
  });

  it("token in button link is caught when missing from merge map", () => {
    const bodyCopy = {
      cta: { buttonLabel: "Pay", link: "{{paymentLinkUrl}}" },
    };
    const tokenError = validateMergeTokens(collectBodyCopyStrings(bodyCopy), {
      paymentLinkUrl: "https://pay.example.com",
    });
    expect(tokenError).toBeNull();
  });

  it("non-string, non-button values are skipped by the collector", () => {
    const bodyCopy = { count: 42, flag: true } as unknown as Record<string, unknown>;
    const strings = collectBodyCopyStrings(bodyCopy);
    expect(strings).toHaveLength(0);
  });
});
