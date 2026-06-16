/**
 * Email Template Merge Token System — Types & Catalog
 *
 * This is the single source of truth for all reserved merge tokens that the
 * application resolver supplies. Templates reference tokens as {{tokenName}}.
 *
 * See docs/email-template-merge-tokens.md for the full human-readable guide.
 */

/** Entity kinds the resolver understands. Extend this union as new kinds ship. */
export type EntityKind = "quote" | "order" | "customer" | "vendor";

/**
 * Whether the resolver guarantees the key is in the map for a given entity kind:
 *   "always"         - Resolver always includes this key for applicable entity kinds.
 *   "when-available" - Resolver includes the key only when underlying data is present.
 *                      Referencing the token in a template when data is absent causes a
 *                      fail-closed send error.
 */
export type TokenPresence = "always" | "when-available";

/** Output format hint used by Admin UI and docs. Does not affect interpolation. */
export type TokenFormat = "string" | "currency" | "multiline" | "url" | "date";

export type MergeTokenDefinition = {
  /** The {{key}} used in templates. camelCase, /\w+/ only. */
  key: string;
  /** Short display label for Admin UI and docs. */
  label: string;
  /** Human-readable description of what this token resolves to. */
  description: string;
  /**
   * Which entity kinds supply this token.
   * "all" = universally available wherever the relevant customer-party data exists.
   * "actor" = staff user performing the send (userName / userEmail); not an EntityKind.
   */
  suppliedBy: EntityKind[] | "all" | "actor";
  /** See TokenPresence. */
  presence: TokenPresence;
  /** Format hint for documentation and UI rendering. */
  format: TokenFormat;
};

/**
 * V1 Reserved Merge Token Catalog.
 *
 * Every token here is owned by the application resolver. Do not add entries
 * unless the corresponding resolver(s) implement them. Keep in sync with
 * docs/email-template-merge-tokens.md.
 */
export const MERGE_TOKEN_CATALOG = [
  // ── Document / Identifier ─────────────────────────────────────────────
  {
    key: "documentNumber",
    label: "Document Number",
    description:
      "The human-facing identifier for the document being sent (quote number on quotes, order number on orders). Prefer this over quoteNumber / orderNumber in new templates.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "always" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "quoteNumber",
    label: "Quote Number",
    description:
      "The quote's number (e.g. 25Q00001). Backward-compatible alias for documentNumber on quote sends. Prefer documentNumber in new templates.",
    suppliedBy: ["quote"] as EntityKind[],
    presence: "always" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "orderNumber",
    label: "Order Number",
    description: "The order's number. Alias for documentNumber on order sends.",
    suppliedBy: ["order"] as EntityKind[],
    presence: "always" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "documentDate",
    label: "Document Date",
    description: "The date the document was created, formatted as Month D, YYYY.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "always" as TokenPresence,
    format: "date" as TokenFormat,
  },
  {
    key: "documentStatus",
    label: "Document Status",
    description: "The current status of the document (e.g. Draft, Sent, In Production).",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "always" as TokenPresence,
    format: "string" as TokenFormat,
  },

  // ── Money ─────────────────────────────────────────────────────────────
  {
    key: "total",
    label: "Total",
    description: "Formatted document total (e.g. $1,200.00). Absent when no total is set.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "currency" as TokenFormat,
  },
  {
    key: "subtotal",
    label: "Subtotal",
    description: "Formatted subtotal before adjustments (e.g. $1,100.00). Quote only.",
    suppliedBy: ["quote"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "currency" as TokenFormat,
  },

  // ── Customer — universal where customer data exists ───────────────────
  {
    key: "customerName",
    label: "Customer Name",
    description:
      "The customer's display name (e.g. Acme Corp). Available in any entity kind that has an associated customer record.",
    suppliedBy: "all",
    presence: "always" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "customerCompanyName",
    label: "Customer Company Name",
    description: "The customer's company name, if set. May differ from display name.",
    suppliedBy: "all",
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "customerEmail",
    label: "Customer Email",
    description: "The customer's email address.",
    suppliedBy: "all",
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "customerPhone",
    label: "Customer Phone",
    description: "The customer's phone number.",
    suppliedBy: "all",
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "billingAddress",
    label: "Billing Address",
    description:
      "Customer's billing address as a formatted multi-line block (company, street, city/state/ZIP).",
    suppliedBy: "all",
    presence: "when-available" as TokenPresence,
    format: "multiline" as TokenFormat,
  },
  {
    key: "shippingAddress",
    label: "Shipping Address",
    description:
      "Customer's shipping address as a formatted multi-line block (company, street, city/state/ZIP).",
    suppliedBy: "all",
    presence: "when-available" as TokenPresence,
    format: "multiline" as TokenFormat,
  },
  {
    key: "paymentTerms",
    label: "Payment Terms",
    description: "The customer's payment terms (e.g. Net 30).",
    suppliedBy: "all",
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },

  // ── Staff (logged-in user) — distinct from customer ────────────────────
  {
    key: "userName",
    label: "User Name (staff)",
    description:
      "The display name of the Subtract staff member sending the email. If no name is set on the account, a readable fallback is derived from their email (e.g. local part with spaces). Not the customer.",
    suppliedBy: "actor",
    presence: "always" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "userEmail",
    label: "User Email (staff)",
    description:
      "The email address of the Subtract staff member sending the email. Not the customer's email.",
    suppliedBy: "actor",
    presence: "always" as TokenPresence,
    format: "string" as TokenFormat,
  },

  // ── Vendor ────────────────────────────────────────────────────────────
  {
    key: "vendorName",
    label: "Vendor Name",
    description: "The vendor's display name, when the entity has an associated vendor.",
    suppliedBy: ["quote", "order", "vendor"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },

  // ── Parts / Line items ────────────────────────────────────────────────
  {
    key: "partNames",
    label: "Part Names",
    description:
      "Comma-separated list of part names from the document's line items (e.g. hood assembly, latch base v2).",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "partSpecs",
    label: "Part Specifications",
    description:
      "Pre-formatted multi-line block of per-part details (Name, Material, Tolerance, Finishing). Parts are separated by a blank line. Place on its own paragraph.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "multiline" as TokenFormat,
  },
  {
    key: "partMaterials",
    label: "Part Materials",
    description:
      "Comma-separated list of materials in the same order as partNames and partSpecs (one value per part). Uses an em dash for a part with no material.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "partQtys",
    label: "Part Quantities",
    description:
      "Comma-separated list of line quantities in the same order as partNames and partSpecs (one value per part). Uses an em dash when quantity is unknown.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "lineItemCount",
    label: "Line Item Count",
    description: "Total number of line items on the document.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "partCount",
    label: "Part Count",
    description: "Number of distinct parts attached to the quote.",
    suppliedBy: ["quote"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },

  // ── Commerce / Optional ───────────────────────────────────────────────
  {
    key: "paymentLinkUrl",
    label: "Payment Link URL",
    description:
      "Active Stripe payment link URL. When Stripe payment links are enabled and the quote is payable, a link is created at email preview/send time if missing, then this token resolves.",
    suppliedBy: ["quote"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "url" as TokenFormat,
  },
  {
    key: "validUntil",
    label: "Valid Until",
    description:
      "The date the quote expires, formatted as Month D, YYYY. Only present when an expiration date is set.",
    suppliedBy: ["quote"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "date" as TokenFormat,
  },
  {
    key: "estimatedDeliveryDate",
    label: "Estimated Delivery Date",
    description:
      "Estimated delivery date or range. On quotes, computed from lead time at send time. On orders, from the stored Delivery Date.",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "date" as TokenFormat,
  },
  {
    key: "leadTimeBusinessDays",
    label: "Lead Time (Business Days)",
    description:
      "Lead time in business days, e.g. \"12 Business Days\" or \"11–13 Business Days\".",
    suppliedBy: ["quote", "order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "string" as TokenFormat,
  },
  {
    key: "shipDate",
    label: "Ship Date (deprecated)",
    description:
      "Deprecated alias for order delivery date. Prefer estimatedDeliveryDate in new templates.",
    suppliedBy: ["order"] as EntityKind[],
    presence: "when-available" as TokenPresence,
    format: "date" as TokenFormat,
  },
] as const satisfies readonly MergeTokenDefinition[];

export type MergeTokenKey = (typeof MERGE_TOKEN_CATALOG)[number]["key"];

/** Flat set of all reserved token keys for fast membership checks. */
export const RESERVED_MERGE_TOKEN_KEYS: ReadonlySet<string> = new Set(
  MERGE_TOKEN_CATALOG.map((t) => t.key),
);

/** Flat map token key → definition for O(1) lookups. */
export const MERGE_TOKEN_BY_KEY: ReadonlyMap<string, MergeTokenDefinition> = new Map(
  MERGE_TOKEN_CATALOG.map((t) => [t.key, t]),
);

/** The flat string map that the interpolation pipeline consumes. All values are strings. */
export type ResolvedTokenMap = Record<string, string>;

// ── Internal DTOs ─────────────────────────────────────────────────────

/**
 * Normalized representation of a single part/line item used internally by
 * composite formatters. Never exposed to templates directly.
 */
export type NormalizedPart = {
  name: string;
  material?: string | null;
  tolerance?: string | null;
  finishing?: string | null;
  /** Line quantity when known (order line item or summed quote line items for a quote part). */
  quantity?: number | null;
};

/** Normalized address fields used by address formatters. */
export type NormalizedAddress = {
  company?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
};
