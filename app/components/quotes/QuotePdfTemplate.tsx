import { Fragment, useEffect, type CSSProperties } from "react";
import type { QuoteWithRelations } from "~/lib/quotes";
import {
  formatCurrency,
  formatDate,
  commonPdfStyles,
  type PdfPresetOption,
} from "~/lib/pdf-utils";
import {
  addBusinessDays,
  formatLeadTimeBusinessDays,
  startOfTodayInAppTz,
} from "~/lib/business-days";
import { formatDateForDisplay } from "~/lib/date-display";
import {
  extractShippingAddress,
  isAddressMeaningfullyEmpty,
} from "~/lib/address-utils";

export const QUOTE_PDF_PRESETS = [
  { id: "lineItemPricing", label: "Line item pricing" },
  { id: "default", label: "Total only" },
] as const satisfies readonly PdfPresetOption[];

export type QuotePdfPresetId = (typeof QUOTE_PDF_PRESETS)[number]["id"];

function getQuotePresetFields(
  presetId: QuotePdfPresetId,
  ctx: { partsSubtotal: number; grandTotal: number },
) {
  const base = {
    partsSubtotalDisplay: formatCurrency(ctx.partsSubtotal),
    grandTotalDisplay: formatCurrency(ctx.grandTotal),
    showLinePricing: false,
  };
  switch (presetId) {
    case "lineItemPricing":
      return { ...base, showLinePricing: true };
    case "default":
    default:
      return base;
  }
}

function formatPartsLineItemDescription(
  item: { description?: string | null; notes?: string | null },
  quotePart?: { description?: string | null },
): string {
  const segments = [item.description, item.notes]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (segments.length > 0) return segments.join("\n");
  return quotePart?.description?.trim() || "";
}

/** Render typed-out plus/minus ("+/-", "+-", "-/+") as the ± symbol. */
function formatTolerance(tolerance: string | null | undefined) {
  return tolerance?.replace(/\+\s*\/?\s*-|-\s*\/\s*\+/g, "±");
}

// Bottom page margin reserved for the per-page footer: the ~0.45in footer
// bar plus a gap so content never runs into it.
const PAGE_FOOTER_MARGIN = "0.75in";

const footerStyles = {
  bar: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: "12px",
    width: "100%",
    boxSizing: "border-box",
    padding: "12px 40px",
    backgroundColor: "#f8f9fa",
    borderTop: "3px solid #c41e3a",
    fontFamily: '"Segoe UI", Tahoma, Geneva, Verdana, sans-serif',
    fontSize: "13px",
    lineHeight: 1.4,
    color: "#2c3e50",
    WebkitPrintColorAdjust: "exact",
    printColorAdjust: "exact",
  },
  side: { fontSize: "11px", color: "#6c757d" },
  contact: { fontWeight: 600, textAlign: "center" },
  brand: { color: "#c41e3a" },
} satisfies Record<string, CSSProperties>;

interface QuotePdfTemplateProps {
  quote: QuoteWithRelations;
  editable?: boolean;
  presetId?: QuotePdfPresetId;
}

export function QuotePdfTemplate({
  quote,
  editable = false,
  presetId = "default",
}: QuotePdfTemplateProps) {
  const partsLineItems = (quote.lineItems || []).filter(
    (item) => item.quotePartId !== null
  );
  const serviceLineItems = (quote.lineItems || []).filter(
    (item) => item.quotePartId === null
  );

  // Handle placeholder behavior for address fields
  useEffect(() => {
    if (!editable) return;

    const handlePlaceholderFocus = (e: Event) => {
      const target = e.target as HTMLElement;
      const defaultText = target.getAttribute("data-default-text");

      if (defaultText && target.textContent?.trim() === defaultText) {
        target.textContent = "";
      }
    };

    const handlePlaceholderBlur = (e: Event) => {
      const target = e.target as HTMLElement;
      const defaultText = target.getAttribute("data-default-text");
      const currentText = target.textContent?.trim() || "";

      if (defaultText) {
        if (currentText === "") {
          // Restore placeholder if empty
          target.textContent = defaultText;
          target.classList.add("placeholder-text");
        } else if (currentText !== defaultText) {
          // Remove grey styling if text was customized
          target.classList.remove("placeholder-text");
        } else {
          // Keep grey styling if still default
          target.classList.add("placeholder-text");
        }
      }
    };

    const placeholders = document.querySelectorAll(".address-placeholder");
    placeholders.forEach((element) => {
      element.addEventListener("focus", handlePlaceholderFocus);
      element.addEventListener("blur", handlePlaceholderBlur);
    });

    return () => {
      placeholders.forEach((element) => {
        element.removeEventListener("focus", handlePlaceholderFocus);
        element.removeEventListener("blur", handlePlaceholderBlur);
      });
    };
  }, [editable, presetId]);

  // Sync widths of subtotal and total boxes
  useEffect(() => {
    const syncBoxWidths = () => {
      const subtotalBox = document.querySelector(
        ".parts-subtotal-box"
      ) as HTMLElement;
      const totalBox = document.querySelector(
        ".financial-summary"
      ) as HTMLElement;

      if (subtotalBox && totalBox) {
        // Reset widths to measure natural size
        subtotalBox.style.width = "max-content";
        totalBox.style.width = "max-content";

        // Get the natural widths
        const subtotalWidth = subtotalBox.offsetWidth;
        const totalWidth = totalBox.offsetWidth;

        // Set both to the larger width
        const maxWidth = Math.max(subtotalWidth, totalWidth);
        subtotalBox.style.width = `${maxWidth}px`;
        totalBox.style.width = `${maxWidth}px`;
      }
    };

    // Sync on mount and after a short delay to ensure content is rendered
    syncBoxWidths();
    const timeout = setTimeout(syncBoxWidths, 100);

    // Watch for content changes when editable
    let observer: MutationObserver | null = null;
    if (editable) {
      observer = new MutationObserver(() => {
        syncBoxWidths();
      });

      const subtotalValue = document.querySelector(".parts-subtotal-value");
      const totalValue = document.querySelector(".summary-value");

      if (subtotalValue) {
        observer.observe(subtotalValue, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
      if (totalValue) {
        observer.observe(totalValue, {
          characterData: true,
          childList: true,
          subtree: true,
        });
      }
    }

    return () => {
      clearTimeout(timeout);
      observer?.disconnect();
    };
  }, [quote, editable, presetId]);

  // Calculate valid until date
  const calculateValidUntil = () => {
    if (quote.validUntil) {
      return formatDate(quote.validUntil);
    }

    const expirationDays = quote.expirationDays;

    if (expirationDays) {
      // Calculate the actual date by adding expiration days to created date
      const createdDate = new Date(quote.createdAt);
      const validUntilDate = new Date(createdDate);
      validUntilDate.setDate(validUntilDate.getDate() + expirationDays);
      return formatDate(validUntilDate);
    }

    return "14 days from Issue";
  };

  const validUntilDisplay = calculateValidUntil();

  const estimatedDeliveryDisplay = (() => {
    const min = quote.leadTimeBusinessDaysMin;
    const max = quote.leadTimeBusinessDaysMax;
    if (min == null || max == null) return null;
    const today = startOfTodayInAppTz();
    const end = addBusinessDays(today, max);
    return {
      date: formatDateForDisplay(end, { includeTimeZoneLabel: false }),
      leadTime: `${formatLeadTimeBusinessDays(min, max)} (ARO)`,
    };
  })();

  const partsSubtotal = partsLineItems.reduce(
    (sum, item) => sum + parseFloat(item.totalPrice?.toString() || "0"),
    0
  );

  const serviceTotal = serviceLineItems.reduce(
    (sum, item) => sum + parseFloat(item.totalPrice?.toString() || "0"),
    0
  );

  /** Prefer stored line total; fall back to qty × unit so discounts are detected reliably. */
  const nonPartLineExtended = (item: (typeof serviceLineItems)[number]) => {
    const tpRaw = item.totalPrice?.toString() ?? "";
    const fromTotal = parseFloat(tpRaw);
    if (tpRaw !== "" && !Number.isNaN(fromTotal)) return fromTotal;
    const unit = parseFloat(item.unitPrice?.toString() || "0") || 0;
    return unit * (item.quantity || 0);
  };

  const hasDiscountOnServiceLines = serviceLineItems.some(
    (item) => nonPartLineExtended(item) < 0
  );

  const grandTotal = partsSubtotal + serviceTotal;
  const quotePresetFields = getQuotePresetFields(presetId, {
    partsSubtotal,
    grandTotal,
  });

  return (
    <div className="quote-pdf-container">
      <style>
        {`
          ${commonPdfStyles}

          .content-wrapper {
            flex: 1;
          }

          .header {
            padding: 10px 40px 5px;
            background: white;
          }

          .header-top {
            position: relative;
            margin-bottom: 15px;
            min-height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
          }

          .logo-section {
            position: absolute;
            left: 0;
            top: 0;
          }

          .logo-img {
            height: 50px;
            width: auto;
          }

          .company-text {
            text-align: center;
          }

          .company-text h1 {
            font-size: 28px;
            font-weight: 700;
            color: #2c3e50;
            margin: 0;
            letter-spacing: -0.5px;
          }

          .quote-title {
            position: absolute;
            top: 0;
            right: 0;
          }

          .quote-title h2 {
            font-size: 32px;
            font-weight: 700;
            color: #c41e3a;
            margin: 0;
            letter-spacing: -0.5px;
          }

          /* NDA tag sits at the right end of the Parts Specification title. */
          .parts-title {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
          }

          .nda-tag {
            padding: 1px 8px;
            border: 1.5px solid #c41e3a;
            border-radius: 3px;
            color: #c41e3a;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            text-align: center;
            white-space: nowrap;
          }

          .quote-header-info {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #e1e4e8;
          }

          .quote-header-info .info-item {
            display: flex;
            flex-direction: column;
          }

          .quote-header-info .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6c757d;
            margin-bottom: 4px;
            font-weight: 600;
          }

          .quote-header-info .value {
            font-size: 15px;
            font-weight: 600;
            color: #2c3e50;
          }

          .customer-details {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 40px;
            padding: 20px 40px;
            background-color: white;
            border-bottom: 3px solid #c41e3a;
          }

          .detail-section h3 {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #495057;
            margin-bottom: 10px;
            font-weight: 700;
            border-bottom: 2px solid #c41e3a;
            padding-bottom: 6px;
          }

          .detail-section p {
            color: #495057;
            font-size: 14px;
            margin-bottom: 3px;
            line-height: 1.4;
          }

          .detail-section .primary {
            font-weight: 700;
            font-size: 15px;
            color: #2c3e50;
            margin-bottom: 5px;
          }

          .placeholder-text {
            color: #9ca3af;
            font-style: italic;
          }

          /* Keep the edit affordance padding without shifting text: offset it
             with a matching negative margin, and repeat it on wrapped lines. */
          .editable {
            margin: -2px -4px;
            -webkit-box-decoration-break: clone;
            box-decoration-break: clone;
          }

          .parts-section {
            padding: 20px 40px;
          }

          .parts-section table,
          .line-items table {
            table-layout: auto;
            width: 100%;
          }

          .parts-section th,
          .parts-section td,
          .line-items th,
          .line-items td {
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }

          /* Parts and services share one ruled ERP-style table style. */
          .parts-table th,
          .parts-table td,
          .services-table th,
          .services-table td {
            padding: 6px 10px;
            vertical-align: middle;
            border-right: none;
          }

          .parts-table .col-line,
          .parts-table .col-num,
          .services-table .col-num {
            width: 1%;
            white-space: nowrap;
          }

          .parts-table .col-num,
          .services-table .col-num {
            text-align: right;
            font-variant-numeric: tabular-nums;
          }

          .services-table .col-item {
            width: 35%;
          }

          .services-table .col-description {
            font-size: 13px;
            line-height: 1.4;
            white-space: pre-wrap;
          }

          .parts-table .col-line {
            text-align: center;
            color: #6c757d;
          }

          .parts-table .col-part,
          .parts-table .col-specs {
            overflow-wrap: anywhere;
          }

          /* Part and specs split whatever the numeric columns leave over. */
          .parts-table .col-part,
          .parts-table .col-specs {
            width: 50%;
          }

          .parts-table tbody tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .part-name {
            font-weight: 700;
            color: #2c3e50;
          }

          .part-description {
            font-size: 13px;
            line-height: 1.4;
            white-space: pre-wrap;
          }

          .part-specs {
            display: grid;
            grid-template-columns: max-content 1fr;
            column-gap: 10px;
            font-size: 13px;
            line-height: 1.4;
          }

          .part-spec-label {
            color: #6c757d;
            font-weight: 600;
          }

          .part-spec-value {
            color: #2c3e50;
            white-space: pre-wrap;
          }

          .section-title {
            font-size: 16px;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 12px;
            padding-bottom: 6px;
            border-bottom: 2px solid #c41e3a;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .secondary-section-title {
            font-size: 16px;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 12px;
            padding-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .parts-subtotal-box,
          .financial-summary {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            padding: 8px 16px;
            margin-top: 12px;
            width: max-content;
            min-width: 200px;
            margin-left: auto;
            display: grid;
            grid-template-columns: auto auto;
            gap: 16px;
            align-items: center;
          }

          .parts-subtotal-row,
          .summary-row {
            display: contents;
          }

          .parts-subtotal-label,
          .summary-label {
            font-size: 12px;
            color: #2c3e50;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
          }

          .parts-subtotal-value,
          .summary-value {
            font-size: 16px;
            color: #c41e3a;
            font-weight: 700;
            white-space: nowrap;
            text-align: right;
          }

          .financial-section {
            padding: 20px 40px 20px;
          }

          .services-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 12px;
            gap: 20px;
          }

          .services-header .secondary-section-title {
            margin-bottom: 0;
            flex-shrink: 0;
          }

          .parts-section .parts-subtotal-box {
            margin-top: 0;
          }

          /* Only meaningful in the generated PDF (quote no., page numbers). */
          .pdf-only {
            visibility: hidden;
          }

          /* Keep totals and section headings attached to their content
             across page breaks. */
          .parts-section .parts-subtotal-box,
          .financial-summary {
            break-before: avoid;
            page-break-before: avoid;
          }

          .services-header {
            break-after: avoid;
            page-break-after: avoid;
          }

          .services-table tbody tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          /* The per-page footer lives in the bottom margin; continuation
             pages get breathing room at the top. */
          @page {
            margin: 0.4in 0 ${PAGE_FOOTER_MARGIN} 0;
          }

          @page :first {
            margin-top: 0;
          }

          @media print {
            .document-container {
              min-height: calc(11in - ${PAGE_FOOTER_MARGIN});
            }
          }
        `}
      </style>

      <div className="document-container" key={presetId}>
        <div className="content-wrapper">
          {/* Header */}
          <div className="header">
            <div className="header-top">
              <div className="logo-section">
                <img
                  src="/subtract-logo.png"
                  alt="Subtract Manufacturing"
                  className="logo-img"
                />
              </div>
              <div className="company-text">
                <h1>Subtract Manufacturing</h1>
              </div>
              <div className="quote-title">
                <h2>QUOTE</h2>
              </div>
            </div>
            <div className="quote-header-info">
              <div className="info-item">
                <span className="label">Quote Number</span>
                <span className="value">{quote.quoteNumber}</span>
              </div>
              <div className="info-item">
                <span className="label">Issue Date</span>
                <span className="value">{formatDate(new Date())}</span>
              </div>
              <div className="info-item">
                <span className="label">Valid Until</span>
                <span className="value">
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {validUntilDisplay}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Customer Details */}
          <div className="customer-details">
            <div className="detail-section">
              <h3>Customer</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {quote.customer?.displayName ||
                    quote.customer?.companyName ||
                    ""}
                </span>
              </p>
              {quote.customer?.email && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {quote.customer.email}
                  </span>
                </p>
              )}
              {editable && !quote.customer?.email && (
                <p>
                  <span
                    className="editable placeholder-text"
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    Email
                  </span>
                </p>
              )}
              {quote.customer?.phone && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {quote.customer.phone}
                  </span>
                </p>
              )}
              {editable && !quote.customer?.phone && (
                <p>
                  <span
                    className="editable placeholder-text"
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    Phone
                  </span>
                </p>
              )}
              {(quote.customer || editable) &&
                (() => {
                  const shippingAddress = quote.customer
                    ? extractShippingAddress(quote.customer)
                    : null;
                  const hasShippingLines =
                    shippingAddress != null &&
                    !isAddressMeaningfullyEmpty(shippingAddress);

                  if (hasShippingLines && shippingAddress) {
                    const cityStatePart = [
                      shippingAddress.city,
                      shippingAddress.state,
                    ]
                      .filter(Boolean)
                      .join(", ");
                    const cityStateZip = [
                      cityStatePart,
                      shippingAddress.postalCode?.trim() || "",
                    ]
                      .filter(Boolean)
                      .join(" ");

                    return (
                      <>
                        {shippingAddress.line1 && (
                          <p>
                            <span
                              className={editable ? "editable" : ""}
                              contentEditable={editable}
                              suppressContentEditableWarning
                            >
                              {shippingAddress.line1}
                            </span>
                          </p>
                        )}
                        {shippingAddress.line2 && (
                          <p>
                            <span
                              className={editable ? "editable" : ""}
                              contentEditable={editable}
                              suppressContentEditableWarning
                            >
                              {shippingAddress.line2}
                            </span>
                          </p>
                        )}
                        {cityStateZip && (
                          <p>
                            <span
                              className={editable ? "editable" : ""}
                              contentEditable={editable}
                              suppressContentEditableWarning
                            >
                              {cityStateZip}
                            </span>
                          </p>
                        )}
                        {shippingAddress.country &&
                          shippingAddress.country !== "US" && (
                            <p>
                              <span
                                className={editable ? "editable" : ""}
                                contentEditable={editable}
                                suppressContentEditableWarning
                              >
                                {shippingAddress.country}
                              </span>
                            </p>
                          )}
                      </>
                    );
                  }

                  if (editable) {
                    return (
                      <p>
                        <span
                          className="editable placeholder-text address-placeholder"
                          contentEditable={editable}
                          suppressContentEditableWarning
                          data-default-text="Shipping address"
                        >
                          Shipping address
                        </span>
                      </p>
                    );
                  }

                  return null;
                })()}
            </div>
            <div className="detail-section">
              <h3>Shipping details</h3>
              <p className="primary">
                Method:{" "}
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  Ground
                </span>
              </p>
              <p>
                Lead Time:{" "}
                <span>{estimatedDeliveryDisplay?.leadTime ?? "TBD"}</span>
              </p>
              <p>
                Estimated Delivery:{" "}
                <span>{estimatedDeliveryDisplay?.date ?? "TBD"}</span>
              </p>
              <p>
                Terms:{" "}
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  Payment in Advance
                </span>
              </p>
            </div>
          </div>

          {/* Parts Specification */}
          {partsLineItems.length > 0 && (
            <div className="parts-section">
              <h2 className="section-title parts-title">
                Parts Specification
                {quote.ndaRequired && (
                  <span className="nda-tag">Confidential · NDA</span>
                )}
              </h2>
              <table className="parts-table">
                <thead>
                  <tr>
                    <th className="col-line">#</th>
                    <th className="col-part">Part</th>
                    <th className="col-specs">Specifications</th>
                    <th className="col-num">Qty</th>
                    {quotePresetFields.showLinePricing && (
                      <>
                        <th className="col-num">Unit Price</th>
                        <th className="col-num">Amount</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {partsLineItems.map((item, index) => {
                    const quotePart = (quote.parts || []).find(
                      (p) => p.id === item.quotePartId
                    );
                    const description = formatPartsLineItemDescription(
                      item,
                      quotePart
                    );
                    const specs = [
                      { label: "Material", value: quotePart?.material },
                      {
                        label: "Global Tolerance",
                        value: formatTolerance(quotePart?.tolerance),
                      },
                      { label: "Finish", value: quotePart?.finish },
                    ].filter((spec) => spec.value || editable);

                    return (
                      <tr key={item.id}>
                        <td className="col-line">{index + 1}</td>
                        <td className="col-part">
                          <div className="part-name">
                            <span
                              className={editable ? "editable" : ""}
                              contentEditable={editable}
                              suppressContentEditableWarning
                            >
                              {item.name || quotePart?.partName || ""}
                            </span>
                          </div>
                          {(description || editable) && (
                            <div className="part-description">
                              <span
                                className={editable ? "editable" : ""}
                                contentEditable={editable}
                                suppressContentEditableWarning
                              >
                                {description}
                              </span>
                            </div>
                          )}
                        </td>
                        <td className="col-specs">
                          {specs.length > 0 && (
                            <div className="part-specs">
                              {specs.map((spec) => (
                                <Fragment key={spec.label}>
                                  <span className="part-spec-label">
                                    {spec.label}
                                  </span>
                                  <span className="part-spec-value">
                                    <span
                                      className={editable ? "editable" : ""}
                                      contentEditable={editable}
                                      suppressContentEditableWarning
                                    >
                                      {spec.value || ""}
                                    </span>
                                  </span>
                                </Fragment>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="col-num">
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.quantity}
                          </span>
                        </td>
                        {quotePresetFields.showLinePricing && (
                          <>
                            <td className="col-num">
                              <span
                                className={editable ? "editable" : ""}
                                contentEditable={editable}
                                suppressContentEditableWarning
                              >
                                {formatCurrency(item.unitPrice)}
                              </span>
                            </td>
                            <td className="col-num">
                              <span
                                className={editable ? "editable" : ""}
                                contentEditable={editable}
                                suppressContentEditableWarning
                              >
                                {formatCurrency(item.totalPrice)}
                              </span>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {serviceLineItems.length > 0 && (
                <div className="parts-subtotal-box">
                  <div className="parts-subtotal-row">
                    <span className="parts-subtotal-label">Subtotal</span>
                    <span
                      className={
                        editable
                          ? "parts-subtotal-value editable"
                          : "parts-subtotal-value"
                      }
                      contentEditable={editable}
                      suppressContentEditableWarning
                    >
                      {quotePresetFields.partsSubtotalDisplay}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Additional Services */}
        <div className="financial-section">
          {serviceLineItems.length > 0 && (
            <>
              <div className="services-header">
                <h2 className="secondary-section-title">
                  {hasDiscountOnServiceLines
                    ? "Services and adjustments"
                    : "Additional Services"}
                </h2>
              </div>

              <div className="line-items">
                <table className="services-table">
                  <thead>
                    <tr>
                      <th className="col-item">Item</th>
                      <th>Description</th>
                      <th className="col-num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceLineItems.map((item, index) => (
                      <tr key={index}>
                        <td className="col-item">
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.name || "Service"}
                          </span>
                        </td>
                        <td className="col-description">
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.description || ""}
                          </span>
                        </td>
                        <td className="col-num">
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {formatCurrency(item.totalPrice)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Summary */}
          <div className="financial-summary">
            <div className="summary-row">
              <span className="summary-label">TOTAL</span>
              <span
                className={
                  editable ? "summary-value editable" : "summary-value"
                }
                contentEditable={editable}
                suppressContentEditableWarning
              >
                {quotePresetFields.grandTotalDisplay}
              </span>
            </div>
          </div>
        </div>

        {/* Footer: the PDF generator lifts this into every page's bottom
            margin, where page CSS doesn't apply, so it is styled inline. */}
        <div data-pdf-page-footer={PAGE_FOOTER_MARGIN} style={footerStyles.bar}>
          <span className="pdf-only" style={footerStyles.side}>
            Quote {quote.quoteNumber}
            {quote.ndaRequired && " · NDA"}
          </span>
          <span style={footerStyles.contact}>
            <strong style={footerStyles.brand}>Subtract Manufacturing</strong>{" "}
            |{" "}
            <span
              className={editable ? "editable" : ""}
              contentEditable={editable}
              suppressContentEditableWarning
            >
              contact@subtractmanufacturing.com
            </span>
          </span>
          <span
            className="pdf-only"
            style={{ ...footerStyles.side, textAlign: "right" }}
          >
            Page <span className="pageNumber" /> of{" "}
            <span className="totalPages" />
          </span>
        </div>
      </div>
    </div>
  );
}
