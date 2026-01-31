/**
 * Email Send-As addresses configuration for Postmark.
 *
 * Addresses are stored in the database and managed via Developer Settings.
 * Each address must be verified as a Sender Signature in Postmark to work.
 */

import { getActiveSendAsAddresses } from "~/lib/emailSendAsAddresses";

export interface SendAsAddress {
  email: string;
  label: string;
}

/**
 * Get the list of available "Send As" addresses from the database.
 * Falls back to a default sender email if no addresses are configured.
 */
export async function getSendAsAddresses(): Promise<SendAsAddress[]> {
  // Get addresses from database
  const dbAddresses = await getActiveSendAsAddresses();

  if (dbAddresses.length > 0) {
    return dbAddresses.map((addr) => ({
      email: addr.email,
      label: addr.label,
    }));
  }

  // Fallback to default sender if available
  const defaultSender = process.env.DEFAULT_SENDER_EMAIL;
  if (defaultSender) {
    return [
      {
        email: defaultSender,
        label: extractLabel(defaultSender),
      },
    ];
  }

  return [];
}

/**
 * Get the default "Send As" address.
 * Returns the address marked as default in the database, or the first available.
 */
export async function getDefaultSendAsAddress(): Promise<SendAsAddress | null> {
  const addresses = await getSendAsAddresses();
  
  if (addresses.length === 0) {
    return null;
  }

  // Get addresses from database to check for default
  const dbAddresses = await getActiveSendAsAddresses();
  const defaultAddr = dbAddresses.find((addr) => addr.isDefault);
  
  if (defaultAddr) {
    return {
      email: defaultAddr.email,
      label: defaultAddr.label,
    };
  }

  // Return first address as default
  return addresses[0];
}

/**
 * Extract a human-readable label from an email address.
 * e.g., "rfq@company.com" -> "RFQ"
 */
function extractLabel(email: string): string {
  const localPart = email.split("@")[0];
  // Convert to title case and replace common separators
  return localPart
    .replace(/[-_.]/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
