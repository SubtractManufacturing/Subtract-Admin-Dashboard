import { describe, it, expect } from "vitest";
import {
  bodyCopyFromFormData,
  parseTemplateBodyFromFormData,
} from "./parse-template-body.server";
import { styledQuoteLayoutDefinition } from "~/emails/layouts/styled-quote";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formDataFor(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    fd.append(key, value);
  }
  return fd;
}

/** Build form field names for all slots of the styled-quote layout. */
function validStyledQuoteFormData(): FormData {
  return formDataFor({
    "slot.intro": "Hi {{customerName}},\n\nPlease find **{{quoteNumber}}**.",
    "slot.cta.buttonLabel": "Pay Now",
    "slot.cta.link": "{{paymentLinkUrl}}",
    "slot.wrapUp": "Thanks,\nTeam",
    "slot.footerNotice": "Terms apply.",
  });
}

// ---------------------------------------------------------------------------
// bodyCopyFromFormData
// ---------------------------------------------------------------------------

describe("bodyCopyFromFormData", () => {
  it("reads plainText/markdown slots as strings", () => {
    const fd = formDataFor({ "slot.greeting": "Hello!" });
    const result = bodyCopyFromFormData(fd, { slots: [
      { id: "greeting", type: "plainText", required: false, emptyBehavior: "renderEmpty", adminLabel: "G" },
    ]});
    expect(result.greeting).toBe("Hello!");
  });

  it("reads button slots as { buttonLabel, link } objects", () => {
    const fd = formDataFor({
      "slot.cta.buttonLabel": "Pay Now",
      "slot.cta.link": "https://example.com",
    });
    const result = bodyCopyFromFormData(fd, { slots: [
      { id: "cta", type: "button", required: false, emptyBehavior: "hideBlock", adminLabel: "CTA" },
    ]});
    expect(result.cta).toEqual({ buttonLabel: "Pay Now", link: "https://example.com" });
  });

  it("defaults missing form fields to empty string for text slots", () => {
    const fd = formDataFor({});
    const result = bodyCopyFromFormData(fd, { slots: [
      { id: "greeting", type: "plainText", required: false, emptyBehavior: "renderEmpty", adminLabel: "G" },
    ]});
    expect(result.greeting).toBe("");
  });

  it("defaults missing form fields to empty button for button slots", () => {
    const fd = formDataFor({});
    const result = bodyCopyFromFormData(fd, { slots: [
      { id: "cta", type: "button", required: false, emptyBehavior: "hideBlock", adminLabel: "CTA" },
    ]});
    expect(result.cta).toEqual({ buttonLabel: "", link: "" });
  });

  it("maps all slots of the styled-quote layout", () => {
    const fd = validStyledQuoteFormData();
    const result = bodyCopyFromFormData(fd, styledQuoteLayoutDefinition);
    expect(typeof result.intro).toBe("string");
    expect(result.cta).toEqual({
      buttonLabel: "Pay Now",
      link: "{{paymentLinkUrl}}",
    });
    expect(typeof result.footerNotice).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// parseTemplateBodyFromFormData — valid payload
// ---------------------------------------------------------------------------

describe("parseTemplateBodyFromFormData — valid payload", () => {
  it("returns ok with normalised data for a fully filled styled-quote form", () => {
    const fd = validStyledQuoteFormData();
    const result = parseTemplateBodyFromFormData(fd, "styled-quote");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.intro).toContain("{{customerName}}");
      expect(result.data.cta).toEqual({
        buttonLabel: "Pay Now",
        link: "{{paymentLinkUrl}}",
      });
    }
  });

  it("returns ok when all optional slots are empty", () => {
    const fd = formDataFor({});
    const result = parseTemplateBodyFromFormData(fd, "styled-quote");
    expect(result.ok).toBe(true);
  });

  it("returns ok for the example-kitchen-sink layout with required field filled", () => {
    const fd = formDataFor({
      "slot.requiredReject": "Required headline value",
    });
    const result = parseTemplateBodyFromFormData(fd, "example-kitchen-sink");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.requiredReject).toBe("Required headline value");
    }
  });
});

// ---------------------------------------------------------------------------
// parseTemplateBodyFromFormData — invalid payload
// ---------------------------------------------------------------------------

describe("parseTemplateBodyFromFormData — invalid payload", () => {
  it("returns field-level error when required+reject slot is empty", () => {
    const fd = formDataFor({
      // requiredReject is intentionally omitted (defaults to "")
      "slot.optionalHide": "",
    });
    const result = parseTemplateBodyFromFormData(fd, "example-kitchen-sink");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.slotErrors["requiredReject"]).toBeTruthy();
      expect(result.slotErrors["requiredReject"]).toContain("required");
    }
  });

  it("returns field-level error when button label/link pairing is invalid", () => {
    const fd = formDataFor({
      "slot.requiredReject": "Headline",
      "slot.cta.buttonLabel": "Click me",
      "slot.cta.link": "",           // label filled but link empty → error
    });
    const result = parseTemplateBodyFromFormData(fd, "example-kitchen-sink");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.slotErrors["cta"]).toBeTruthy();
    }
  });

  it("returns an error for a completely unknown layout slug", () => {
    const fd = formDataFor({ "slot.greeting": "Hi" });
    const result = parseTemplateBodyFromFormData(fd, "does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeTruthy();
    }
  });

  it("returns an error for an empty layout slug", () => {
    const fd = formDataFor({});
    const result = parseTemplateBodyFromFormData(fd, "");
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseTemplateBodyFromFormData — layout switch
// ---------------------------------------------------------------------------

describe("parseTemplateBodyFromFormData — layout switch", () => {
  it("fails when form data carries styled-quote slot ids but is parsed against example-kitchen-sink", () => {
    const fd = formDataFor({
      "slot.intro": "Hi",
      "slot.cta.buttonLabel": "Pay",
      "slot.cta.link": "https://example.com",
      "slot.wrapUp": "Bye",
      "slot.footerNotice": "Fine print",
    });
    const result = parseTemplateBodyFromFormData(fd, "example-kitchen-sink");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.slotErrors["requiredReject"]).toBeTruthy();
    }
  });

  it("succeeds when correct slot ids are submitted for the active layout", () => {
    const fd = formDataFor({
      "slot.requiredReject": "Headline",
    });
    const result = parseTemplateBodyFromFormData(fd, "example-kitchen-sink");
    expect(result.ok).toBe(true);
  });
});
