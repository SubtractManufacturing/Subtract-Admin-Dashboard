import type { QuoteWithRelations } from "~/lib/quotes";
import { formatCurrency, formatDate, commonPdfStyles } from "~/lib/pdf-utils";

interface QuotePdfTemplateProps {
  quote: QuoteWithRelations;
  editable?: boolean;
}

export function QuotePdfTemplate({ quote, editable = false }: QuotePdfTemplateProps) {

  const partsLineItems = (quote.lineItems || []).filter((item) => item.quotePartId !== null);
  const serviceLineItems = (quote.lineItems || []).filter((item) => item.quotePartId === null);

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

          .parts-section {
            padding: 20px 40px;
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

          .parts-subtotal-box {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            padding: 12px 20px;
            margin-top: 12px;
            width: 200px;
            margin-left: auto;
          }

          .parts-subtotal-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .parts-subtotal-label {
            font-size: 14px;
            font-weight: 700;
            color: #2c3e50;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .parts-subtotal-value {
            font-size: 18px;
            font-weight: 700;
            color: #c41e3a;
          }

          .financial-section {
            padding: 20px 40px 20px;
          }

          .financial-summary {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            padding: 12px 20px;
            margin-top: 12px;
            width: 200px;
            margin-left: auto;
          }

          .summary-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .summary-label {
            font-size: 14px;
            color: #2c3e50;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .summary-value {
            font-size: 18px;
            color: #c41e3a;
            font-weight: 700;
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
                <span className="value">{formatDate(quote.validUntil)}</span>
              </div>
            </div>
          </div>

          {/* Customer Details */}
          <div className="customer-details">
            <div className="detail-section">
              <h3>Bill To</h3>
              <p
                className={editable ? "primary editable" : "primary"}
                contentEditable={editable}
                suppressContentEditableWarning
              >
                {quote.customer?.displayName || ""}
              </p>
              <p
                className={editable ? "editable" : ""}
                contentEditable={editable}
                suppressContentEditableWarning
              >
                {quote.customer?.email || ""}
              </p>
              <p
                className={editable ? "editable" : ""}
                contentEditable={editable}
                suppressContentEditableWarning
              >
                Address Line 1
              </p>
              <p
                className={editable ? "editable" : ""}
                contentEditable={editable}
                suppressContentEditableWarning
              >
                City, State ZIP
              </p>
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
                  Net 30
                </span>
              </p>
              <p>
                FOB:{" "}
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  Origin
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
                    <th style={{ width: "15%" }}>Name</th>
                    <th style={{ width: "45%" }}>Description</th>
                    <th style={{ width: "30%" }}>Material</th>
                    <th style={{ width: "10%", textAlign: "center" }}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {partsLineItems.map((item, index) => {
                    const quotePart = (quote.parts || []).find((p) => p.id === item.quotePartId);
                    return (
                      <tr key={index}>
                        <td
                          className={editable ? "editable" : ""}
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          {item.name || quotePart?.partName || ""}
                        </td>
                        <td
                          className={editable ? "editable" : ""}
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          {item.description || quotePart?.description || ""}
                        </td>
                        <td
                          className={editable ? "editable" : ""}
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          {quotePart?.material || ""}
                        </td>
                        <td
                          className={editable ? "editable" : ""}
                          contentEditable={editable}
                          suppressContentEditableWarning
                          style={{ textAlign: "center" }}
                        >
                          {item.quantity}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Additional Services */}
          <div className="financial-section">
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

            {serviceLineItems.length > 0 && (
              <div className="line-items">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: "20%" }}>Item</th>
                      <th style={{ width: "60%" }}>Description</th>
                      <th style={{ width: "20%", textAlign: "right" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {serviceLineItems.map((item, index) => (
                      <tr key={index}>
                        <td
                          className={editable ? "editable" : ""}
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          {item.name || "Service"}
                        </td>
                        <td
                          className={editable ? "editable" : ""}
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          {item.description || ""}
                        </td>
                        <td
                          style={{ textAlign: "right" }}
                          className={editable ? "editable" : ""}
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          {formatCurrency(item.totalPrice)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
