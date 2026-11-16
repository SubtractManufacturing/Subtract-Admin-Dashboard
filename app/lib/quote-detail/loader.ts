/**
 * Everything the Quote detail page needs, assembled in one place.
 *
 * `loadQuoteDetail` decides what to fetch and how to shape it; every lookup goes
 * through {@link QuoteLoaderDeps}, so the conditional rules (composer only when
 * outbound email is on, banana model only once converted, and so on) are tested
 * without Postgres or S3.
 *
 *   production adapter: `./loader.server.ts`
 *   test adapter:       `./loader.test.ts`
 *
 * The part-by-part signed-URL rules live in `./part-view.ts`; the send-email
 * composer state in `~/lib/route-actions/send-composer.ts`.
 */
import type { getCustomer, getCustomers } from "~/lib/customers";
import type { Attachment } from "~/lib/db/schema";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import type { getLastQuoteReceivedSend } from "~/lib/email/enqueue-quote-received-email.server";
import type { getQuoteReceivedEmailReadiness } from "~/lib/email/quote-received-email-readiness.server";
import type { getEventsByEntity } from "~/lib/events";
import type {
  getBananaModelUrls,
  getLineItemArchiveRetentionDays,
} from "~/lib/developerSettings";
import type { listArchivedQuoteLineItems } from "~/lib/line-item-archive.server";
import type { getNotes } from "~/lib/notes";
import type { getOrder } from "~/lib/orders";
import type { getLatestCalculationsForQuote } from "~/lib/quotePriceCalculations";
import type { getQuote } from "~/lib/quotes";
import {
  loadSendComposer,
  type SendComposerPorts,
} from "~/lib/route-actions/send-composer";
import type { getVendor, getVendors } from "~/lib/vendors";
import type { QuoteAuth } from "./context";
import { buildQuotePartView, type PartViewPorts } from "./part-view";

type Role = QuoteAuth["userDetails"]["role"];

export type QuoteLoaderDeps = {
  quotes: {
    get: typeof getQuote;
    /** Attachments linked to the Quote; rows whose attachment is gone are omitted. */
    attachments(quoteId: number): Promise<Attachment[]>;
    priceCalculations: typeof getLatestCalculationsForQuote;
    archivedLineItems: typeof listArchivedQuoteLineItems;
    archiveRetentionDays: typeof getLineItemArchiveRetentionDays;
    convertedOrder: typeof getOrder;
  };
  directory: {
    customer: typeof getCustomer;
    vendor: typeof getVendor;
    customers: typeof getCustomers;
    vendors: typeof getVendors;
  };
  notes: typeof getNotes;
  events: typeof getEventsByEntity;
  flags: {
    priceCalculator(role: Role | undefined): Promise<boolean>;
    cadRevision(role: Role | undefined): Promise<boolean>;
    pdfAutoDownload(): Promise<boolean>;
    rejectionReasonRequired(): Promise<boolean>;
    bananaForScale(): Promise<boolean>;
    stripePaymentLinks(): Promise<boolean>;
    outboundEmail(): Promise<boolean>;
    hideLineItemThumbnails(): Promise<boolean>;
  };
  /** Signing and lookups for one page load's parts (placeholder CAD resolved once). */
  partViewPorts(): Promise<PartViewPorts>;
  banana: {
    model: typeof getBananaModelUrls;
    sign(key: string): Promise<string>;
  };
  email: {
    composer: SendComposerPorts;
    actorMerge(source: {
      email: string;
      name: string | null | undefined;
    }): Promise<Record<string, string>>;
    receivedReadiness: typeof getQuoteReceivedEmailReadiness;
    lastReceivedSend: typeof getLastQuoteReceivedSend;
  };
};

export async function loadQuoteDetail(
  input: { quoteId: string | undefined } & QuoteAuth,
  deps: QuoteLoaderDeps,
) {
  const { user, userDetails } = input;

  if (!input.quoteId) {
    throw new Response("Quote ID is required", { status: 400 });
  }
  const quote = await deps.quotes.get(parseInt(input.quoteId, 10));
  if (!quote) {
    throw new Response("Quote not found", { status: 404 });
  }

  const [customer, vendor, customers, vendors, partPorts] = await Promise.all([
    quote.customerId ? deps.directory.customer(quote.customerId) : null,
    quote.vendorId ? deps.directory.vendor(quote.vendorId) : null,
    deps.directory.customers(),
    deps.directory.vendors(),
    deps.partViewPorts(),
  ]);

  const parts = await Promise.all(
    (quote.parts || []).map((part) => buildQuotePartView(part, partPorts)),
  );

  // Attachments download through the unified /download route, so no signed URLs here.
  const [notes, attachments] = await Promise.all([
    deps.notes("quote", quote.id.toString()),
    deps.quotes.attachments(quote.id),
  ]);

  const [
    canAccessPriceCalculator,
    pdfAutoDownload,
    rejectionReasonRequired,
    events,
    canRevise,
    bananaEnabled,
    stripeEnabled,
    outboundEmailEnabled,
    hideLineItemThumbnails,
  ] = await Promise.all([
    deps.flags.priceCalculator(userDetails?.role),
    deps.flags.pdfAutoDownload(),
    deps.flags.rejectionReasonRequired(),
    deps.events("quote", quote.id.toString(), 10),
    deps.flags.cadRevision(userDetails?.role),
    deps.flags.bananaForScale(),
    deps.flags.stripePaymentLinks(),
    deps.flags.outboundEmail(),
    deps.flags.hideLineItemThumbnails(),
  ]);

  const sendComposer = outboundEmailEnabled
    ? await loadSendComposer(deps.email.composer, {
        contextKey: EMAIL_CONTEXT.QUOTE_SEND,
        actorMerge: await deps.email.actorMerge({
          email: userDetails?.email?.trim() || user?.email?.trim() || "",
          name: userDetails?.name,
        }),
        subjectVars: {
          quoteNumber: quote.quoteNumber,
          customerName: customer?.displayName ?? "Customer",
          total: quote.total ?? "0.00",
        },
      })
    : null;

  let bananaModelUrl: string | null = null;
  if (bananaEnabled) {
    const banana = await deps.banana.model();
    if (banana.meshUrl && banana.conversionStatus === "completed") {
      bananaModelUrl = await deps.banana.sign(banana.meshUrl);
    }
  }

  const [
    convertedOrder,
    priceCalculations,
    archivedLineItems,
    archiveRetentionDays,
    quoteReceivedEmailReadiness,
  ] = await Promise.all([
    quote.convertedToOrderId ? deps.quotes.convertedOrder(quote.convertedToOrderId) : null,
    deps.quotes.priceCalculations(quote.id),
    deps.quotes.archivedLineItems(quote.id),
    deps.quotes.archiveRetentionDays(),
    deps.email.receivedReadiness(quote.id),
  ]);

  const lastReceivedSend =
    quoteReceivedEmailReadiness.contextKey != null
      ? await deps.email.lastReceivedSend(quote.id, quoteReceivedEmailReadiness.contextKey)
      : null;

  return {
    quote: { ...quote, parts },
    customer,
    vendor,
    customers,
    vendors,
    notes,
    attachments,
    user,
    userDetails,
    priceCalculations,
    canAccessPriceCalculator,
    pdfAutoDownload,
    rejectionReasonRequired,
    events,
    convertedOrder,
    canRevise,
    bananaEnabled,
    bananaModelUrl,
    stripeEnabled,
    outboundEmailEnabled,
    hideLineItemThumbnails,
    quoteSendEmailReady: sendComposer?.ready ?? false,
    quoteSendEmailDefaultSubject: sendComposer?.defaultSubject ?? null,
    quoteSendEditableSlots: sendComposer?.editableSlots ?? [],
    quoteSendRequiredAttachmentDocumentKinds:
      sendComposer?.requiredAttachmentDocumentKinds ?? [],
    archivedLineItems: archivedLineItems.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      archivedAt: item.archivedAt.toISOString(),
      hardDeleteAt: item.hardDeleteAt.toISOString(),
      quotePartId: item.quotePartId,
    })),
    archiveRetentionDays,
    quoteReceivedEmailReadiness,
    quoteReceivedLastSend: lastReceivedSend
      ? {
          createdAt: lastReceivedSend.createdAt.toISOString(),
          sentAt: lastReceivedSend.sentAt?.toISOString() ?? null,
          to: lastReceivedSend.toAddresses[0] ?? "",
          status: lastReceivedSend.status,
        }
      : null,
  };
}
