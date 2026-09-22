const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const RECEIPT_KEY_PATTERN = new RegExp(
  `^intake/(${UUID_PATTERN})/meta/receipt\\.json$`,
  "i",
);
const INTAKE_OBJECT_KEY_PATTERN = new RegExp(
  `^intake/(${UUID_PATTERN})/.+`,
  "i",
);

export function parseReceiptKey(receiptKey: string): { sessionId: string } | null {
  const match = RECEIPT_KEY_PATTERN.exec(receiptKey);
  return match ? { sessionId: match[1].toLowerCase() } : null;
}

export function isReceiptKey(receiptKey: string): boolean {
  return parseReceiptKey(receiptKey) !== null;
}

export function receiptKeyForIntakeObject(objectKey: string): string | null {
  const match = INTAKE_OBJECT_KEY_PATTERN.exec(objectKey);
  return match ? `intake/${match[1].toLowerCase()}/meta/receipt.json` : null;
}

export function intakePrefix(sessionId: string): string {
  return `intake/${sessionId}/`;
}

export function provisionalReceiptNumber(receiptKey: string): string {
  return `invalid-${createHash("sha256").update(receiptKey).digest("hex").slice(0, 24)}`;
}

export function isKeyInsideSession(key: string, sessionId: string): boolean {
  return key.startsWith(intakePrefix(sessionId)) && !key.includes("..") && !key.includes("\\");
}
import { createHash } from "node:crypto";
