import { describe, it, expect } from "vitest";
import {
  validateHttpUrl,
  validateButtonLinkPolicy,
  validateButtonValue,
  parseAndValidateBodyCopyForDefinition,
  validateInterpolatedButtonLinksInCopy,
  type EmailLayoutDefinition,
} from "./layout-definition";
import {
  getDefaultBodyCopyForLayout,
  parseBodyCopyForLayout,
  runtimeEmailLayoutRegistry,
} from "./registry";

// ---------------------------------------------------------------------------
// Minimal definition fixtures
// ---------------------------------------------------------------------------

const plainTextDef: EmailLayoutDefinition = {
  slots: [
    {
      id: "greeting",
      type: "plainText",
      required: false,
      emptyBehavior: "renderEmpty",
      adminLabel: "Greeting",
    },
  ],
};

const requiredRejectDef: EmailLayoutDefinition = {
  slots: [
    {
      id: "headline",
      type: "plainText",
      required: true,
      emptyBehavior: "reject",
      adminLabel: "Headline",
    },
  ],
};

const markdownDef: EmailLayoutDefinition = {
  slots: [
    {
      id: "body",
      type: "markdown",
      required: true,
      emptyBehavior: "reject",
      adminLabel: "Body",
    },
  ],
};

const buttonDef: EmailLayoutDefinition = {
  slots: [
    {
      id: "cta",
      type: "button",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "CTA",
    },
  ],
};

const requiredButtonDef: EmailLayoutDefinition = {
  slots: [
    {
      id: "cta",
      type: "button",
      required: true,
      emptyBehavior: "reject",
      adminLabel: "CTA",
    },
  ],
};

const mixedDef: EmailLayoutDefinition = {
  slots: [
    {
      id: "title",
      type: "plainText",
      required: true,
      emptyBehavior: "reject",
      adminLabel: "Title",
    },
    {
      id: "cta",
      type: "button",
      required: false,
      emptyBehavior: "hideBlock",
      adminLabel: "CTA",
    },
  ],
};

// ---------------------------------------------------------------------------
// validateHttpUrl
// ---------------------------------------------------------------------------

describe("validateHttpUrl", () => {
  it("returns true for an http URL", () => {
    expect(validateHttpUrl("http://example.com")).toBe(true);
  });

  it("returns true for an https URL", () => {
    expect(validateHttpUrl("https://example.com/path?q=1")).toBe(true);
  });

  it("returns false for an empty string", () => {
    expect(validateHttpUrl("")).toBe(false);
  });

  it("returns false for a whitespace-only string", () => {
    expect(validateHttpUrl("   ")).toBe(false);
  });

  it("returns false for a javascript: scheme", () => {
    expect(validateHttpUrl("javascript:alert(1)")).toBe(false);
  });

  it("returns false for a mailto: scheme", () => {
    expect(validateHttpUrl("mailto:user@example.com")).toBe(false);
  });

  it("returns false for a plain string that is not a URL", () => {
    expect(validateHttpUrl("not-a-url")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateButtonLinkPolicy
// ---------------------------------------------------------------------------

describe("validateButtonLinkPolicy", () => {
  it("returns null for empty string (allowed — hides block)", () => {
    expect(validateButtonLinkPolicy("")).toBeNull();
  });

  it("returns null for a valid https URL", () => {
    expect(validateButtonLinkPolicy("https://app.example.com")).toBeNull();
  });

  it("returns null for a valid http URL", () => {
    expect(validateButtonLinkPolicy("http://app.example.com")).toBeNull();
  });

  it("returns null for a merge placeholder (pre-interpolation pass-through)", () => {
    expect(validateButtonLinkPolicy("{{paymentLinkUrl}}")).toBeNull();
  });

  it("returns null for a URL that contains a merge placeholder", () => {
    expect(validateButtonLinkPolicy("https://example.com/q/{{quoteNumber}}")).toBeNull();
  });

  it("returns an error for a non-http(s) URL", () => {
    const result = validateButtonLinkPolicy("ftp://example.com");
    expect(result).not.toBeNull();
    expect(result).toContain("http");
  });

  it("returns an error for a bare non-URL string", () => {
    const result = validateButtonLinkPolicy("just some text");
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateButtonValue
// ---------------------------------------------------------------------------

describe("validateButtonValue", () => {
  it("returns ok for both label and link filled with valid https URL", () => {
    const result = validateButtonValue({ buttonLabel: "Click", link: "https://x.com" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.buttonLabel).toBe("Click");
      expect(result.value.link).toBe("https://x.com");
    }
  });

  it("returns ok for both empty (hides block)", () => {
    const result = validateButtonValue({ buttonLabel: "", link: "" });
    expect(result.ok).toBe(true);
  });

  it("returns error for label filled but link empty", () => {
    const result = validateButtonValue({ buttonLabel: "Click", link: "" });
    expect(result.ok).toBe(false);
  });

  it("returns error for link filled but label empty", () => {
    const result = validateButtonValue({ buttonLabel: "", link: "https://x.com" });
    expect(result.ok).toBe(false);
  });

  it("returns error for non-http(s) link", () => {
    const result = validateButtonValue({ buttonLabel: "Click", link: "ftp://x.com" });
    expect(result.ok).toBe(false);
  });

  it("returns ok when link is a merge placeholder", () => {
    const result = validateButtonValue({ buttonLabel: "Pay", link: "{{paymentLinkUrl}}" });
    expect(result.ok).toBe(true);
  });

  it("returns error when value is not an object", () => {
    const result = validateButtonValue(42);
    expect(result.ok).toBe(false);
  });

  it("returns error when buttonLabel or link are not strings", () => {
    const result = validateButtonValue({ buttonLabel: 1, link: "https://x.com" });
    expect(result.ok).toBe(false);
  });

  describe("allowLegacyString", () => {
    it("returns ok for empty legacy string with no defaultLink", () => {
      const result = validateButtonValue("", { allowLegacyString: true });
      expect(result.ok).toBe(true);
    });

    it("returns ok for legacy string label with matching defaultLink", () => {
      const result = validateButtonValue("Click", {
        allowLegacyString: true,
        defaultLink: "https://example.com",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.buttonLabel).toBe("Click");
        expect(result.value.link).toBe("https://example.com");
      }
    });

    it("returns error for legacy string label with no defaultLink", () => {
      const result = validateButtonValue("Click", { allowLegacyString: true });
      expect(result.ok).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateBodyCopyForDefinition — input guard
// ---------------------------------------------------------------------------

describe("parseAndValidateBodyCopyForDefinition — input validation", () => {
  it("returns error for null", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors._root).toBeTruthy();
  });

  it("returns error for undefined", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, undefined);
    expect(result.ok).toBe(false);
  });

  it("returns error for a string input", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, "greeting");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors._root).toBeTruthy();
  });

  it("returns error for an array input", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors._root).toBeTruthy();
  });

  it("returns error for unknown slot keys in the payload", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, {
      greeting: "Hi",
      unknownField: "oops",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors["unknownField"]).toContain("Unknown slot");
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateBodyCopyForDefinition — plainText slots
// ---------------------------------------------------------------------------

describe("parseAndValidateBodyCopyForDefinition — plainText slots", () => {
  it("accepts a valid string value", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, { greeting: "Hello!" });
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as Record<string, unknown>).greeting).toBe("Hello!");
  });

  it("returns empty string for a missing optional slot (renderEmpty)", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value as Record<string, unknown>).greeting).toBe("");
  });

  it("returns error for a non-string value (number)", () => {
    const result = parseAndValidateBodyCopyForDefinition(plainTextDef, { greeting: 42 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.greeting).toContain("string");
  });

  it("returns error for required+reject slot when value is empty string", () => {
    const result = parseAndValidateBodyCopyForDefinition(requiredRejectDef, { headline: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.headline).toContain("required");
  });

  it("returns error for required+reject slot when value is whitespace only", () => {
    const result = parseAndValidateBodyCopyForDefinition(requiredRejectDef, { headline: "  " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.headline).toContain("required");
  });

  it("returns error for required+reject slot when key is absent", () => {
    const result = parseAndValidateBodyCopyForDefinition(requiredRejectDef, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.headline).toContain("required");
  });

  it("accepts a non-empty value for required+reject slot", () => {
    const result = parseAndValidateBodyCopyForDefinition(requiredRejectDef, {
      headline: "Hello world",
    });
    expect(result.ok).toBe(true);
  });

  it("accepts empty string for required slot with hideBlock emptyBehavior", () => {
    const def: EmailLayoutDefinition = {
      slots: [
        {
          id: "note",
          type: "plainText",
          required: true,
          emptyBehavior: "hideBlock",
          adminLabel: "Note",
        },
      ],
    };
    const result = parseAndValidateBodyCopyForDefinition(def, { note: "" });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateBodyCopyForDefinition — markdown slots
// ---------------------------------------------------------------------------

describe("parseAndValidateBodyCopyForDefinition — markdown slots", () => {
  it("accepts a valid markdown string", () => {
    const result = parseAndValidateBodyCopyForDefinition(markdownDef, { body: "## Hello" });
    expect(result.ok).toBe(true);
  });

  it("returns error for required+reject markdown slot when empty", () => {
    const result = parseAndValidateBodyCopyForDefinition(markdownDef, { body: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.body).toContain("required");
  });

  it("returns error for non-string markdown value", () => {
    const result = parseAndValidateBodyCopyForDefinition(markdownDef, { body: { text: "oops" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.body).toContain("string");
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateBodyCopyForDefinition — button slots
// ---------------------------------------------------------------------------

describe("parseAndValidateBodyCopyForDefinition — button slots", () => {
  it("accepts a valid button with https link", () => {
    const result = parseAndValidateBodyCopyForDefinition(buttonDef, {
      cta: { buttonLabel: "View", link: "https://app.example.com" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts an empty button for optional+hideBlock slot", () => {
    const result = parseAndValidateBodyCopyForDefinition(buttonDef, {
      cta: { buttonLabel: "", link: "" },
    });
    expect(result.ok).toBe(true);
  });

  it("accepts a missing button key for optional slot (defaults to empty)", () => {
    const result = parseAndValidateBodyCopyForDefinition(buttonDef, {});
    expect(result.ok).toBe(true);
  });

  it("returns error for button with label but no link", () => {
    const result = parseAndValidateBodyCopyForDefinition(buttonDef, {
      cta: { buttonLabel: "Click", link: "" },
    });
    expect(result.ok).toBe(false);
  });

  it("returns error for button with link but no label", () => {
    const result = parseAndValidateBodyCopyForDefinition(buttonDef, {
      cta: { buttonLabel: "", link: "https://x.com" },
    });
    expect(result.ok).toBe(false);
  });

  it("returns error for button with a non-http(s) link", () => {
    const result = parseAndValidateBodyCopyForDefinition(buttonDef, {
      cta: { buttonLabel: "Go", link: "ftp://example.com" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.cta).toContain("http");
  });

  it("accepts a button with a merge placeholder in the link (pre-interpolation)", () => {
    const result = parseAndValidateBodyCopyForDefinition(buttonDef, {
      cta: { buttonLabel: "Pay Now", link: "{{paymentLinkUrl}}" },
    });
    expect(result.ok).toBe(true);
  });

  it("returns error for required+reject button when both are empty", () => {
    const result = parseAndValidateBodyCopyForDefinition(requiredButtonDef, {
      cta: { buttonLabel: "", link: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.cta).toContain("required");
  });

  it("accepts required+reject button when both label and link are filled", () => {
    const result = parseAndValidateBodyCopyForDefinition(requiredButtonDef, {
      cta: { buttonLabel: "Go", link: "https://app.example.com" },
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseAndValidateBodyCopyForDefinition — multiple slots
// ---------------------------------------------------------------------------

describe("parseAndValidateBodyCopyForDefinition — multiple slots", () => {
  it("collects errors across multiple invalid fields", () => {
    const result = parseAndValidateBodyCopyForDefinition(mixedDef, {
      title: "",
      cta: { buttonLabel: "Click", link: "" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.title).toBeTruthy();
      expect(result.errors.cta).toBeTruthy();
    }
  });

  it("returns ok when all slots are valid", () => {
    const result = parseAndValidateBodyCopyForDefinition(mixedDef, {
      title: "Hello",
      cta: { buttonLabel: "Click", link: "https://example.com" },
    });
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validateInterpolatedButtonLinksInCopy
// ---------------------------------------------------------------------------

describe("validateInterpolatedButtonLinksInCopy", () => {
  it("returns null when there are no button slots", () => {
    const result = validateInterpolatedButtonLinksInCopy(plainTextDef, {
      greeting: "Hi",
    });
    expect(result).toBeNull();
  });

  it("returns null when the button link is empty (block hidden)", () => {
    const result = validateInterpolatedButtonLinksInCopy(buttonDef, {
      cta: { buttonLabel: "", link: "" },
    });
    expect(result).toBeNull();
  });

  it("returns null when the button slot value is null/non-object (skipped)", () => {
    const result = validateInterpolatedButtonLinksInCopy(buttonDef, { cta: null });
    expect(result).toBeNull();
  });

  it("returns an error when the link still contains an unresolved {{token}}", () => {
    const result = validateInterpolatedButtonLinksInCopy(buttonDef, {
      cta: { buttonLabel: "Pay", link: "{{paymentLinkUrl}}" },
    });
    expect(result).not.toBeNull();
    expect(result).toContain("cta");
    expect(result).toContain("Unresolved placeholder");
  });

  it("returns an error for a non-http(s) link after interpolation", () => {
    const result = validateInterpolatedButtonLinksInCopy(buttonDef, {
      cta: { buttonLabel: "Go", link: "ftp://example.com" },
    });
    expect(result).not.toBeNull();
    expect(result).toContain("http");
    expect(result).toContain("cta");
  });

  it("returns null for a valid https link after interpolation", () => {
    const result = validateInterpolatedButtonLinksInCopy(buttonDef, {
      cta: { buttonLabel: "View", link: "https://app.example.com/quotes/123" },
    });
    expect(result).toBeNull();
  });

  it("returns null for a valid http link after interpolation", () => {
    const result = validateInterpolatedButtonLinksInCopy(buttonDef, {
      cta: { buttonLabel: "View", link: "http://app.example.com" },
    });
    expect(result).toBeNull();
  });

  it("returns an error naming the first failing button slot", () => {
    const def: EmailLayoutDefinition = {
      slots: [
        { id: "btn1", type: "button", required: false, emptyBehavior: "hideBlock", adminLabel: "B1" },
        { id: "btn2", type: "button", required: false, emptyBehavior: "hideBlock", adminLabel: "B2" },
      ],
    };
    const result = validateInterpolatedButtonLinksInCopy(def, {
      btn1: { buttonLabel: "A", link: "{{unresolvedToken}}" },
      btn2: { buttonLabel: "B", link: "https://ok.example.com" },
    });
    expect(result).not.toBeNull();
    expect(result).toContain("btn1");
  });
});

// ---------------------------------------------------------------------------
// Parameterized: registered layouts — defaults always parse cleanly
// ---------------------------------------------------------------------------

describe("registered email layouts — default body copy parses successfully", () => {
  const slugs = Object.keys(runtimeEmailLayoutRegistry) as Array<
    keyof typeof runtimeEmailLayoutRegistry
  >;

  for (const slug of slugs) {
    it(`parseBodyCopyForLayout("${slug}", defaults) is ok`, () => {
      const defaults = getDefaultBodyCopyForLayout(slug);
      const result = parseBodyCopyForLayout(slug, defaults);
      expect(result.ok).toBe(true);
    });
  }
});
