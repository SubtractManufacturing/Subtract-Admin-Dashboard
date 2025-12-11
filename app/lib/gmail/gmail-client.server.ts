import { google } from "googleapis";

const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
const GOOGLE_DELEGATED_USER_EMAIL = process.env.GOOGLE_DELEGATED_USER_EMAIL;

interface SendEmailOptions {
  to: string;
  subject: string;
  body: string;
  from?: string; // Optional: defaults to GOOGLE_DELEGATED_USER_EMAIL
}

interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface ValidateSendAsResult {
  valid: boolean;
  error?: string;
  configuredAddresses?: string[];
}

/**
 * Creates a Gmail API client authenticated via service account with domain-wide delegation.
 * The service account impersonates the delegated user to send emails.
 */
function getGmailClient(scopes: string[] = ["https://www.googleapis.com/auth/gmail.send"]) {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_EMAIL environment variable is not set");
  }
  if (!GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY environment variable is not set");
  }
  if (!GOOGLE_DELEGATED_USER_EMAIL) {
    throw new Error("GOOGLE_DELEGATED_USER_EMAIL environment variable is not set");
  }

  // Create JWT auth with domain-wide delegation
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n"),
    scopes,
    subject: GOOGLE_DELEGATED_USER_EMAIL, // Impersonate this user
  });

  return google.gmail({ version: "v1", auth });
}

/**
 * Builds a raw RFC 2822 email message for the Gmail API.
 */
function buildRawEmail(to: string, from: string, subject: string, body: string): string {
  const emailLines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    body,
  ];

  const email = emailLines.join("\r\n");

  // Encode to base64url format required by Gmail API
  const encodedEmail = Buffer.from(email)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return encodedEmail;
}

/**
 * Sends an email using the Gmail API.
 * Emails are sent from the GOOGLE_DELEGATED_USER_EMAIL address.
 */
export async function sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, body, from: fromOverride } = options;

  if (!to || !subject || !body) {
    return {
      success: false,
      error: "Missing required fields: to, subject, and body are all required",
    };
  }

  try {
    const gmail = getGmailClient();
    // Use the override from address if provided, otherwise use the default delegated user
    const from = fromOverride || GOOGLE_DELEGATED_USER_EMAIL!;

    const rawEmail = buildRawEmail(to, from, subject, body);

    const response = await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: rawEmail,
      },
    });

    return {
      success: true,
      messageId: response.data.id || undefined,
    };
  } catch (error) {
    console.error("Failed to send email:", error);
    
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Validates that an email address is configured as a "Send As" address
 * in the delegated user's Gmail settings.
 */
export async function validateSendAsAddress(email: string): Promise<ValidateSendAsResult> {
  try {
    // Need gmail.settings.basic scope to read Send As addresses
    const gmail = getGmailClient([
      "https://www.googleapis.com/auth/gmail.settings.basic",
    ]);

    const response = await gmail.users.settings.sendAs.list({
      userId: "me",
    });

    const sendAsAddresses = response.data.sendAs || [];
    const configuredEmails = sendAsAddresses
      .map((addr) => addr.sendAsEmail?.toLowerCase())
      .filter((email): email is string => !!email);

    const isValid = configuredEmails.includes(email.toLowerCase());

    return {
      valid: isValid,
      configuredAddresses: isValid ? configuredEmails : undefined, // Only expose if valid
      error: isValid
        ? undefined
        : `"${email}" is not configured as a "Send As" address in Gmail. Please add it in Gmail settings first.`,
    };
  } catch (error) {
    console.error("Failed to validate Send As address:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error occurred";

    return {
      valid: false,
      error: `Failed to validate address: ${errorMessage}`,
    };
  }
}

/**
 * Gets all configured "Send As" addresses from Gmail settings.
 * Useful for debugging or displaying available options.
 */
export async function getGmailSendAsAddresses(): Promise<{ email: string; displayName?: string; isDefault?: boolean }[]> {
  try {
    const gmail = getGmailClient([
      "https://www.googleapis.com/auth/gmail.settings.basic",
    ]);

    const response = await gmail.users.settings.sendAs.list({
      userId: "me",
    });

    const sendAsAddresses = response.data.sendAs || [];
    
    return sendAsAddresses
      .filter((addr) => addr.sendAsEmail)
      .map((addr) => ({
        email: addr.sendAsEmail!,
        displayName: addr.displayName || undefined,
        isDefault: addr.isDefault || false,
      }));
  } catch (error) {
    console.error("Failed to get Send As addresses from Gmail:", error);
    return [];
  }
}

