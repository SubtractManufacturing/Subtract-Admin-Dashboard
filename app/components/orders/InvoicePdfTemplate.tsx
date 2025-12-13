import React, { useEffect } from "react";
import type { OrderWithRelations } from "~/lib/orders";
import type { QuoteWithRelations } from "~/lib/quotes";
import type { Part, OrderLineItem, QuoteLineItem } from "~/lib/db/schema";
import { formatCurrency, formatDate, commonPdfStyles } from "~/lib/pdf-utils";
import { extractShippingAddress, isAddressComplete } from "~/lib/address-utils";

interface InvoicePdfTemplateProps {
  entity: OrderWithRelations | QuoteWithRelations;
  lineItems?: (OrderLineItem | QuoteLineItem)[];
  parts?: (Part | null)[];
  editable?: boolean;
}

export function InvoicePdfTemplate({
  entity,
  lineItems = [],
  parts = [],
  editable = false,
}: InvoicePdfTemplateProps) {
  // Determine if this is an order or quote
  const isOrder = "orderNumber" in entity;
  const documentNumber = isOrder
    ? entity.orderNumber
    : (entity as QuoteWithRelations).quoteNumber;

  // Handle placeholder behavior for fields
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
          target.textContent = defaultText;
          target.classList.add("placeholder-text");
        } else if (currentText !== defaultText) {
          target.classList.remove("placeholder-text");
        } else {
          target.classList.add("placeholder-text");
        }
      }
    };

    const placeholders = document.querySelectorAll(".invoice-placeholder");
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
  }, [editable]);

  // Calculate total
  const calculateTotal = () => {
    if (isOrder) {
      const order = entity as OrderWithRelations;
      return parseFloat(order.totalPrice || "0");
    } else {
      const quote = entity as QuoteWithRelations;
      return parseFloat(quote.total || "0");
    }
  };

  const total = calculateTotal();

  return (
    <div className="invoice-pdf-container">
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
            justify-content: space-between;
          }

          .logo-section {
            flex-shrink: 0;
          }

          .logo-img {
            height: 50px;
            width: auto;
          }

          .invoice-title {
            flex: 1;
            text-align: center;
          }

          .invoice-title h2 {
            font-size: 26px;
            font-weight: 700;
            color: #c41e3a;
            margin: 0;
            letter-spacing: -0.5px;
          }

          .invoice-header-info {
            display: grid;
            grid-template-columns: repeat(5, 1fr);
            gap: 20px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #e1e4e8;
          }

          .invoice-header-info .info-item {
            display: flex;
            flex-direction: column;
          }

          .invoice-header-info .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6c757d;
            margin-bottom: 4px;
            font-weight: 600;
          }

          .invoice-header-info .value {
            font-size: 15px;
            font-weight: 600;
            color: #2c3e50;
          }

          .party-details {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 30px;
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

          .items-section {
            padding: 20px 40px;
            flex: 1;
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

          .items-section table {
            table-layout: auto;
            width: 100%;
          }

          .items-section th,
          .items-section td {
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }

          /* Column sizing for invoice items table */
          .items-section th:nth-child(1),
          .items-section td:nth-child(1) {
            width: auto;
            min-width: 200px;
          }

          .items-section th:nth-child(2),
          .items-section td:nth-child(2) {
            width: 80px;
            text-align: center;
            white-space: nowrap;
          }

          .items-section th:nth-child(3),
          .items-section td:nth-child(3) {
            width: 120px;
            text-align: right;
            white-space: nowrap;
          }

          .items-section th:nth-child(4),
          .items-section td:nth-child(4) {
            width: 120px;
            text-align: right;
            white-space: nowrap;
          }

          .items-section .notes-row td {
            padding: 8px 12px;
            border-top: none;
            background-color: #f8f9fa;
          }

          .items-section .notes-label {
            font-weight: 600;
            color: #6c757d;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-right: 8px;
          }

          .financial-section {
            padding: 20px 40px 20px;
          }

          .total-box {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            padding: 12px 20px;
            margin-top: 12px;
            width: max-content;
            min-width: 300px;
            margin-left: auto;
            display: grid;
            grid-template-columns: auto auto;
            gap: 8px 20px;
            align-items: center;
          }

          .total-row {
            display: contents;
          }

          .total-label {
            font-size: 14px;
            color: #2c3e50;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
          }

          .total-label.primary {
            font-weight: 700;
            font-size: 15px;
            padding-top: 8px;
            border-top: 2px solid #dee2e6;
          }

          .total-value {
            font-size: 16px;
            color: #2c3e50;
            font-weight: 600;
            white-space: nowrap;
            text-align: right;
          }

          .total-value.primary {
            font-size: 18px;
            color: #c41e3a;
            font-weight: 700;
            padding-top: 8px;
            border-top: 2px solid #dee2e6;
          }

          .notes-section {
            padding: 20px 40px;
            background-color: white;
          }

          .notes-section h3 {
            font-size: 14px;
            font-weight: 700;
            color: #2c3e50;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          .notes-content {
            font-size: 14px;
            color: #495057;
            line-height: 1.6;
            min-height: 60px;
            padding: 10px;
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 4px;
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
                  src="/subtract-logo.png"
                  alt="Subtract Manufacturing"
                  className="logo-img"
                />
              </div>
              <div className="invoice-title">
                <h2>INVOICE</h2>
              </div>
              <div style={{ width: "50px" }}></div>
            </div>
            <div className="invoice-header-info">
              <div className="info-item">
                <span className="label">Invoice Number</span>
                <span className="value">{documentNumber}</span>
              </div>
              <div className="info-item">
                <span className="label">PO Number</span>
                <span className="value">
                  <span
                    className={editable ? "editable invoice-placeholder" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                    data-default-text="N/A"
                  >
                    N/A
                  </span>
                </span>
              </div>
              <div className="info-item">
                <span className="label">Invoice Date</span>
                <span className="value">{formatDate(new Date())}</span>
              </div>
              <div className="info-item">
                <span className="label">Due Date</span>
                <span className="value">
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {isOrder && entity.shipDate
                      ? formatDate(entity.shipDate)
                      : "Net 30"}
                  </span>
                </span>
              </div>
              <div className="info-item">
                <span className="label">Payment Terms</span>
                <span className="value">
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {entity.customer?.paymentTerms || "Net 30"}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Party Details */}
          <div className="party-details">
            <div className="detail-section">
              <h3>From:</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  Subtract Manufacturing
                </span>
              </p>
              <p>
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  contact@subtractmanufacturing.com
                </span>
              </p>
              {editable && (
                <>
                  <p>
                    <span
                      className={editable ? "editable" : ""}
                      contentEditable={editable}
                      suppressContentEditableWarning
                    >
                      7301 S County Road 400W
                    </span>
                  </p>
                  <p>
                    <span
                      className={editable ? "editable" : ""}
                      contentEditable={editable}
                      suppressContentEditableWarning
                    >
                      Muncie, IN 47302
                    </span>
                  </p>
                </>
              )}
            </div>
            <div className="detail-section">
              <h3>Bill To:</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {entity.customer?.displayName ||
                    entity.customer?.companyName ||
                    "Customer Name"}
                </span>
              </p>
              {entity.customer?.contactName && (
                <p>
                  Contact:{" "}
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {entity.customer.contactName}
                  </span>
                </p>
              )}
              {entity.customer?.email && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {entity.customer.email}
                  </span>
                </p>
              )}
              {editable && !entity.customer?.email && (
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
              {entity.customer?.phone && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {entity.customer.phone}
                  </span>
                </p>
              )}
              {editable && !entity.customer?.phone && (
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
              {/* Billing Address */}
              {entity.customer &&
                (() => {
                  const billingAddress = extractShippingAddress(
                    entity.customer
                  );
                  const hasBillingAddress = isAddressComplete(billingAddress);

                  if (hasBillingAddress) {
                    return (
                      <>
                        {billingAddress.line1 && (
                          <p>
                            <span
                              className={editable ? "editable" : ""}
                              contentEditable={editable}
                              suppressContentEditableWarning
                            >
                              {billingAddress.line1}
                            </span>
                          </p>
                        )}
                        {billingAddress.line2 && (
                          <p>
                            <span
                              className={editable ? "editable" : ""}
                              contentEditable={editable}
                              suppressContentEditableWarning
                            >
                              {billingAddress.line2}
                            </span>
                          </p>
                        )}
                        <p>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {billingAddress.city}, {billingAddress.state}{" "}
                            {billingAddress.postalCode}
                          </span>
                        </p>
                        {billingAddress.country &&
                          billingAddress.country !== "US" && (
                            <p>
                              <span
                                className={editable ? "editable" : ""}
                                contentEditable={editable}
                                suppressContentEditableWarning
                              >
                                {billingAddress.country}
                              </span>
                            </p>
                          )}
                      </>
                    );
                  } else if (editable) {
                    return (
                      <p>
                        <span
                          className="editable placeholder-text"
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          Billing Address
                        </span>
                      </p>
                    );
                  }
                  return null;
                })()}
            </div>
            <div className="detail-section">
              <h3>Ship To:</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {entity.customer?.displayName ||
                    entity.customer?.companyName ||
                    "Customer Name"}
                </span>
              </p>
              {entity.customer?.contactName && (
                <p>
                  Contact:{" "}
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {entity.customer.contactName}
                  </span>
                </p>
              )}
              {entity.customer?.email && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {entity.customer.email}
                  </span>
                </p>
              )}
              {editable && !entity.customer?.email && (
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
              {entity.customer?.phone && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {entity.customer.phone}
                  </span>
                </p>
              )}
              {editable && !entity.customer?.phone && (
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
              {/* Shipping Address */}
              {entity.customer &&
                (() => {
                  const shippingAddress = extractShippingAddress(
                    entity.customer
                  );
                  const hasShippingAddress = isAddressComplete(shippingAddress);

                  if (hasShippingAddress) {
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
                        <p>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {shippingAddress.city}, {shippingAddress.state}{" "}
                            {shippingAddress.postalCode}
                          </span>
                        </p>
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
                  } else if (editable) {
                    return (
                      <p>
                        <span
                          className="editable placeholder-text"
                          contentEditable={editable}
                          suppressContentEditableWarning
                        >
                          Shipping Address
                        </span>
                      </p>
                    );
                  }
                  return null;
                })()}
            </div>
          </div>

          {/* Line Items */}
          <div className="items-section">
            <h2 className="section-title">Line Items</h2>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, index) => {
                  // Handle both OrderLineItem (partId) and QuoteLineItem (quotePartId)
                  const itemPartId =
                    "partId" in item
                      ? item.partId
                      : "quotePartId" in item
                      ? item.quotePartId
                      : null;
                  const part = parts.find((p) => p?.id === itemPartId);
                  const notesContent =
                    item.description || item.notes || part?.notes || "";
                  const unitPrice = parseFloat(
                    item.unitPrice?.toString() || "0"
                  );
                  const quantity = item.quantity || 0;
                  const itemTotal = unitPrice * quantity;

                  return (
                    <React.Fragment key={`line-item-${item.id || index}`}>
                      <tr>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.name || part?.partName || "Item"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {quantity}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {formatCurrency(unitPrice)}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {formatCurrency(itemTotal)}
                          </span>
                        </td>
                      </tr>
                      {notesContent && (
                        <tr className="notes-row">
                          <td colSpan={4}>
                            <span className="notes-label">Notes:</span>
                            <span
                              className={editable ? "editable" : ""}
                              contentEditable={editable}
                              suppressContentEditableWarning
                            >
                              {notesContent}
                            </span>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Financial Section */}
        <div className="financial-section">
          <div className="total-box">
            <div className="total-row">
              <span className="total-label">Subtotal</span>
              <span
                className={editable ? "total-value editable" : "total-value"}
                contentEditable={editable}
                suppressContentEditableWarning
              >
                {formatCurrency(total)}
              </span>
            </div>
            <div className="total-row">
              <span className="total-label">Amount Paid</span>
              <span
                className={
                  editable
                    ? "total-value editable invoice-placeholder"
                    : "total-value"
                }
                contentEditable={editable}
                suppressContentEditableWarning
                data-default-text="$0.00"
              >
                $0.00
              </span>
            </div>
            <div className="total-row">
              <span className="total-label primary">Amount Due</span>
              <span
                className={
                  editable
                    ? "total-value primary editable"
                    : "total-value primary"
                }
                contentEditable={editable}
                suppressContentEditableWarning
              >
                {formatCurrency(total)}
              </span>
            </div>
          </div>
        </div>

        {/* Notes Section */}
        <div className="notes-section">
          <h3>Notes</h3>
          <div
            className={editable ? "notes-content editable" : "notes-content"}
            contentEditable={editable}
            suppressContentEditableWarning
          >
            {(isOrder ? (entity as OrderWithRelations).notes : null) ||
              (editable ? "Additional notes or payment instructions..." : "")}
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
