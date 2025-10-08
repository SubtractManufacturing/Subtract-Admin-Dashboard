/**
 * Shared utilities for PDF generation across different document types
 */

export function formatCurrency(amount: number | string | null): string {
  if (amount === null || amount === undefined) return "$0.00";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num);
}

export function formatDate(date: Date | null, format: "long" | "short" = "long"): string {
  if (!date) return "TBD";

  if (format === "short") {
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(date));
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(date));
}

export function formatNumber(num: number | null, decimals: number = 2): string {
  if (num === null || num === undefined) return "0";
  return num.toFixed(decimals);
}

export function formatPercentage(num: number | null): string {
  if (num === null || num === undefined) return "0%";
  return `${num.toFixed(1)}%`;
}

/**
 * Common PDF template styles that can be reused across different document types
 */
export const commonPdfStyles = `
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  body {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    background-color: transparent;
    padding: 20px;
    color: #2c3e50;
    line-height: 1.6;
  }

  .document-container {
    max-width: 1400px;
    margin: 0 auto;
    background-color: white;
    box-shadow: 0 2px 20px rgba(0, 0, 0, 0.08);
    display: flex;
    flex-direction: column;
  }

  .editable {
    transition: background-color 0.15s ease;
    border-radius: 3px;
    padding: 2px 4px;
    min-width: 30px;
    display: inline;
  }

  .editable:hover {
    background-color: #fff3cd;
    cursor: text;
    outline: 1px dashed #ffc107;
    outline-offset: 1px;
  }

  .editable:focus {
    background-color: #fff8dc;
    outline: 2px solid #ffc107;
    outline-offset: 1px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    border: 1px solid #dee2e6;
  }

  thead {
    background-color: #f8f9fa;
  }

  th {
    padding: 8px 12px;
    text-align: left;
    font-weight: 700;
    color: #2c3e50;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 2px solid #dee2e6;
    border-right: 1px solid #e9ecef;
  }

  th:last-child {
    border-right: none;
  }

  td {
    padding: 8px 12px;
    color: #495057;
    font-size: 14px;
    border-bottom: 1px solid #e9ecef;
    border-right: 1px solid #e9ecef;
    background: white;
  }

  td:last-child {
    border-right: none;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  @media print {
    body {
      background-color: white;
      padding: 0;
      margin: 0;
    }

    .document-container {
      box-shadow: none;
      max-width: 100%;
      min-height: 11in;
    }

    .editable:hover,
    .editable:focus {
      background-color: transparent;
      outline: none;
    }
  }
`;
