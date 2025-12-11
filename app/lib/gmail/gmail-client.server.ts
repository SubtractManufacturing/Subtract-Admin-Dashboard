import { google } from "googleapis";
import { render } from "@react-email/render";
import QuoteEmail from "~/emails/QuoteEmail";
import fs from "fs";
import path from "path";

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
 * Supports both plain text and HTML content.
 * Includes embedded logo image.
 */
function buildRawEmail(to: string, from: string, subject: string, textBody: string, htmlBody: string, logoBase64?: string, logoContentId?: string): string {
  const boundaryRelated = "boundary_related_" + Date.now().toString(16);
  const boundaryAlternative = "boundary_alternative_" + Date.now().toString(16);

  const emailLines = [
    `To: ${to}`,
    `From: ${from}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/related; boundary="${boundaryRelated}"`,
    "",
    `--${boundaryRelated}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlternative}"`,
    "",
    `--${boundaryAlternative}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    "",
    textBody,
    "",
    `--${boundaryAlternative}`,
    `Content-Type: text/html; charset="UTF-8"`,
    "",
    htmlBody,
    "",
    `--${boundaryAlternative}--`,
  ];

  if (logoBase64 && logoContentId) {
    emailLines.push(
      "",
      `--${boundaryRelated}`,
      `Content-Type: image/png; name="logo.png"`,
      `Content-Transfer-Encoding: base64`,
      `Content-ID: <${logoContentId}>`,
      `Content-Disposition: inline; filename="logo.png"`,
      "",
      logoBase64,
      ""
    );
  }

  emailLines.push(`--${boundaryRelated}--`);

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
 * Emails are sent from the GOOGLE_DELEGATED_USER_EMAIL address (or override).
 * Wraps the body content in a React Email template.
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
    // Generate a unique Content-ID for the logo
    const logoContentId = `logo-${Date.now()}@subtract`;

    // Render the React Email template
    const htmlBody = await render(QuoteEmail({
      messageBody: body,
      subject: subject,
      logoContentId
    }));

    // Read and encode the logo image
    let logoBase64: string | undefined;
    try {
      const logoPath = path.join(process.cwd(), "app/assets/images/logo.png");
      if (fs.existsSync(logoPath)) {
        logoBase64 = fs.readFileSync(logoPath).toString("base64");
      } else {
        console.warn("Logo file not found at:", logoPath);
      }
    } catch (err) {
      console.warn("Failed to read logo file:", err);
    }

    const gmail = getGmailClient();
    // Use the override from address if provided, otherwise use the default delegated user
    const from = fromOverride || GOOGLE_DELEGATED_USER_EMAIL!;

    const rawEmail = buildRawEmail(to, from, subject, body, htmlBody, logoBase64, logoContentId);

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

