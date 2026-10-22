/**
 * Email context registry (single source of truth).
 *
 * How to add a new email context:
 * 1) Add one entry to EMAIL_CONTEXTS below (key, label, description).
 * 2) Wire the send path using EMAIL_CONTEXT.<CONTEXT_NAME> (never raw strings).
 * 3) Add a short inline comment at the context button/action pointing here.
 * 4) In Admin -> Email, set a template row's context to this key.
 *    - If another active template already owns the key, save is rejected.
 * 5) Unassigned contexts are valid: related button/action should show disabled/error.
 */
export const EMAIL_CONTEXTS = [
  {
    key: "quote_send",
    label: "Send quote email",
    description:
      "Used when sending a quote to the customer from the quote page.",
  },
  {
    key: "order_confirmation",
    label: "Order confirmation",
    description:
      "Customer-facing confirmation for a new order, before board / shop handoff.",
  },
  {
    key: "quote_auto_created",
    label: "Quote received (auto-created)",
    description:
      "Customer acknowledgment when a quote is created automatically (e.g. WordPress RFQ intake).",
  },
  {
    key: "quote_manual_created",
    label: "Quote received (manual create)",
    description:
      "Customer acknowledgment when staff create a quote from email or the New Quote flow.",
  },
] as const;

export type EmailContextDefinition = (typeof EMAIL_CONTEXTS)[number];
export type EmailContextKey = EmailContextDefinition["key"];

export const EMAIL_CONTEXT = {
  QUOTE_SEND: "quote_send",
  ORDER_CONFIRMATION: "order_confirmation",
  QUOTE_AUTO_CREATED: "quote_auto_created",
  QUOTE_MANUAL_CREATED: "quote_manual_created",
} as const satisfies Record<string, EmailContextKey>;

export function isEmailContextKey(value: string): value is EmailContextKey {
  return EMAIL_CONTEXTS.some((context) => context.key === value);
}

export function getEmailContextMeta(key: EmailContextKey): EmailContextDefinition {
  return EMAIL_CONTEXTS.find((context) => context.key === key)!;
}
