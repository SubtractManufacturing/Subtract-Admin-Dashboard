import { describe, it, expect } from "vitest";
import { interpolateTemplateString, interpolateSubject, interpolateLayoutCopy } from "./render.server";

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
});
