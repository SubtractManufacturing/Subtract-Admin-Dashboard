import { useEffect, useMemo } from "react";
import type { OrderWithRelations } from "~/lib/orders";
import type { Part, OrderLineItem, Customer } from "~/lib/db/schema";
import {
  formatDate,
  commonPdfStyles,
  type PdfPresetOption,
} from "~/lib/pdf-utils";
import {
  extractBillingAddress,
  extractShippingAddress,
  isAddressComplete,
  type Address,
} from "~/lib/address-utils";

/** Rows that represent shippable parts only (exclude services and non-part lines). */
function filterPackingSlipLineItems(items: OrderLineItem[]): OrderLineItem[] {
  return items.filter((item) => {
    if (item.partId == null) return false;
    const n = (item.name || "").trim().toLowerCase();
    if (n === "additional services") return false;
    return true;
  });
}

function compactCustomerHeading(customer: Customer | null | undefined): string {
  if (!customer) return "Customer Name";
  const org =
    customer.displayName?.trim() ||
    customer.companyName?.trim() ||
    "" ||
    "Customer Name";
  const contact = customer.contactName?.trim();
  return contact ? `${org} - ${contact}` : org;
}

/** Single line: City, ST ZIP [, Country if not US]. */
function compactCityStateZipLine(address: Address): string {
  const cityState = [address.city, address.state].filter(Boolean).join(", ");
  const zip = (address.postalCode || "").trim();
  const withZip = [cityState, zip].filter(Boolean).join(" ");
  if (address.country && address.country !== "US") {
    return withZip ? `${withZip}, ${address.country}` : address.country;
  }
  return withZip;
}

export const PACKING_SLIP_PDF_PRESETS = [
  { id: "default", label: "Default" },
  { id: "no_images", label: "No images" },
] as const satisfies readonly PdfPresetOption[];

export type PackingSlipPdfPresetId =
  (typeof PACKING_SLIP_PDF_PRESETS)[number]["id"];

function getPackingSlipPresetFields(presetId: PackingSlipPdfPresetId) {
  switch (presetId) {
    case "no_images":
      return {
        title: "PACKING SLIP",
        showImageColumn: false,
      };
    case "default":
    default:
      return {
        title: "PACKING SLIP",
        showImageColumn: true,
      };
  }
}

interface PackingSlipPdfTemplateProps {
  order: OrderWithRelations;
  lineItems?: OrderLineItem[];
  parts?: (Part | null)[];
  editable?: boolean;
  presetId?: PackingSlipPdfPresetId;
}

export function PackingSlipPdfTemplate({
  order,
  lineItems = [],
  parts = [],
  editable = false,
  presetId = "default",
}: PackingSlipPdfTemplateProps) {
  const documentDateDisplay = useMemo(() => formatDate(new Date()), []);
  const presetFields = getPackingSlipPresetFields(presetId);
  const packingLineItems = useMemo(
    () => filterPackingSlipLineItems(lineItems),
    [lineItems],
  );

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
          if (defaultText === "N/A") {
            target.classList.remove("placeholder-text");
          } else {
            target.classList.add("placeholder-text");
          }
        } else if (currentText !== defaultText) {
          target.classList.remove("placeholder-text");
        } else {
          if (defaultText === "N/A") {
            target.classList.remove("placeholder-text");
          } else {
            target.classList.add("placeholder-text");
          }
        }
      }
    };

    const placeholders = document.querySelectorAll(".packing-slip-placeholder");
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
  }, [editable, presetId, packingLineItems.length]);

  const customer = order.customer;
  const showImageColumn = presetFields.showImageColumn;

  return (
    <div className="packing-slip-pdf-container">
      <style>
        {`
          ${commonPdfStyles}

          .packing-slip-pdf-container .document-container {
            min-height: 11in;
          }

          .content-wrapper {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
          }

          .packing-slip-fill {
            flex: 1 1 auto;
            min-height: 0.5rem;
          }

          .packing-slip-bottom {
            flex-shrink: 0;
            width: 100%;
            box-sizing: border-box;
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

          .slip-title {
            flex: 1;
            text-align: center;
          }

          .slip-title h2 {
            font-size: 26px;
            font-weight: 700;
            color: #c41e3a;
            margin: 0;
            letter-spacing: -0.5px;
          }

          .slip-header-info {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 20px;
            margin-top: 15px;
            padding-top: 15px;
            border-top: 1px solid #e1e4e8;
          }

          .slip-header-info .info-item {
            display: flex;
            flex-direction: column;
          }

          .slip-header-info .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #6c757d;
            margin-bottom: 4px;
            font-weight: 600;
          }

          .slip-header-info .value {
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
            margin-bottom: 6px;
            font-weight: 700;
            border-bottom: 2px solid #c41e3a;
            padding-bottom: 4px;
          }

          .detail-section p {
            color: #495057;
            font-size: 14px;
            margin-bottom: 1px;
            line-height: 1.28;
          }

          .detail-section .primary {
            font-weight: 700;
            font-size: 15px;
            color: #2c3e50;
            margin-bottom: 3px;
            line-height: 1.28;
          }

          .placeholder-text {
            color: #9ca3af;
            font-style: italic;
          }

          .parts-section {
            padding: 20px 40px;
            flex-shrink: 0;
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
            table-layout: fixed;
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            border: 1px solid #e6ebf1;
            border-radius: 6px;
            overflow: hidden;
          }

          .parts-section th,
          .parts-section td {
            border: 1px solid #e6ebf1;
            padding: 8px 10px;
            white-space: normal;
            word-wrap: break-word;
            overflow-wrap: break-word;
            vertical-align: middle;
            text-align: center;
          }

          .parts-section th {
            background: #f8f9fa;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #495057;
            font-weight: 700;
          }

          .parts-section thead th {
            padding: 8px 7px;
            font-size: 11px;
            line-height: 1.2;
            letter-spacing: 0.35px;
            vertical-align: middle;
          }

          .parts-section th.thumb-header-empty {
            font-size: 0;
            line-height: 0;
            padding: 4px 3px;
            text-transform: none;
            letter-spacing: 0;
          }

          /* Header-only: do not use body cell heights (72px) in thead */
          .parts-section thead .thumb-cell {
            width: 72px;
            height: auto;
            min-height: 0;
            max-height: none;
            padding: 4px 3px;
            line-height: 0;
          }

          .parts-section thead .qty-cell,
          .parts-section thead .qty-shipped-cell {
            width: 88px;
            min-height: 0;
            height: auto;
          }

          .parts-section tbody .thumb-cell {
            width: 72px;
            height: 72px;
            padding: 0;
            overflow: hidden;
            vertical-align: middle;
            text-align: center;
            box-sizing: border-box;
          }

          .parts-section tbody .thumb-cell img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
          }

          .parts-section tbody .thumb-placeholder {
            width: 100%;
            height: 100%;
            min-height: 72px;
            box-sizing: border-box;
            border: none;
            background: transparent;
            outline: 1px dashed #ced4da;
            outline-offset: -1px;
          }

          .parts-section tbody .qty-cell {
            width: 88px;
            min-height: 72px;
          }

          .parts-section tbody .qty-shipped-cell {
            width: 88px;
            min-height: 72px;
          }

          .parts-section .cell-inner {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 56px;
            text-align: center;
          }

          .order-notes-section {
            padding: 0 40px 12px;
            width: 100%;
            box-sizing: border-box;
          }

          .order-notes-section h3 {
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #495057;
            margin-bottom: 8px;
            font-weight: 700;
          }

          .order-notes-box {
            display: block;
            width: 100%;
            height: 88px;
            min-height: 88px;
            max-height: 88px;
            box-sizing: border-box;
            border: 1.5px solid #9aa3ad;
            border-radius: 6px;
            padding: 8px 10px;
            background: transparent;
            color: #2c3e50;
            font-size: 14px;
            line-height: 1.5;
            overflow: auto;
            resize: none;
          }

          .verified-section {
            padding: 0 40px 28px;
            display: flex;
            justify-content: center;
          }

          .verified-inner {
            width: 80%;
            display: flex;
            align-items: flex-end;
            gap: 12px;
          }

          .verified-section .verified-label {
            font-size: 14px;
            font-weight: 600;
            color: #5f6b78;
            flex-shrink: 0;
          }

          .verified-section .signature-line {
            flex: 1;
            border-bottom: 1.5px solid #9aa3ad;
            min-height: 28px;
          }

          .footer {
            background-color: #f8f9fa;
            color: #495057;
            padding: 12px 10px;
            border-top: 3px solid #c41e3a;
            text-align: center;
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

      <div className="document-container" key={presetId}>
        <div className="content-wrapper">
          <div className="header">
            <div className="header-top">
              <div className="logo-section">
                <img
                  src="/subtract-logo.png"
                  alt="Subtract Manufacturing"
                  className="logo-img"
                />
              </div>
              <div className="slip-title">
                <h2>{presetFields.title}</h2>
              </div>
              <div style={{ width: "50px" }} />
            </div>
            <div className="slip-header-info">
              <div className="info-item">
                <span className="label">Date</span>
                <span className="value">
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {documentDateDisplay}
                  </span>
                </span>
              </div>
              <div className="info-item">
                <span className="label">Order #</span>
                <span className="value">
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {order.orderNumber}
                  </span>
                </span>
              </div>
              <div className="info-item">
                <span className="label">PO #</span>
                <span className="value">
                  <span
                    className={
                      editable ? "editable packing-slip-placeholder" : ""
                    }
                    contentEditable={editable}
                    suppressContentEditableWarning
                    data-default-text="N/A"
                  >
                    N/A
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="customer-details">
            <div className="detail-section">
              <h3>Bill To:</h3>
              <p className="primary">
                <span
                  className={editable ? "editable" : ""}
                  contentEditable={editable}
                  suppressContentEditableWarning
                >
                  {compactCustomerHeading(customer)}
                </span>
              </p>
              {customer?.email && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {customer.email}
                  </span>
                </p>
              )}
              {editable && !customer?.email && (
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
              {customer?.phone && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {customer.phone}
                  </span>
                </p>
              )}
              {editable && !customer?.phone && (
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
              {customer &&
                (() => {
                  const billingAddress = extractBillingAddress(customer);
                  const hasBilling = isAddressComplete(billingAddress);

                  if (hasBilling) {
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
                            {compactCityStateZipLine(billingAddress)}
                          </span>
                        </p>
                      </>
                    );
                  }
                  if (editable) {
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
                  {compactCustomerHeading(customer)}
                </span>
              </p>
              {customer?.email && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {customer.email}
                  </span>
                </p>
              )}
              {editable && !customer?.email && (
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
              {customer?.phone && (
                <p>
                  <span
                    className={editable ? "editable" : ""}
                    contentEditable={editable}
                    suppressContentEditableWarning
                  >
                    {customer.phone}
                  </span>
                </p>
              )}
              {editable && !customer?.phone && (
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
              {customer &&
                (() => {
                  const shippingAddress = extractShippingAddress(customer);
                  const hasShipping = isAddressComplete(shippingAddress);

                  if (hasShipping) {
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
                            {compactCityStateZipLine(shippingAddress)}
                          </span>
                        </p>
                      </>
                    );
                  }
                  if (editable) {
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

          <div className="parts-section">
            <h2 className="section-title">Package contents</h2>
            <table>
              <thead>
                <tr>
                  {showImageColumn ? (
                    <th
                      className="thumb-cell thumb-header-empty"
                      aria-hidden="true"
                    >
                      &#160;
                    </th>
                  ) : null}
                  <th>Part name</th>
                  <th>Part notes</th>
                  <th className="qty-cell"># ordered</th>
                  <th className="qty-shipped-cell"># shipped</th>
                </tr>
              </thead>
              <tbody>
                {packingLineItems.map((item, index) => {
                  const part = parts.find((p) => p?.id === item.partId);
                  const displayName = item.name || part?.partName || "Part";
                  return (
                    <tr key={`packing-line-${item.id ?? index}`}>
                      {showImageColumn ? (
                        <td className="thumb-cell">
                          {part?.thumbnailUrl ? (
                            <img
                              src={part.thumbnailUrl}
                              alt=""
                              crossOrigin="anonymous"
                            />
                          ) : (
                            <div className="thumb-placeholder" aria-hidden />
                          )}
                        </td>
                      ) : null}
                      <td>
                        <div className="cell-inner">
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {displayName}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="cell-inner">
                          <span
                            className={
                              editable
                                ? "editable packing-slip-placeholder placeholder-text"
                                : ""
                            }
                            contentEditable={editable}
                            suppressContentEditableWarning
                            data-default-text="Part notes"
                          >
                            Part notes
                          </span>
                        </div>
                      </td>
                      <td className="qty-cell">
                        <div className="cell-inner">
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {item.quantity}
                          </span>
                        </div>
                      </td>
                      <td className="qty-shipped-cell">
                        <div className="cell-inner">
                          <span
                            className={editable ? "editable" : ""}
                            contentEditable={editable}
                            suppressContentEditableWarning
                          >
                            {editable ? "\u00a0" : ""}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="packing-slip-fill" aria-hidden="true" />

          <div className="packing-slip-bottom">
            <div className="order-notes-section">
              <h3>Order notes</h3>
              <div
                className={`order-notes-box${editable ? " editable" : ""}`}
                contentEditable={editable}
                suppressContentEditableWarning
              />
            </div>

            <div className="verified-section">
              <div className="verified-inner">
                <span className="verified-label">Verified by:</span>
                <div className="signature-line" />
              </div>
            </div>
          </div>
        </div>

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
