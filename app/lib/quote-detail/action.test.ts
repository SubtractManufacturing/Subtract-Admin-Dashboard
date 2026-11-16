import { describe, expect, it, vi } from "vitest";
import { runQuoteIntent } from "./action";
import { quoteIntents } from "./intents";
import { fakeQuoteDeps, formOf, locationOf, makeQuote, testAuth } from "./test-support";

/** Every intent the original route accepted. Dropping one silently breaks a button. */
const EXPECTED_INTENTS = [
  "addDrawingToExistingPart",
  "addLineItem",
  "archiveLineItem",
  "archiveQuote",
  "convertToOrder",
  "createNote",
  "deleteAttachment",
  "deleteDrawing",
  "deleteNote",
  "duplicateQuote",
  "emailPreview",
  "emailQueue",
  "generateInvoice",
  "generateQuote",
  "getNotes",
  "promoteLineItemToQuotePart",
  "receivePo",
  "regenerateMesh",
  "restoreLineItem",
  "restoreQuote",
  "reviseQuote",
  "savePriceCalculation",
  "sendQuoteReceivedEmail",
  "updateCustomer",
  "updateEstimatedDelivery",
  "updateLineItem",
  "updateNdaRequired",
  "updateNote",
  "updateQuote",
  "updateQuotePartAttributes",
  "updateStatus",
  "updateValidUntil",
  "updateVendor",
  "uploadAttachment",
];

describe("quote intent table", () => {
  it("exposes exactly the intents the UI submits", () => {
    expect(Object.keys(quoteIntents).sort()).toEqual(EXPECTED_INTENTS);
  });
});

describe("runQuoteIntent", () => {
  const base = () => ({
    quote: makeQuote(),
    auth: testAuth,
    deps: fakeQuoteDeps(),
  });

  it("builds the actor from the signed-in user", async () => {
    const input = base();
    await runQuoteIntent({
      ...input,
      formData: formOf({ intent: "updateNdaRequired", ndaRequired: "true" }),
      intent: "updateNdaRequired",
    });
    expect(input.deps.quotes.update).toHaveBeenCalledWith(
      7,
      { ndaRequired: true },
      { userId: "u1", userEmail: "ops@example.com" },
    );
  });

  it("answers unknown or missing intents with 400", async () => {
    for (const intent of ["nope", null]) {
      const res = await runQuoteIntent({ ...base(), formData: formOf({}), intent });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid action" });
    }
  });

  it("lets part-asset admin claim its intent before the table", async () => {
    const input = base();
    const claimed = new Response("claimed", { status: 202 });
    const res = await runQuoteIntent({
      ...input,
      formData: formOf({ intent: "archiveQuote" }),
      intent: "archiveQuote",
      partAssetAdmin: async () => claimed,
    });
    expect(res).toBe(claimed);
    expect(input.deps.quotes.archive).not.toHaveBeenCalled();
  });

  it("falls through to the table when part-asset admin declines", async () => {
    const input = base();
    const res = await runQuoteIntent({
      ...input,
      formData: formOf({ intent: "archiveQuote" }),
      intent: "archiveQuote",
      partAssetAdmin: async () => null,
    });
    expect(locationOf(res)).toBe("/quotes");
  });

  it("turns a part-asset admin failure into a 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await runQuoteIntent({
      ...base(),
      formData: formOf({}),
      intent: "archiveQuote",
      partAssetAdmin: async () => {
        throw new Error("boom");
      },
    });
    expect(res.status).toBe(500);
    spy.mockRestore();
  });

  it("serves notes through the shared note intents", async () => {
    const input = base();
    vi.mocked(input.deps.notes.list).mockResolvedValue([{ id: "n1" }]);
    const res = await runQuoteIntent({
      ...input,
      formData: formOf({}),
      intent: "getNotes",
    });
    expect(input.deps.notes.list).toHaveBeenCalledWith("quote", "7");
    expect(await res.json()).toEqual({ notes: [{ id: "n1" }] });
  });
});
