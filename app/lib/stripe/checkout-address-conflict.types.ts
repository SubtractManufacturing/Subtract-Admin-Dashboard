/**
 * Client-safe payload for checkout address conflict UI (no Stripe / DB imports).
 */
export type CheckoutAddressConflictPreview = {
  quoteId: number;
  quoteNumber: string;
  chooseBilling: boolean;
  chooseShipping: boolean;
  choosePhone: boolean;
  stripeBillingText: string;
  stripeShippingText: string;
  onFileBillingText: string;
  onFileShippingText: string;
  stripePhone: string | null;
  onFilePhone: string | null;
};
