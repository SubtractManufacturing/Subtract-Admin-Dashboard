/**
 * Gmail Send-As addresses configuration.
 * 
 * Addresses are stored in the database and managed via Developer Settings.
 * The GOOGLE_DELEGATED_USER_EMAIL is used as a fallback if no addresses
 * are configured in the database.
 */

import { getActiveSendAsAddresses } from "~/lib/emailSendAsAddresses";

export interface SendAsAddress {
  email: string;
  label: string;
}

/**
 * Get the list of available "Send As" addresses from the database.
 * Falls back to the GOOGLE_DELEGATED_USER_EMAIL if no addresses are configured.
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

  // Fallback to env var if no addresses in database
  const delegatedUser = process.env.GOOGLE_DELEGATED_USER_EMAIL;
  if (delegatedUser) {
    return [
      {
        email: delegatedUser,
        label: extractLabel(delegatedUser),
      },
    ];
  }

  return [];
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
