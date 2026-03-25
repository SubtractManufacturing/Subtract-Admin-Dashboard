import React from "react";

export interface QuoteSendEmailProps {
  quoteNumber: string;
  customerName: string;
  total: string;
  paymentLinkUrl?: string;
}

export const QuoteSendEmail: React.FC<QuoteSendEmailProps> = ({
  quoteNumber,
  customerName,
  total,
  paymentLinkUrl,
}) => {
  return (
    <div style={{ fontFamily: "sans-serif", color: "#333" }}>
      <p>Hi {customerName},</p>
      <p>
        Please find your quote <strong>{quoteNumber}</strong> attached.
      </p>
      <p>
        <strong>Total:</strong> {total}
      </p>
      {paymentLinkUrl && (
        <p>
          <a
            href={paymentLinkUrl}
            style={{
              display: "inline-block",
              padding: "10px 20px",
              backgroundColor: "#007bff",
              color: "#fff",
              textDecoration: "none",
              borderRadius: "5px",
            }}
          >
            Pay Now
          </a>
        </p>
      )}
      <p>
        Best regards,
        <br />
        Subtract Manufacturing
      </p>
    </div>
  );
};
