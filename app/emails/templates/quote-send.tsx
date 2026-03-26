import React from "react";

export interface QuoteSendCopy {
  greeting?: string;
  intro?: string;
  totalLabel?: string;
  payNowButton?: string;
  signOff?: string;
  /** Resolved snippet text (or placeholders—final pass substitutes HTML). */
  signature?: string;
  footer?: string;
}

export interface QuoteSendEmailProps {
  quoteNumber: string;
  customerName: string;
  total: string;
  paymentLinkUrl?: string;
  copy?: QuoteSendCopy;
}

export const QuoteSendEmail: React.FC<QuoteSendEmailProps> = ({
  total,
  paymentLinkUrl,
  copy,
}) => {
  const greeting = copy?.greeting || "Hi {{customerName}},";
  const intro = copy?.intro || "Please find your quote **{{quoteNumber}}** attached.";
  const totalLabel = copy?.totalLabel || "Total:";
  const payNowButton = copy?.payNowButton || "Pay Now";
  const signOff = copy?.signOff || "Best regards,\nSubtract Manufacturing";
  const signature = copy?.signature ?? "{{default_signature}}";
  const footer = copy?.footer ?? "{{default_footer}}";

  // Simple interpolation for the component (though the server might pre-interpolate, it's safe to do it here too or assume it's pre-interpolated)
  // Actually, the plan says: "Interpolate each string in bodyCopy the same way if placeholders are used inside copy."
  // So the server will pre-interpolate `copy` before passing it here.
  // We just need to render it. We can handle basic markdown like `**bold**` or just render as text.
  // For simplicity, let's just render the pre-interpolated strings. If they want markdown, we'd need a markdown parser.
  // Let's just render it as text for now, but maybe split by \n for signOff.

  return (
    <div style={{ fontFamily: "sans-serif", color: "#333" }}>
      <p>{greeting}</p>
      <p>
        {/* We can split by ** to make it bold if we want, but let's just render it. The server interpolation might just be text. */}
        {intro.split("**").map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part))}
      </p>
      <p>
        <strong>{totalLabel}</strong> {total}
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
            {payNowButton}
          </a>
        </p>
      )}
      <p>
        {signOff.split("\n").map((line, i) => (
          <React.Fragment key={i}>
            {line}
            <br />
          </React.Fragment>
        ))}
      </p>
      <div style={{ marginTop: "20px", whiteSpace: "pre-wrap" }}>{signature}</div>
      <div
        style={{ marginTop: "20px", fontSize: "12px", color: "#666", whiteSpace: "pre-wrap" }}
      >
        {footer}
      </div>
    </div>
  );
};
