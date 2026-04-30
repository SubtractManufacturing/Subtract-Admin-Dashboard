import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "~/lib/db";
import { quotes } from "~/lib/db/schema";
import type { Customer } from "~/lib/db/schema";
import {
  extractBillingAddress,
  extractShippingAddress,
  formatAddress,
  isAddressEmpty,
  isAddressMeaningfullyEmpty,
  type Address,
} from "~/lib/address-utils";
import {
  getCustomer,
  updateCustomer,
  type CustomerEventContext,
  type CustomerInput,
} from "~/lib/customers";
import { getStripeClient } from "~/lib/stripe.server";
import { isStripePaymentLinksEnabled } from "~/lib/featureFlags";
import type { CheckoutAddressConflictPreview } from "~/lib/stripe/checkout-address-conflict.types";

/** Domain-stable snapshot (no Stripe types exported to callers). */
export type CheckoutAddressFields = {
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
};

export type CheckoutAddressSnapshot = {
  billing: CheckoutAddressFields | null;
  shipping: CheckoutAddressFields | null;
  phone: string | null;
};

function normToken(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function addressesEqual(a: Address, b: Address): boolean {
  return (
    normToken(a.line1) === normToken(b.line1) &&
    normToken(a.line2) === normToken(b.line2) &&
    normToken(a.city) === normToken(b.city) &&
    normToken(a.state) === normToken(b.state) &&
    normToken(a.postalCode) === normToken(b.postalCode) &&
    normToken(a.country || "US") === normToken(b.country || "US")
  );
}

export function phonesEqual(a: string | null, b: string | null): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  if (!da && !db) return true;
  return da === db;
}

function addressFieldsToAddress(f: CheckoutAddressFields | null): Address {
  if (!f) {
    return {
      line1: null,
      line2: null,
      city: null,
      state: null,
      postalCode: null,
      country: null,
    };
  }
  return {
    line1: f.line1,
    line2: f.line2,
    city: f.city,
    state: f.state,
    postalCode: f.postalCode,
    country: f.country,
  };
}

function hasAnyAddressField(f: CheckoutAddressFields | null): boolean {
  return !isAddressEmpty(addressFieldsToAddress(f));
}

export function mapStripeAddressToFields(
  addr: Stripe.Address | null | undefined
): CheckoutAddressFields | null {
  if (!addr) return null;
  const line1 = addr.line1 ?? null;
  const line2 = addr.line2 ?? null;
  const city = addr.city ?? null;
  const state = addr.state ?? null;
  const postalCode = addr.postal_code ?? null;
  const country = addr.country ?? null;
  if (!line1 && !line2 && !city && !state && !postalCode && !country) {
    return null;
  }
  return { line1, line2, city, state, postalCode, country };
}

/** Narrow shape from Checkout Session used for address import. */
export type CheckoutSessionAddressSource = {
  customer_details?: Stripe.Checkout.Session.CustomerDetails | null;
  /**
   * Newer Stripe Checkout Sessions expose shipping under collected_information.
   * Prefer this over legacy `shipping_details` when both are present.
   */
  collected_information?: Stripe.Checkout.Session.CollectedInformation | null;
  /** Legacy field; may still appear on some API responses. */
  shipping_details?: {
    address?: Stripe.Address | null;
    phone?: string | null;
  } | null;
};

/** Maps a retrieved Checkout Session to our snapshot (unit-testable). */
export function mapStripeSessionToSnapshot(
  session: CheckoutSessionAddressSource
): CheckoutAddressSnapshot {
  const billingRaw = session.customer_details?.address;
  const billing = mapStripeAddressToFields(billingRaw);

  const shipAddrFromCollected =
    session.collected_information?.shipping_details?.address;
  const shipAddrLegacy = session.shipping_details?.address;
  const shipAddr = shipAddrFromCollected ?? shipAddrLegacy;

  let shipping = mapStripeAddressToFields(shipAddr);

  // When checkout collects shipping but Stripe omits a distinct shipping payload
  // (same physical address as billing), reuse billing for shipping.
  if (!shipping && billing) {
    shipping = {
      line1: billing.line1,
      line2: billing.line2,
      city: billing.city,
      state: billing.state,
      postalCode: billing.postalCode,
      country: billing.country,
    };
  }

  const phone =
    session.customer_details?.phone?.trim() ||
    String(session.shipping_details?.phone ?? "").trim() ||
    null;

  return {
    billing,
    shipping,
    phone: phone || null,
  };
}

function fieldsToBillingInput(
  f: CheckoutAddressFields
): Pick<
  CustomerInput,
  | "billingAddressLine1"
  | "billingAddressLine2"
  | "billingCity"
  | "billingState"
  | "billingPostalCode"
  | "billingCountry"
> {
  return {
    billingAddressLine1: f.line1,
    billingAddressLine2: f.line2,
    billingCity: f.city,
    billingState: f.state,
    billingPostalCode: f.postalCode,
    billingCountry: f.country ?? "US",
  };
}

function fieldsToShippingInput(
  f: CheckoutAddressFields
): Pick<
  CustomerInput,
  | "shippingAddressLine1"
  | "shippingAddressLine2"
  | "shippingCity"
  | "shippingState"
  | "shippingPostalCode"
  | "shippingCountry"
> {
  return {
    shippingAddressLine1: f.line1,
    shippingAddressLine2: f.line2,
    shippingCity: f.city,
    shippingState: f.state,
    shippingPostalCode: f.postalCode,
    shippingCountry: f.country ?? "US",
  };
}

export function snapshotToPartialCustomerInput(
  snapshot: CheckoutAddressSnapshot
): Partial<CustomerInput> {
  const out: Partial<CustomerInput> = {};
  if (snapshot.billing && hasAnyAddressField(snapshot.billing)) {
    Object.assign(out, fieldsToBillingInput(snapshot.billing));
  }
  if (snapshot.shipping && hasAnyAddressField(snapshot.shipping)) {
    Object.assign(out, fieldsToShippingInput(snapshot.shipping));
  }
  if (snapshot.phone) {
    out.phone = snapshot.phone;
  }
  return out;
}

export function customerAddressesFullyBlank(customer: Customer): boolean {
  return (
    isAddressMeaningfullyEmpty(extractBillingAddress(customer)) &&
    isAddressMeaningfullyEmpty(extractShippingAddress(customer))
  );
}

async function getQuoteStripeLinkRow(quoteId: number): Promise<{
  stripePaymentLinkId: string | null;
  quoteNumber: string;
} | null> {
  const [row] = await db
    .select({
      stripePaymentLinkId: quotes.stripePaymentLinkId,
      quoteNumber: quotes.quoteNumber,
    })
    .from(quotes)
    .where(eq(quotes.id, quoteId))
    .limit(1);
  return row ?? null;
}

/**
 * Latest completed Checkout Session for this Payment Link.
 */
export async function fetchCheckoutSnapshotForPaymentLink(
  paymentLinkId: string
): Promise<CheckoutAddressSnapshot | null> {
  const stripe = getStripeClient();
  if (!stripe) return null;

  const list = await stripe.checkout.sessions.list({
    payment_link: paymentLinkId,
    status: "complete",
    limit: 24,
  });

  if (!list.data.length) return null;

  const sorted = [...list.data].sort((a, b) => b.created - a.created);
  const latestId = sorted[0]!.id;
  const session = await stripe.checkout.sessions.retrieve(latestId);
  return mapStripeSessionToSnapshot(session as CheckoutSessionAddressSource);
}

export type CheckoutImportPreviewReason =
  | "flag_off"
  | "not_configured"
  | "no_source_quote"
  | "no_customer"
  | "no_payment_link"
  | "no_completed_checkout"
  | "stripe_error"
  | "already_matches";

export type CheckoutImportPreview =
  | { ok: false; reason: CheckoutImportPreviewReason; message: string }
  | {
      ok: true;
      mode: "auto_apply";
      patch: Partial<CustomerInput>;
      quoteId: number;
      quoteNumber: string;
    }
  | {
      ok: true;
      mode: "conflict";
      quoteId: number;
      quoteNumber: string;
      stripe: CheckoutAddressSnapshot;
      onFileBilling: Address;
      onFileShipping: Address;
      onFilePhone: string | null;
      /** User must choose for each true key before apply */
      chooseBilling: boolean;
      chooseShipping: boolean;
      choosePhone: boolean;
      /** Human-readable blocks for modal */
      stripeBillingText: string;
      stripeShippingText: string;
      onFileBillingText: string;
      onFileShippingText: string;
      stripePhone: string | null;
    };

function snapshotHasImportableData(snapshot: CheckoutAddressSnapshot): boolean {
  return (
    hasAnyAddressField(snapshot.billing) ||
    hasAnyAddressField(snapshot.shipping) ||
    !!snapshot.phone
  );
}

export function checkoutConflictPreviewToModalPayload(
  p: Extract<CheckoutImportPreview, { ok: true; mode: "conflict" }>
): CheckoutAddressConflictPreview {
  return {
    quoteId: p.quoteId,
    quoteNumber: p.quoteNumber,
    chooseBilling: p.chooseBilling,
    chooseShipping: p.chooseShipping,
    choosePhone: p.choosePhone,
    stripeBillingText: p.stripeBillingText,
    stripeShippingText: p.stripeShippingText,
    onFileBillingText: p.onFileBillingText,
    onFileShippingText: p.onFileShippingText,
    stripePhone: p.stripePhone,
    onFilePhone: p.onFilePhone,
  };
}

export async function previewCheckoutAddressImportForOrder(params: {
  orderId: number;
  sourceQuoteId: number | null;
  customerId: number | null;
}): Promise<CheckoutImportPreview> {
  const flagOn = await isStripePaymentLinksEnabled();
  if (!flagOn) {
    return {
      ok: false,
      reason: "flag_off",
      message: "Quote payment checkout import is not enabled.",
    };
  }
  if (!getStripeClient()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "Payment checkout is not configured.",
    };
  }
  if (!params.sourceQuoteId) {
    return {
      ok: false,
      reason: "no_source_quote",
      message: "This order has no source quote.",
    };
  }
  if (!params.customerId) {
    return {
      ok: false,
      reason: "no_customer",
      message: "This order has no customer.",
    };
  }

  const qrow = await getQuoteStripeLinkRow(params.sourceQuoteId);
  if (!qrow?.stripePaymentLinkId) {
    return {
      ok: false,
      reason: "no_payment_link",
      message: "This quote has no payment link to read from.",
    };
  }

  let snapshot: CheckoutAddressSnapshot | null;
  try {
    snapshot = await fetchCheckoutSnapshotForPaymentLink(
      qrow.stripePaymentLinkId
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      reason: "stripe_error",
      message: msg,
    };
  }

  if (!snapshot || !snapshotHasImportableData(snapshot)) {
    return {
      ok: false,
      reason: "no_completed_checkout",
      message:
        "No completed payment checkout found yet for this quote’s link.",
    };
  }

  const customer = await getCustomer(params.customerId);
  if (!customer) {
    return {
      ok: false,
      reason: "no_customer",
      message: "Customer not found.",
    };
  }

  const billingOnFile = extractBillingAddress(customer);
  const shippingOnFile = extractShippingAddress(customer);
  const phoneOnFile = customer.phone?.trim() || null;

  if (customerAddressesFullyBlank(customer)) {
    const patch = snapshotToPartialCustomerInput(snapshot);
    if (Object.keys(patch).length === 0) {
      return {
        ok: false,
        reason: "no_completed_checkout",
        message: "Checkout did not include any address or phone to import.",
      };
    }
    return {
      ok: true,
      mode: "auto_apply",
      patch,
      quoteId: params.sourceQuoteId,
      quoteNumber: qrow.quoteNumber,
    };
  }

  const stripeBillingAddr = addressFieldsToAddress(snapshot.billing);
  const stripeShippingAddr = addressFieldsToAddress(snapshot.shipping);

  const chooseBilling =
    hasAnyAddressField(snapshot.billing) &&
    !isAddressMeaningfullyEmpty(billingOnFile) &&
    !addressesEqual(stripeBillingAddr, billingOnFile);

  const chooseShipping =
    hasAnyAddressField(snapshot.shipping) &&
    !isAddressMeaningfullyEmpty(shippingOnFile) &&
    !addressesEqual(stripeShippingAddr, shippingOnFile);

  const choosePhone =
    !!snapshot.phone &&
    !!phoneOnFile &&
    !phonesEqual(snapshot.phone, phoneOnFile);

  const stripeBillingText = snapshot.billing
    ? formatAddress(addressFieldsToAddress(snapshot.billing))
    : "";
  const stripeShippingText = snapshot.shipping
    ? formatAddress(addressFieldsToAddress(snapshot.shipping))
    : "";
  const onFileBillingText = formatAddress(billingOnFile);
  const onFileShippingText = formatAddress(shippingOnFile);

  if (!chooseBilling && !chooseShipping && !choosePhone) {
    const passivePatch = mergeConflictApply({
      customer,
      snapshot,
      billingChoice: "on_file",
      shippingChoice: "on_file",
      phoneChoice: "on_file",
      chooseBilling: false,
      chooseShipping: false,
      choosePhone: false,
    });
    if (Object.keys(passivePatch).length === 0) {
      return {
        ok: false,
        reason: "already_matches",
        message: "Customer already matches the checkout information.",
      };
    }
    return {
      ok: true,
      mode: "auto_apply",
      patch: passivePatch,
      quoteId: params.sourceQuoteId,
      quoteNumber: qrow.quoteNumber,
    };
  }

  return {
    ok: true,
    mode: "conflict",
    quoteId: params.sourceQuoteId,
    quoteNumber: qrow.quoteNumber,
    stripe: snapshot,
    onFileBilling: billingOnFile,
    onFileShipping: shippingOnFile,
    onFilePhone: phoneOnFile,
    chooseBilling,
    chooseShipping,
    choosePhone,
    stripeBillingText,
    stripeShippingText,
    onFileBillingText,
    onFileShippingText,
    stripePhone: snapshot.phone,
  };
}

function mergeConflictApply(params: {
  customer: Customer;
  snapshot: CheckoutAddressSnapshot;
  billingChoice: "checkout" | "on_file";
  shippingChoice: "checkout" | "on_file";
  phoneChoice: "checkout" | "on_file";
  chooseBilling: boolean;
  chooseShipping: boolean;
  choosePhone: boolean;
}): Partial<CustomerInput> {
  const {
    customer,
    snapshot,
    billingChoice,
    shippingChoice,
    phoneChoice,
    chooseBilling,
    chooseShipping,
    choosePhone,
  } = params;
  const patch: Partial<CustomerInput> = {};

  const billingOnFile = extractBillingAddress(customer);
  const shippingOnFile = extractShippingAddress(customer);
  const phoneOnFile = customer.phone?.trim() || null;

  // Billing
  if (hasAnyAddressField(snapshot.billing)) {
    if (chooseBilling) {
      if (billingChoice === "checkout") {
        Object.assign(patch, fieldsToBillingInput(snapshot.billing!));
      }
      // on_file: omit (keep existing)
    } else if (isAddressMeaningfullyEmpty(billingOnFile)) {
      Object.assign(patch, fieldsToBillingInput(snapshot.billing!));
    }
  }

  // Shipping
  if (hasAnyAddressField(snapshot.shipping)) {
    if (chooseShipping) {
      if (shippingChoice === "checkout") {
        Object.assign(patch, fieldsToShippingInput(snapshot.shipping!));
      }
    } else if (isAddressMeaningfullyEmpty(shippingOnFile)) {
      Object.assign(patch, fieldsToShippingInput(snapshot.shipping!));
    }
  }

  // Phone
  if (snapshot.phone) {
    if (choosePhone) {
      if (phoneChoice === "checkout") {
        patch.phone = snapshot.phone;
      }
    } else if (!phoneOnFile) {
      patch.phone = snapshot.phone;
    }
  }

  return patch;
}

export async function applyCheckoutAddressImportForOrder(params: {
  orderId: number;
  sourceQuoteId: number | null;
  customerId: number | null;
  /** Conflict path only */
  billingChoice?: "checkout" | "on_file";
  shippingChoice?: "checkout" | "on_file";
  phoneChoice?: "checkout" | "on_file";
  eventContext?: CustomerEventContext;
}): Promise<
  | { ok: true; updated: boolean }
  | { ok: false; reason: string; message: string }
> {
  const preview = await previewCheckoutAddressImportForOrder({
    orderId: params.orderId,
    sourceQuoteId: params.sourceQuoteId,
    customerId: params.customerId,
  });

  if (!preview.ok) {
    return {
      ok: false,
      reason: preview.reason,
      message: preview.message,
    };
  }

  if (!params.customerId) {
    return { ok: false, reason: "no_customer", message: "No customer." };
  }

  const customer = await getCustomer(params.customerId);
  if (!customer) {
    return { ok: false, reason: "no_customer", message: "Customer not found." };
  }

  let patch: Partial<CustomerInput>;

  if (preview.mode === "auto_apply") {
    patch = preview.patch;
  } else {
    const {
      chooseBilling,
      chooseShipping,
      choosePhone,
      stripe,
    } = preview;

    const billingChoice = params.billingChoice ?? "on_file";
    const shippingChoice = params.shippingChoice ?? "on_file";
    const phoneChoice = params.phoneChoice ?? "on_file";

    if (
      chooseBilling &&
      params.billingChoice !== "checkout" &&
      params.billingChoice !== "on_file"
    ) {
      return {
        ok: false,
        reason: "validation",
        message: "Choose billing: checkout or on file.",
      };
    }
    if (
      chooseShipping &&
      params.shippingChoice !== "checkout" &&
      params.shippingChoice !== "on_file"
    ) {
      return {
        ok: false,
        reason: "validation",
        message: "Choose shipping: checkout or on file.",
      };
    }
    if (
      choosePhone &&
      params.phoneChoice !== "checkout" &&
      params.phoneChoice !== "on_file"
    ) {
      return {
        ok: false,
        reason: "validation",
        message: "Choose phone: checkout or on file.",
      };
    }

    patch = mergeConflictApply({
      customer,
      snapshot: stripe,
      billingChoice,
      shippingChoice,
      phoneChoice,
      chooseBilling,
      chooseShipping,
      choosePhone,
    });
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, updated: false };
  }

  await updateCustomer(params.customerId, patch, {
    ...params.eventContext,
    checkoutAddressImport: {
      quoteId: preview.quoteId,
      orderId: params.orderId,
      quoteNumber: preview.quoteNumber,
    },
  });

  return { ok: true, updated: true };
}

export type QuickImportResult =
  | { kind: "error"; message: string; reason?: string }
  | { kind: "applied" }
  | { kind: "noop"; message: string }
  | { kind: "conflict"; preview: CheckoutAddressConflictPreview };

/**
 * One round trip from the order UI: auto-apply when possible, else return conflict payload for modal.
 */
export async function importCheckoutAddressesQuickFromOrder(params: {
  orderId: number;
  sourceQuoteId: number | null;
  customerId: number | null;
  eventContext?: CustomerEventContext;
}): Promise<QuickImportResult> {
  const preview = await previewCheckoutAddressImportForOrder(params);
  if (!preview.ok) {
    return {
      kind: "error",
      message: preview.message,
      reason: preview.reason,
    };
  }
  if (preview.mode === "conflict") {
    return {
      kind: "conflict",
      preview: checkoutConflictPreviewToModalPayload(preview),
    };
  }
  const applied = await applyCheckoutAddressImportForOrder(params);
  if (!applied.ok) {
    return {
      kind: "error",
      message: applied.message,
      reason: applied.reason,
    };
  }
  if (!applied.updated) {
    return { kind: "noop", message: "Nothing to update." };
  }
  return { kind: "applied" };
}

/**
 * Best-effort after quote→order: only blank customers; never throws.
 */
export async function tryAutoFillBlankCustomerFromQuoteCheckout(params: {
  quoteId: number;
  customerId: number;
  orderId: number;
  eventContext?: CustomerEventContext;
}): Promise<void> {
  try {
    const flagOn = await isStripePaymentLinksEnabled();
    if (!flagOn || !getStripeClient()) return;

    const customer = await getCustomer(params.customerId);
    if (!customer || !customerAddressesFullyBlank(customer)) return;

    const qrow = await getQuoteStripeLinkRow(params.quoteId);
    if (!qrow?.stripePaymentLinkId) return;

    let snapshot: CheckoutAddressSnapshot | null;
    try {
      snapshot = await fetchCheckoutSnapshotForPaymentLink(
        qrow.stripePaymentLinkId
      );
    } catch {
      return;
    }
    if (!snapshot || !snapshotHasImportableData(snapshot)) return;

    const patch = snapshotToPartialCustomerInput(snapshot);
    if (Object.keys(patch).length === 0) return;

    await updateCustomer(params.customerId, patch, {
      ...params.eventContext,
      checkoutAddressImport: {
        quoteId: params.quoteId,
        orderId: params.orderId,
        quoteNumber: qrow.quoteNumber,
      },
    });
  } catch (e) {
    console.error("tryAutoFillBlankCustomerFromQuoteCheckout:", e);
  }
}
