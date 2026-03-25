/** Default bodyCopy JSON for templates using the quote-send layout */
export const DEFAULT_QUOTE_SEND_BODY_COPY: Record<string, string> = {
  greeting: "Hi {{customerName}},",
  intro: "Please find your quote **{{quoteNumber}}** attached.",
  totalLabel: "Total:",
  payNowButton: "Pay Now",
  signOff: "Best regards,\nSubtract Manufacturing",
};
