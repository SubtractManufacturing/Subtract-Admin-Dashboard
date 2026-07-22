import { describe, expect, it } from "vitest";
import {
  getInvoicePresetFields,
  invoicePresetsForEntity,
} from "~/components/orders/InvoicePdfTemplate";
import { formatCurrency } from "~/lib/pdf-utils";

describe("getInvoicePresetFields", () => {
  const ctx = {
    total: 100,
    isOrder: true,
    deliveryDate: null as Date | null,
    customerPaymentTerms: "Net 15",
  };

  it("order_confirmation mirrors unpaid default money/terms with confirmation notes", () => {
    const fields = getInvoicePresetFields("order_confirmation", ctx);

    expect(fields.amountPaidDisplay).toBe(formatCurrency(0));
    expect(fields.amountDueDisplay).toBe(formatCurrency(100));
    expect(fields.paymentTermsDisplay).toBe("Net 15");
    expect(fields.dueDateDisplay).toBe("Net 30");
    expect(fields.notesOverride).toBe(
      "We've received your purchase order and confirm the line items and amounts below. Payment is still due",
    );
  });
});

describe("invoicePresetsForEntity", () => {
  it("includes order_confirmation only for orders", () => {
    expect(invoicePresetsForEntity(true).map((p) => p.id)).toContain(
      "order_confirmation",
    );
    expect(invoicePresetsForEntity(false).map((p) => p.id)).not.toContain(
      "order_confirmation",
    );
  });
});
