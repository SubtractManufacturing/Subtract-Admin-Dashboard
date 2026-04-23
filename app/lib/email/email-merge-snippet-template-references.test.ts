import { describe, it, expect } from "vitest";
import type { EmailTemplate } from "~/lib/db/schema";
import {
  textHasExactSnippetPlaceholder,
  templatesReferencingSnippetKey,
} from "./email-merge-snippet-template-references";

function template(partial: {
  subjectTemplate: string;
  bodyCopy: EmailTemplate["bodyCopy"];
}): EmailTemplate {
  return partial as EmailTemplate;
}

describe("textHasExactSnippetPlaceholder", () => {
  it("returns true for an exact token match", () => {
    expect(textHasExactSnippetPlaceholder("Hello {{buttonText}} there", "buttonText")).toBe(
      true,
    );
  });

  it("returns false when the key appears without merge braces", () => {
    expect(textHasExactSnippetPlaceholder("buttonText", "buttonText")).toBe(false);
  });

  it("returns false for a substring or similar token", () => {
    expect(textHasExactSnippetPlaceholder("{{buttonTextExtra}}", "buttonText")).toBe(false);
    expect(textHasExactSnippetPlaceholder("{{buttonText}}", "button")).toBe(false);
  });
});

describe("templatesReferencingSnippetKey", () => {
  it("finds templates that reference the key in subjectTemplate", () => {
    const list = [
      template({ subjectTemplate: "Hi {{ctaLabel}}", bodyCopy: {} }),
      template({ subjectTemplate: "No token", bodyCopy: {} }),
    ];
    expect(templatesReferencingSnippetKey(list, "ctaLabel")).toEqual([list[0]]);
  });

  it("finds templates that reference the key in a top-level bodyCopy string", () => {
    const t = template({
      subjectTemplate: "Subject",
      bodyCopy: { intro: "Click {{ctaLabel}} please" },
    });
    expect(templatesReferencingSnippetKey([t], "ctaLabel")).toEqual([t]);
  });

  it("finds templates when the placeholder is nested in an object value", () => {
    const t = template({
      subjectTemplate: "Subject",
      bodyCopy: {
        block: { label: "{{ctaLabel}}" },
      },
    });
    expect(templatesReferencingSnippetKey([t], "ctaLabel")).toEqual([t]);
  });

  it("returns an empty array when nothing references the key", () => {
    const list = [
      template({ subjectTemplate: "Plain", bodyCopy: { a: "b" } }),
      template({ subjectTemplate: "Other {{foo}}", bodyCopy: {} }),
    ];
    expect(templatesReferencingSnippetKey(list, "ctaLabel")).toEqual([]);
  });

  it("ignores non-string body values and arrays (no deep scan of array elements)", () => {
    const t = template({
      subjectTemplate: "S",
      bodyCopy: { items: ["{{ctaLabel}}"] },
    });
    expect(templatesReferencingSnippetKey([t], "ctaLabel")).toEqual([]);
  });
});
