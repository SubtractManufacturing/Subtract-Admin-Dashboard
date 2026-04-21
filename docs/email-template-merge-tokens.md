# Email Template Merge Tokens

Single source of truth for all reserved merge tokens available in Subtract Manufacturing's outbound email templates.

The code-level catalog lives in `app/lib/email/resolve/types.ts` (`MERGE_TOKEN_CATALOG`). Keep this document and that file in sync when adding or changing tokens.

---

## What are merge tokens?

**Merge tokens** are `{{tokenName}}` placeholders you place in email templates. When an email is sent, the application replaces every token with a real value resolved from the entity being emailed about (a quote, order, customer, etc.).

There are two sources of tokens at send time:

| Source | Where values come from |
| ------ | ---------------------- |
| **Reserved tokens** | Automatically resolved from application data by the resolver layer. Documented on this page. |
| **Snippets** | Admin-defined reusable text blocks configured in Admin → Email → Snippets. |

When both sources define the same key, the **reserved resolver wins**. A reserved key like `customerName` cannot be overridden by a snippet of the same name.

---

## Syntax

Tokens use **double curly braces** with a `camelCase` key:

```
{{customerName}}
{{documentNumber}}
{{partSpecs}}
```

- Keys may only contain letters, digits, and underscores (`\w+`).
- Keys are **case-sensitive**.
- Single braces `{like this}` are **not** tokens and are never replaced.

---

## Fail-closed sends

**If any `{{token}}` in a template cannot be resolved for the current send, the email will not be sent.** A clear error message will list every unresolvable token. This rule applies to tokens in:

- The subject line
- All body copy slots
- Button labels and button links

This prevents broken or partially-rendered emails from ever reaching recipients.

---

## Entity kinds

The resolver dispatches based on the **entity kind** of the send:

| Entity kind | When it is used |
| ----------- | --------------- |
| `quote` | Sending a quote to a customer |
| `order` | Order confirmation, status updates |
| `customer` | Direct customer communication |
| `vendor` | Vendor-facing notifications |

Each token in the catalog documents which entity kinds supply it.

---

## Token presence

| Presence | Meaning |
| -------- | ------- |
| `always` | Resolver guarantees this key in the map for applicable entity kinds. |
| `when-available` | Resolver includes the key only when the underlying data exists. If the template references the token and the data is absent → send fails. |

---

## Reserved token catalog

### Document / Identifier

| Token | Label | Entity kinds | Presence |
| ----- | ----- | ------------ | -------- |
| `{{documentNumber}}` | Document Number | quote, order | always |
| `{{quoteNumber}}` | Quote Number | quote | always |
| `{{orderNumber}}` | Order Number | order | always |
| `{{documentDate}}` | Document Date | quote, order | always |
| `{{documentStatus}}` | Document Status | quote, order | always |

**Notes:**
- `{{documentNumber}}` is the preferred abstract identifier for new templates. It resolves to the quote number on quotes and the order number on orders.
- `{{quoteNumber}}` and `{{orderNumber}}` are backward-compatible aliases that exist so existing templates keep working. Prefer `{{documentNumber}}` going forward.
- `{{documentDate}}` is formatted as `Month D, YYYY` (e.g. `March 15, 2026`).

---

### Money

| Token | Label | Entity kinds | Presence |
| ----- | ----- | ------------ | -------- |
| `{{total}}` | Total | quote, order | when-available |
| `{{subtotal}}` | Subtotal | quote | when-available |

Totals are formatted as USD with two decimal places (e.g. `$1,200.00`). Both tokens are absent when no total has been set on the document.

---

### Customer

These tokens are **universal**: available in any entity kind that has an associated customer record.

| Token | Label | Entity kinds | Presence |
| ----- | ----- | ------------ | -------- |
| `{{customerName}}` | Customer Name | all | always |
| `{{customerCompanyName}}` | Customer Company Name | all | when-available |
| `{{customerEmail}}` | Customer Email | all | when-available |
| `{{customerPhone}}` | Customer Phone | all | when-available |
| `{{billingAddress}}` | Billing Address | all | when-available |
| `{{shippingAddress}}` | Shipping Address | all | when-available |
| `{{paymentTerms}}` | Payment Terms | all | when-available |

**Address format** — multi-line block, blank lines omitted:

```
Acme Corp
123 Main St
Portland, OR 97201
```

Place `{{billingAddress}}` or `{{shippingAddress}}` on its own paragraph in a plain-text or preformatted slot to preserve line breaks.

---

### Vendor

| Token | Label | Entity kinds | Presence |
| ----- | ----- | ------------ | -------- |
| `{{vendorName}}` | Vendor Name | quote, order, vendor | when-available |

Available on quotes or orders that have an associated vendor, or when the entity kind is `vendor` directly.

---

### Parts and Line Items

| Token | Label | Entity kinds | Presence |
| ----- | ----- | ------------ | -------- |
| `{{partNames}}` | Part Names | quote, order | when-available |
| `{{partSpecs}}` | Part Specifications | quote, order | when-available |
| `{{lineItemCount}}` | Line Item Count | quote, order | when-available |
| `{{partCount}}` | Part Count | quote | when-available |

**`{{partNames}}` format** — comma-separated:

```
hood assembly, latch base v2, lug nut cover
```

**`{{partSpecs}}` format** — pre-formatted multi-line block, one block per part, separated by a blank line. Fields with no data are omitted.

```
Name: static wiper base
Material: 4140 H900
Tolerance: +/- 0.005"
Finishing: As finished

Name: Robot Gripper Baseplate
Material: 6061 T6511
Tolerance: +/- 0.001"
Finishing: Anodized
```

Place `{{partSpecs}}` on its own paragraph. In markdown body slots, the text renders as a preformatted block; in plain-text slots, newlines are preserved directly.

---

### Commerce / Optional

| Token | Label | Entity kinds | Presence |
| ----- | ----- | ------------ | -------- |
| `{{paymentLinkUrl}}` | Payment Link URL | quote | when-available |
| `{{validUntil}}` | Valid Until | quote | when-available |
| `{{shipDate}}` | Ship Date | order | when-available |

- `{{paymentLinkUrl}}` is only present when the quote has an **active** Stripe payment link. Referencing it on a quote without a link will cause a send failure.
- `{{validUntil}}` and `{{shipDate}}` are formatted as `Month D, YYYY`.

---

## Attachments

File attachments are sent as actual email attachments — they are not exposed as merge tokens. Use `{{partNames}}` or `{{partSpecs}}` for human-readable part identity in the body copy. A dedicated `{{attachmentList}}` token is not provided in v1.

---

## Snippets and collision

Admin-defined snippets (Admin → Email → Snippets) add custom reusable text. Avoid naming a snippet with the same key as a reserved token; the reserved resolver will always override it. The Admin UI warns when a snippet key matches a reserved token name.

---

## Adding new tokens

1. Add an entry to `MERGE_TOKEN_CATALOG` in `app/lib/email/resolve/types.ts`.
2. Implement the field in the appropriate entity resolver(s) under `app/lib/email/resolve/`.
3. Update this document.
4. Run `npm run typecheck` to verify.

---

## Quick reference

```
{{documentNumber}}      quote number or order number (preferred in new templates)
{{quoteNumber}}         quote number — alias, prefer documentNumber
{{orderNumber}}         order number — alias, prefer documentNumber
{{documentDate}}        March 15, 2026
{{documentStatus}}      Draft / Sent / In Production / …
{{total}}               $1,200.00
{{subtotal}}            $1,100.00
{{customerName}}        Acme Corp
{{customerCompanyName}} Acme Corp
{{customerEmail}}       contact@acmecorp.com
{{customerPhone}}       (503) 555-0100
{{billingAddress}}      multi-line block
{{shippingAddress}}     multi-line block
{{paymentTerms}}        Net 30
{{vendorName}}          vendor display name
{{partNames}}           hood assembly, latch base v2
{{partSpecs}}           multi-line formatted block (Name / Material / Tolerance / Finishing)
{{lineItemCount}}       3
{{partCount}}           3
{{paymentLinkUrl}}      https://buy.stripe.com/…
{{validUntil}}          April 30, 2026
{{shipDate}}            May 15, 2026
```
