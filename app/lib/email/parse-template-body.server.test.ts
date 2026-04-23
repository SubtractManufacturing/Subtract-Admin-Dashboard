import { describe, it, expect } from "vitest";
import {
  bodyCopyFromFormData,
  parseTemplateBodyFromFormData,
} from "./parse-template-body.server";
import {
  quoteSendLayoutDefinition,
} from "~/emails/layouts/quote-send";

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

/** Build form field names for all slots of a layout definition. */
function validQuoteSendFormData(): FormData {
  return formDataFor({
    "slot.greeting": "Hi {{customerName}},",
    "slot.intro": "Please find your quote **{{quoteNumber}}** attached.",
    "slot.totalLabel": "Total:",
    "slot.payNowButton.buttonLabel": "Pay Now",
    "slot.payNowButton.link": "{{paymentLinkUrl}}",
    "slot.signOff": "Best regards,\nSubtract Manufacturing",
    "slot.signature": "{{default_signature}}",
    "slot.footer": "You received this email because you submitted an RFQ.",
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

  it("maps all slots of the quote-send layout", () => {
    const fd = validQuoteSendFormData();
    const result = bodyCopyFromFormData(fd, quoteSendLayoutDefinition);
    expect(typeof result.greeting).toBe("string");
    expect(typeof result.intro).toBe("string");
    expect(result.payNowButton).toEqual({
      buttonLabel: "Pay Now",
      link: "{{paymentLinkUrl}}",
    });
    expect(typeof result.footer).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// parseTemplateBodyFromFormData — valid payload
// ---------------------------------------------------------------------------

describe("parseTemplateBodyFromFormData — valid payload", () => {
  it("returns ok with normalised data for a fully filled quote-send form", () => {
    const fd = validQuoteSendFormData();
    const result = parseTemplateBodyFromFormData(fd, "quote-send");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.greeting).toBe("Hi {{customerName}},");
      expect(result.data.payNowButton).toEqual({
        buttonLabel: "Pay Now",
        link: "{{paymentLinkUrl}}",
      });
    }
  });

  it("returns ok when all optional slots are empty", () => {
    // All slots in quote-send are optional, so an all-empty form is valid
    const fd = formDataFor({});
    const result = parseTemplateBodyFromFormData(fd, "quote-send");
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
  it("fails when form data carries quote-send slot ids but is parsed against example-kitchen-sink", () => {
    // Build form data whose keys are valid for quote-send but not example-kitchen-sink
    const fd = formDataFor({
      "slot.greeting": "Hi",
      "slot.intro": "Body text",
      "slot.totalLabel": "Total:",
      "slot.payNowButton.buttonLabel": "Pay",
      "slot.payNowButton.link": "https://example.com",
      "slot.signOff": "Regards",
      "slot.signature": "Team",
      "slot.footer": "Footer",
      // example-kitchen-sink requires 'requiredReject' — not present here
    });
    const result = parseTemplateBodyFromFormData(fd, "example-kitchen-sink");
    // The required 'requiredReject' field is missing → should fail
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
