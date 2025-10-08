import { useEffect } from "react";
import type { QuoteWithRelations } from "~/lib/quotes";
import { formatCurrency, formatDate, commonPdfStyles } from "~/lib/pdf-utils";

interface QuotePdfTemplateProps {
  quote: QuoteWithRelations;
  editable?: boolean;
}

export function QuotePdfTemplate({ quote, editable = false }: QuotePdfTemplateProps) {

  const partsLineItems = (quote.lineItems || []).filter((item) => item.quotePartId !== null);
  const serviceLineItems = (quote.lineItems || []).filter((item) => item.quotePartId === null);

  // Handle placeholder behavior for address fields
  useEffect(() => {
    if (!editable) return;

    const handlePlaceholderFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const defaultText = target.getAttribute('data-default-text');

      if (defaultText && target.textContent?.trim() === defaultText) {
        target.textContent = '';
      }
    };

    const handlePlaceholderBlur = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const defaultText = target.getAttribute('data-default-text');
      const currentText = target.textContent?.trim() || '';

      if (defaultText) {
        if (currentText === '') {
          // Restore placeholder if empty
          target.textContent = defaultText;
          target.classList.add('placeholder-text');
        } else if (currentText !== defaultText) {
          // Remove grey styling if text was customized
          target.classList.remove('placeholder-text');
        } else {
          // Keep grey styling if still default
          target.classList.add('placeholder-text');
        }
      }
    };

    const placeholders = document.querySelectorAll('.address-placeholder');
    placeholders.forEach((element) => {
      element.addEventListener('focus', handlePlaceholderFocus);
      element.addEventListener('blur', handlePlaceholderBlur);
    });

    return () => {
      placeholders.forEach((element) => {
        element.removeEventListener('focus', handlePlaceholderFocus);
        element.removeEventListener('blur', handlePlaceholderBlur);
      });
    };
  }, [editable]);

  // Sync widths of subtotal and total boxes
  useEffect(() => {
    const syncBoxWidths = () => {
      const subtotalBox = document.querySelector('.parts-subtotal-box') as HTMLElement;
      const totalBox = document.querySelector('.financial-summary') as HTMLElement;

      if (subtotalBox && totalBox) {
        // Reset widths to measure natural size
        subtotalBox.style.width = 'max-content';
        totalBox.style.width = 'max-content';

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

      const subtotalValue = document.querySelector('.parts-subtotal-value');
      const totalValue = document.querySelector('.summary-value');

      if (subtotalValue) {
        observer.observe(subtotalValue, { characterData: true, childList: true, subtree: true });
      }
      if (totalValue) {
        observer.observe(totalValue, { characterData: true, childList: true, subtree: true });
      }
    }

    return () => {
      clearTimeout(timeout);
      observer?.disconnect();
    };
  }, [quote, editable]);

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

  const partsSubtotal = partsLineItems.reduce(
    (sum, item) => sum + parseFloat(item.totalPrice?.toString() || "0"),
    0
  );

  const serviceTotal = serviceLineItems.reduce(
    (sum, item) => sum + parseFloat(item.totalPrice?.toString() || "0"),
    0
  );

  const grandTotal = partsSubtotal + serviceTotal;

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

          /* Smart column sizing for parts table */
          .parts-section th:nth-child(1),
          .parts-section td:nth-child(1) {
            width: auto;
            min-width: 80px;
            max-width: 150px;
          }

          .parts-section th:nth-child(2),
          .parts-section td:nth-child(2) {
            width: auto;
            min-width: 200px;
          }

          .parts-section th:nth-child(3),
          .parts-section td:nth-child(3) {
            width: auto;
            min-width: 120px;
            max-width: 200px;
          }

          .parts-section th:nth-child(4),
          .parts-section td:nth-child(4) {
            width: 60px;
            text-align: center;
            white-space: nowrap;
          }

          /* Smart column sizing for services table */
          .line-items th:nth-child(1),
          .line-items td:nth-child(1) {
            width: auto;
            min-width: 100px;
            max-width: 180px;
          }

          .line-items th:nth-child(2),
          .line-items td:nth-child(2) {
            width: auto;
            min-width: 250px;
          }

          .line-items th:nth-child(3),
          .line-items td:nth-child(3) {
            width: auto;
            min-width: 100px;
            max-width: 150px;
            text-align: right;
            white-space: nowrap;
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

          .services-header .parts-subtotal-box {
            margin-top: 0;
            margin-left: 0;
            flex-shrink: 0;
          }

          .footer {
            background-color: #f8f9fa;
            color: #495057;
            padding: 12px 10px;
            border-top: 3px solid #c41e3a;
            text-align: center;
          }

          .footer p {
            font-size: 12px;
            margin-bottom: 4px;
            line-height: 1.4;
          }

          .footer .contact-info {
            font-size: 13px;
            margin-top: 4px;
            font-weight: 600;
            color: #2c3e50;
          }

          .footer strong {
            color: #c41e3a;
          }
        `}
      </style>

      <div className="document-container">
        <div className="content-wrapper">
          {/* Header */}
          <div className="header">
            <div className="header-top">
              <div className="logo-section">
                <img
                  src="https://subtractmanufacturing.com/wp-content/uploads/2025/05/subtract_logo_01_social-small-red.png"
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
                <span className="value">{formatDate(quote.createdAt)}</span>
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
              <h3>Bill To</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {quote.customer?.displayName || ""}
                </span>
              </p>
              <p>
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {quote.customer?.email || ""}
                </span>
              </p>
              {editable && (
                <>
                  <p>
                    <span
                      className="editable placeholder-text address-placeholder"
                      contentEditable={editable}
                      suppressContentEditableWarning
                      data-default-text="Address Line 1"
                    >
                      Address Line 1
                    </span>
                  </p>
                  <p>
                    <span
                      className="editable placeholder-text address-placeholder"
                      contentEditable={editable}
                      suppressContentEditableWarning
                      data-default-text="City, State ZIP"
                    >
                      City, State ZIP
                    </span>
                  </p>
                </>
              )}
            </div>
            <div className="detail-section">
              <h3>Shipping Information</h3>
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
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  10-12 business days
                </span>
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
              <h2 className="section-title">Parts Specification</h2>
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Material</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {partsLineItems.map((item, index) => {
                    const quotePart = (quote.parts || []).find((p) => p.id === item.quotePartId);
                    return (
                      <tr key={index}>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.name || quotePart?.partName || ""}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.description || quotePart?.description || ""}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {quotePart?.material || ""}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.quantity}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Additional Services */}
        <div className="financial-section">
          {serviceLineItems.length > 0 && (
            <>
              <div className="services-header">
                <h2 className="secondary-section-title">Additional Services</h2>
                {partsLineItems.length > 0 && (
                  <div className="parts-subtotal-box">
                    <div className="parts-subtotal-row">
                      <span className="parts-subtotal-label">Subtotal</span>
                      <span
                        className={
                          editable ? "parts-subtotal-value editable" : "parts-subtotal-value"
                        }
                        contentEditable={editable}
                        suppressContentEditableWarning
                      >
                        {formatCurrency(partsSubtotal)}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="line-items">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Description</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceLineItems.map((item, index) => (
                      <tr key={index}>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.name || "Service"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.description || ""}
                          </span>
                        </td>
                        <td>
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
                className={editable ? "summary-value editable" : "summary-value"}
                contentEditable={editable}
                suppressContentEditableWarning
              >
                {formatCurrency(grandTotal)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="footer">
          <div className="contact-info">
            <strong>Subtract Manufacturing</strong> |{" "}
            <span
              className={editable ? "editable" : ""}
              contentEditable={editable}
              suppressContentEditableWarning
            >
              contact@subtractmanufacturing.com
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
