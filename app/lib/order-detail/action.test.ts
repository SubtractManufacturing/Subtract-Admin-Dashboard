import { describe, expect, it, vi } from "vitest";
import { runOrderIntent } from "./action";
import { orderIntents } from "./intents";
import { documentIntents, emailIntents, checkoutAddressIntents } from "./intents/documents-email";
import type { IntentTable } from "~/lib/route-actions/core";
import type { OrderCtx } from "./context";
import { fakeOrderDeps, locationOf, makeOrder, makeOrderCtx, runIntent, testAuth } from "./test-support";

/** Every intent the original route accepted. Dropping one silently breaks a button. */
const EXPECTED_INTENTS = [
  "addDrawingToPart",
  "applyCheckoutAddressImportChoices",
  "archiveLineItem",
  "assignShop",
  "createLineItem",
  "createLineItemWithUpload",
  "createNote",
  "deleteAttachment",
  "deleteDrawingFromPart",
  "deleteNote",
  "downloadAttachment",
  "duplicateOrder",
  "emailPreview",
  "emailQueue",
  "generateInvoice",
  "generatePackingSlip",
  "generatePurchaseOrder",
  "getNotes",
  "importCheckoutAddressesQuick",
  "manageTrackingNumbers",
  "markJobBoardAsSent",
  "postJobBoard",
  "regenerateMesh",
  "restoreLineItem",
  "restoreOrder",
  "shipOrder",
  "updateLineItem",
  "updateLineItemNote",
  "updateNdaRequired",
  "updateNote",
  "updateOrderInfo",
  "updatePartAttributes",
  "updateStatus",
  "updateVendor",
  "uploadAttachment",
];

describe("order intent table", () => {
  it("exposes exactly the intents the UI submits", () => {
    expect(Object.keys(orderIntents).sort()).toEqual(EXPECTED_INTENTS);
  });
});

describe("runOrderIntent", () => {
  const base = () => ({ order: makeOrder(), auth: testAuth, deps: fakeOrderDeps() });
  const form = (fields: Record<string, string> = {}) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };

  it("builds the actor from the signed-in user", async () => {
    const input = base();
    await runOrderIntent({
      ...input,
      formData: form({ ndaRequired: "true" }),
      intent: "updateNdaRequired",
    });
    expect(input.deps.orders.update).toHaveBeenCalledWith(
      12,
      { ndaRequired: true },
      { userId: "u1", userEmail: "ops@example.com" },
    );
  });

  it("answers unknown or missing intents with 400", async () => {
    for (const intent of ["nope", null]) {
      const res = await runOrderIntent({ ...base(), formData: form(), intent });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid intent" });
    }
  });

  it("lets part-asset admin claim its intent before the table", async () => {
    const input = base();
    const claimed = new Response("claimed", { status: 202 });
    const res = await runOrderIntent({
      ...input,
      formData: form(),
      intent: "restoreOrder",
      partAssetAdmin: async () => claimed,
    });
    expect(res).toBe(claimed);
    expect(input.deps.orders.restore).not.toHaveBeenCalled();
  });

  it("falls through to the table when part-asset admin declines", async () => {
    const res = await runOrderIntent({
      ...base(),
      formData: form(),
      intent: "restoreOrder",
      partAssetAdmin: async () => null,
    });
    expect(locationOf(res)).toBe("/orders/26Z00012");
  });

  it("turns a handler failure into a logged 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = base();
    vi.mocked(input.deps.orders.restore).mockRejectedValue(new Error("db"));
    const res = await runOrderIntent({ ...input, formData: form(), intent: "restoreOrder" });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to process request" });
    spy.mockRestore();
  });

  it("serves notes through the shared note intents", async () => {
    const input = base();
    vi.mocked(input.deps.notes.list).mockResolvedValue([{ id: "n1" }]);
    const res = await runOrderIntent({ ...input, formData: form(), intent: "getNotes" });
    expect(input.deps.notes.list).toHaveBeenCalledWith("order", "12");
    expect(await res.json()).toEqual({ notes: [{ id: "n1" }] });
  });
});

const runIn =
  (table: object) =>
  (ctx: OrderCtx, intent: string, fields: Record<string, string | Blob> = {}) =>
    runIntent(table as IntentTable<OrderCtx>, ctx, intent, fields);

describe("order documents", () => {
  const runDoc = runIn(documentIntents);

  it.each([
    ["generatePurchaseOrder", {}, "PO-26Z00012.pdf", "purchase_order"],
    ["generatePackingSlip", {}, "PackingSlip-26Z00012.pdf", "packing_slip"],
    ["generateInvoice", {}, "Invoice-26Z00012.pdf", "invoice"],
    ["generateInvoice", { presetId: "order_confirmation" }, "Order-Confirmation-26Z00012.pdf", "order_confirmation"],
  ])("%s %j names the file and kind", async (intent, extra, filename, documentKind) => {
    const ctx = makeOrderCtx();
    const res = await runDoc(ctx, intent, { htmlContent: "<p>x</p>", ...extra });
    expect(ctx.deps.documents.generateDocumentPdf).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "order", entityId: 12, filename, documentKind }),
    );
    expect(await res.json()).toMatchObject({ success: true, filename });
  });

  it("requires HTML", async () => {
    expect((await runDoc(makeOrderCtx(), "generatePackingSlip")).status).toBe(400);
  });
});

describe("order confirmation email", () => {
  it("is scoped to this order's confirmation context", async () => {
    const run = runIn(emailIntents);
    const ctx = makeOrderCtx();
    await run(ctx, "emailPreview");
    expect(ctx.deps.email.preview).toHaveBeenCalledWith(
      expect.objectContaining({ expected: { contextKey: "order_confirmation", entityId: "12" } }),
    );
    await run(ctx, "emailQueue");
    expect(ctx.deps.email.queue).toHaveBeenCalledWith(
      expect.objectContaining({
        expected: { contextKey: "order_confirmation", entityType: "order", entityId: "12" },
      }),
    );
  });
});

describe("checkout address import", () => {
  const run = runIn(checkoutAddressIntents);

  it("quick import passes the order's quote and customer", async () => {
    const ctx = makeOrderCtx({ order: { sourceQuoteId: 7 } });
    const res = await run(ctx, "importCheckoutAddressesQuick");
    expect(ctx.deps.checkoutAddresses.importQuick).toHaveBeenCalledWith({
      orderId: 12,
      sourceQuoteId: 7,
      customerId: 3,
      actor: ctx.actor,
    });
    expect(await res.json()).toEqual({ status: "imported" });
  });

  it("apply passes only recognised choices", async () => {
    const ctx = makeOrderCtx();
    await run(ctx, "applyCheckoutAddressImportChoices", {
      billingChoice: "checkout",
      shippingChoice: "on_file",
      phoneChoice: "bogus",
    });
    expect(ctx.deps.checkoutAddresses.applyChoices).toHaveBeenCalledWith(
      expect.objectContaining({
        billingChoice: "checkout",
        shippingChoice: "on_file",
        phoneChoice: undefined,
        sourceQuoteId: null,
      }),
    );
  });

  it("apply reports a refused import as 400 with the reason", async () => {
    const ctx = makeOrderCtx();
    vi.mocked(ctx.deps.checkoutAddresses.applyChoices).mockResolvedValue({
      ok: false,
      message: "No checkout session",
      reason: "no_session",
    });
    const res = await run(ctx, "applyCheckoutAddressImportChoices");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No checkout session", reason: "no_session" });
  });

  it("apply reports success", async () => {
    const res = await run(makeOrderCtx(), "applyCheckoutAddressImportChoices");
    expect(await res.json()).toEqual({ success: true, updated: ["billing"] });
  });
});
