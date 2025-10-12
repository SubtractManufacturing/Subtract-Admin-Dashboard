import { useEffect } from "react";
import type { OrderWithRelations } from "~/lib/orders";
import type { Part, OrderLineItem } from "~/lib/db/schema";
import { formatCurrency, formatDate, commonPdfStyles } from "~/lib/pdf-utils";
import { extractShippingAddress, isAddressComplete } from "~/lib/address-utils";

interface PurchaseOrderPdfTemplateProps {
  order: OrderWithRelations;
  lineItems?: OrderLineItem[];
  parts?: (Part | null)[];
  editable?: boolean;
}

export function PurchaseOrderPdfTemplate({
  order,
  lineItems = [],
  parts = [],
  editable = false
}: PurchaseOrderPdfTemplateProps) {

  // Handle placeholder behavior for fields
  useEffect(() => {
    if (!editable) return;

    const handlePlaceholderFocus = (e: Event) => {
      const target = e.target as HTMLElement;
      const defaultText = target.getAttribute('data-default-text');

      if (defaultText && target.textContent?.trim() === defaultText) {
        target.textContent = '';
      }
    };

    const handlePlaceholderBlur = (e: Event) => {
      const target = e.target as HTMLElement;
      const defaultText = target.getAttribute('data-default-text');
      const currentText = target.textContent?.trim() || '';

      if (defaultText) {
        if (currentText === '') {
          target.textContent = defaultText;
          target.classList.add('placeholder-text');
        } else if (currentText !== defaultText) {
          target.classList.remove('placeholder-text');
        } else {
          target.classList.add('placeholder-text');
        }
      }
    };

    const placeholders = document.querySelectorAll('.po-placeholder');
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

  return (
    <div className="po-pdf-container">
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

          .po-title {
            flex: 1;
            text-align: center;
          }

          .po-title h2 {
            font-size: 26px;
            font-weight: 700;
            color: #c41e3a;
            margin: 0;
            letter-spacing: -0.5px;
          }

          .po-header-info {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #e1e4e8;
          }

          .po-header-info .info-item {
            display: flex;
            flex-direction: column;
          }

          .po-header-info .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6c757d;
            margin-bottom: 4px;
            font-weight: 600;
          }

          .po-header-info .value {
            font-size: 15px;
            font-weight: 600;
            color: #2c3e50;
          }

          .vendor-details {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 20px;
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

          .parts-section table {
            table-layout: auto;
            width: 100%;
          }

          .parts-section th,
          .parts-section td {
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
          }

          /* Column sizing for PO parts table */
          .parts-section th:nth-child(1),
          .parts-section td:nth-child(1) {
            width: auto;
            min-width: 120px;
            max-width: 180px;
          }

          .parts-section th:nth-child(2),
          .parts-section td:nth-child(2) {
            width: 50px;
            text-align: center;
            white-space: nowrap;
          }

          .parts-section th:nth-child(3),
          .parts-section td:nth-child(3) {
            width: auto;
            min-width: 100px;
            max-width: 140px;
          }

          .parts-section th:nth-child(4),
          .parts-section td:nth-child(4) {
            width: auto;
            min-width: 100px;
            max-width: 140px;
          }

          .parts-section th:nth-child(5),
          .parts-section td:nth-child(5) {
            width: auto;
            min-width: 100px;
            max-width: 140px;
          }

          .parts-section th:nth-child(6),
          .parts-section td:nth-child(6) {
            width: 80px;
            text-align: center;
            white-space: nowrap;
          }

          .parts-section .notes-row td {
            padding: 8px 12px;
            border-top: none;
            background-color: #f8f9fa;
          }

          .parts-section .notes-label {
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
            min-width: 250px;
            margin-left: auto;
            display: grid;
            grid-template-columns: auto auto;
            gap: 20px;
            align-items: center;
          }

          .total-row {
            display: contents;
          }

          .total-label {
            font-size: 14px;
            color: #2c3e50;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            white-space: nowrap;
          }

          .total-value {
            font-size: 18px;
            color: #c41e3a;
            font-weight: 700;
            white-space: nowrap;
            text-align: right;
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
              <div className="po-title">
                <h2>PURCHASE ORDER</h2>
              </div>
              <div style={{ width: "50px" }}></div>
            </div>
            <div className="po-header-info">
              <div className="info-item">
                <span className="label">PO Number</span>
                <span className="value">{order.orderNumber}</span>
              </div>
              <div className="info-item">
                <span className="label">Issue Date</span>
                <span className="value">{formatDate(order.createdAt)}</span>
              </div>
              <div className="info-item">
                <span className="label">Ship Date</span>
                <span className="value">
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.shipDate ? formatDate(order.shipDate) : "TBD"}
                  </span>
                </span>
              </div>
            </div>
          </div>

          {/* Vendor Details */}
          <div className="vendor-details">
            <div className="detail-section">
              <h3>From: Subtract Manufacturing</h3>
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
                      +1 (317) 224-4251
                    </span>
                  </p>
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
              <h3>To: Vendor / Shop</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {order.vendor?.displayName || order.vendor?.companyName || "Vendor Name"}
                </span>
              </p>
              {order.vendor?.contactName && (
                <p>
                  Contact:{" "}
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.vendor.contactName}
                  </span>
                </p>
              )}
              {order.vendor?.email && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.vendor.email}
                  </span>
                </p>
              )}
              {editable && !order.vendor?.email && (
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
              {order.vendor?.phone && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.vendor.phone}
                  </span>
                </p>
              )}
              {editable && !order.vendor?.phone && (
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
              {order.vendor && (() => {
                const shippingAddress = extractShippingAddress(order.vendor);
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
                          {shippingAddress.city}, {shippingAddress.state} {shippingAddress.postalCode}
                        </span>
                      </p>
                      {shippingAddress.country && shippingAddress.country !== "US" && (
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
                } else if (order.vendor?.address) {
                  // Fallback to legacy address field if no structured address
                  return (
                    <p>
                      <span
                        className={editable ? "editable" : ""}
                        contentEditable={editable}
                        suppressContentEditableWarning
                      >
                        {order.vendor.address}
                      </span>
                    </p>
                  );
                } else if (editable) {
                  // Show placeholder only in editable mode
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
            <div className="detail-section">
              <h3>Deliver To: Customer</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {order.customer?.displayName || order.customer?.companyName || "Customer Name"}
                </span>
              </p>
              {order.customer?.contactName && (
                <p>
                  Contact:{" "}
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.customer.contactName}
                  </span>
                </p>
              )}
              {order.customer?.email && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.customer.email}
                  </span>
                </p>
              )}
              {editable && !order.customer?.email && (
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
              {order.customer?.phone && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.customer.phone}
                  </span>
                </p>
              )}
              {editable && !order.customer?.phone && (
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
              {order.customer && (() => {
                const shippingAddress = extractShippingAddress(order.customer);
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
                          {shippingAddress.city}, {shippingAddress.state} {shippingAddress.postalCode}
                        </span>
                      </p>
                      {shippingAddress.country && shippingAddress.country !== "US" && (
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
                  // Show placeholder only in editable mode
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

          {/* Parts Specification */}
          <div className="parts-section">
            <h2 className="section-title">Parts Specification</h2>
            <table>
              <thead>
                <tr>
                  <th>Part Name</th>
                  <th>Qty</th>
                  <th>Material</th>
                  <th>Tolerance</th>
                  <th>Finishing</th>
                  <th>Print?</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, index) => {
                  const part = parts.find((p) => p?.id === item.partId);
                  const notesContent = item.description || item.notes || part?.notes || "";
                  return (
                    <>
                      <tr key={`${index}-main`}>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.name || part?.partName || "Part"}
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
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {part?.material || "—"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {part?.tolerance || "—"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {part?.finishing || "—"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={editable ? "editable po-placeholder" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                            data-default-text="Yes"
                          >
                            Yes
                          </span>
                        </td>
                      </tr>
                      <tr key={`${index}-notes`} className="notes-row">
                        <td colSpan={6}>
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
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

        </div>

        {/* Financial Section with Total */}
        {order.vendorPay && (
          <div className="financial-section">
            <div className="total-box">
              <div className="total-row">
                <span className="total-label">Total Amount</span>
                <span
                  className={editable ? "total-value editable" : "total-value"}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {formatCurrency(order.vendorPay)}
                </span>
              </div>
            </div>
          </div>
        )}

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
