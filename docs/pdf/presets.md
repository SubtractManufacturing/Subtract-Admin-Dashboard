# PDF template presets

This guide explains how **presets** work in the PDF generation flow and how to add or change them. Presets let users pick a **starting layout** (labels, amounts, copy) from a dropdown before generating a PDF. **Inline editing** (`contentEditable`) stays available after the template renders.

---

## Concepts

### What a preset is

- A **preset** is an identifier (`id`) plus a **human label** shown in the modal dropdown.
- Choosing a preset drives **initial** values in the React template (via a small helper, usually a `switch` on `presetId`).
- Presets are **not** persisted to the database by default. They only affect the preview and the HTML sent to the PDF service for that generation.

### Presets vs inline editing

- The preset sets **defaults when the template mounts** (or when `presetId` changes).
- Users can still edit fields in the preview where the template uses `contentEditable`.
- When `presetId` changes, the document inner wrapper uses **`key={presetId}`** so React remounts that subtree and avoids stale edited text mixing with new defaults.

### What must not appear in the PDF

[`PdfGenerationModal`](../../app/components/shared/PdfGenerationModal.tsx) only captures HTML inside the `div` attached to **`templateRef`** (the bordered preview). The preset **dropdown and label** are passed as **`previewToolbar`** and render in the **footer** next to Cancel / Generate PDF. They are **outside** the captured node, so they never appear in the generated file.

---

## Architecture

```text
Generate*PdfModal
  ├─ useState(presetId)
  ├─ PdfGenerationModal
  │    ├─ previewToolbar  → label + <select> (footer, not in PDF)
  │    └─ templateRef div → *PdfTemplate (this becomes PDF HTML)
  └─ *PdfTemplate presetId={presetId}
         ├─ * _PDF_PRESETS array (id + label)
         ├─ get*PresetFields(presetId, ctx)  → strings / values for JSX
         └─ <div className="document-container" key={presetId}> …
```

**State lives in each `Generate*PdfModal`**, not in `PdfGenerationModal`, so each document type imports its own preset list for the `<select>` options.

---

## Shared type

[`PdfPresetOption`](../../app/lib/pdf-utils.ts) in `app/lib/pdf-utils.ts`:

```ts
export type PdfPresetOption<TId extends string = string> = {
  id: TId;
  label: string;
};
```

Template files declare a **const array** of options `as const satisfies readonly PdfPresetOption[]` and derive the preset id union type from that array (see existing templates).

---

## Templates and modals today

| Document | Template (presets + helper) | Modal (state + toolbar) |
|----------|-----------------------------|-------------------------|
| Invoice | [`InvoicePdfTemplate.tsx`](../../app/components/orders/InvoicePdfTemplate.tsx) | [`GenerateInvoicePdfModal.tsx`](../../app/components/orders/GenerateInvoicePdfModal.tsx) |
| Quote | [`QuotePdfTemplate.tsx`](../../app/components/quotes/QuotePdfTemplate.tsx) | [`GenerateQuotePdfModal.tsx`](../../app/components/quotes/GenerateQuotePdfModal.tsx) |
| Purchase order | [`PurchaseOrderPdfTemplate.tsx`](../../app/components/orders/PurchaseOrderPdfTemplate.tsx) | [`GeneratePurchaseOrderPdfModal.tsx`](../../app/components/orders/GeneratePurchaseOrderPdfModal.tsx) |

---

## How to add a new preset

Follow these steps **in the template file** for that document. Do not put preset-specific business rules inside `PdfGenerationModal`.

### 1. Register the option

At the top of the template (next to the existing array), add an entry:

```ts
export const INVOICE_PDF_PRESETS = [
  { id: "default", label: "Default" },
  { id: "receipt", label: "Receipt / paid" }, // example
] as const satisfies readonly PdfPresetOption[];
```

TypeScript will extend `InvoicePdfPresetId` automatically from the array.

### 2. Extend the preset helper

In the same file, add a **`case`** (or branch) in `getInvoicePresetFields` / `getQuotePresetFields` / `getPurchaseOrderPresetFields` that returns the **initial** strings (and any flags) for the new preset.

- Pass a **`ctx`** object with values you already compute in the template (`total`, `entity` fields, etc.). Keep SERP-specific formatting in one place (`formatCurrency`, `formatDate` from [`pdf-utils`](../../app/lib/pdf-utils.ts)).
- Keep **`default`** behavior unchanged unless product explicitly changes the baseline invoice/quote/PO.

### 3. Wire JSX

Use the helper’s return value wherever the new preset should change **initial** copy or numbers. Keep **`contentEditable`** on the same nodes if users should still be able to override text after choosing a preset.

### 4. Remount

Ensure the inner document wrapper still has **`key={presetId}`** (already present on `.document-container` in each template). Add `presetId` to any `useEffect` that registers DOM listeners on preview content if listeners must refresh when the subtree remounts.

### 5. Modal

The matching **`Generate*PdfModal`** already maps **`INVOICE_PDF_PRESETS`** (or equivalent) to `<option>` elements. You normally **do not** edit the modal unless you need conditional options (e.g. hide a preset for quotes only).

### 6. Naming

- **`id`**: stable, code-facing (`snake_case` or `camelCase` consistent with the codebase).
- **`label`**: short, user-facing dropdown text.

---

## Example: invoice “receipt” style (illustrative)

Only a pattern sketch—not necessarily in the product today:

1. Add `{ id: "receipt", label: "Receipt" }` to `INVOICE_PDF_PRESETS`.
2. In `getInvoicePresetFields`, for `"receipt"` return e.g. `amountPaidDisplay: formatCurrency(ctx.total)`, `amountDueDisplay: formatCurrency(0)`, and adjust labels or due-date copy if needed.
3. Use those fields in the financial section JSX (and extend the helper return type as you add fields).

Always respect real **SERP fields** when they exist (e.g. partial payments); the helper can read richer `ctx` passed from the component.

---

## Adding presets to a new PDF type

1. Implement a `*PdfTemplate` and a `Generate*PdfModal` that uses [`PdfGenerationModal`](../../app/components/shared/PdfGenerationModal.tsx).
2. Export `*_PDF_PRESETS`, optional `get*PresetFields`, optional `presetId` prop defaulting to `"default"`.
3. In the modal: `useState<PresetId>("default")`, pass **`previewToolbar`** (label + select) and **`presetId`** to the template.
4. Put **`key={presetId}`** on the inner document root inside `templateRef`.

---

## Verification checklist

- [ ] Preset UI appears only in the modal footer, not inside the bordered preview.
- [ ] Generated PDF contains **no** dropdown or preset label.
- [ ] Switching presets updates the preview; **`default`** matches previous baseline behavior.
- [ ] Edits in the preview still appear in the generated PDF when unchanged before generate.

---

## Related code

| Area | File |
|------|------|
| Modal shell + capture behavior | `app/components/shared/PdfGenerationModal.tsx` |
| Preset option type | `app/lib/pdf-utils.ts` (`PdfPresetOption`) |
