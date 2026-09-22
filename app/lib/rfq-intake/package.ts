import { basename, extname } from "node:path";

import { isKeyInsideSession } from "./keys";
import type {
  IntakeContact,
  IntakeManifest,
  IntakePart,
  ReceiptPointer,
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class IntakeValidationError extends Error {
  constructor(
    message: string,
    readonly classification: "validation" | "security" = "validation",
  ) {
    super(message);
    this.name = "IntakeValidationError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new IntakeValidationError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  source: Record<string, unknown>,
  names: string[],
  label: string,
): string {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  throw new IntakeValidationError(`${label} is required`);
}

function optionalString(source: Record<string, unknown>, names: string[]): string | null {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function assertSessionKey(key: string, sessionId: string, label: string): string {
  if (!isKeyInsideSession(key, sessionId)) {
    throw new IntakeValidationError(`${label} escapes the intake session`, "security");
  }
  return key;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function parseReceipt(value: unknown, receiptKey: string): ReceiptPointer {
  const input = record(value, "receipt");
  const sessionId = requiredString(input, ["session_id", "sessionId"], "receipt session ID").toLowerCase();
  if (!UUID.test(sessionId)) throw new IntakeValidationError("receipt session ID must be a UUID");

  const receiptNumber = requiredString(
    input,
    ["receipt_number", "receiptNumber"],
    "receipt number",
  );
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(receiptNumber)) {
    throw new IntakeValidationError("receipt number contains unsafe characters", "security");
  }

  const manifestKey = assertSessionKey(
    requiredString(input, ["manifest_key", "manifestKey"], "manifest key"),
    sessionId,
    "manifest key",
  );
  if (manifestKey !== `intake/${sessionId}/meta/manifest.json`) {
    throw new IntakeValidationError("manifest key is not in the required meta folder", "security");
  }
  if (receiptKey !== `intake/${sessionId}/meta/receipt.json`) {
    throw new IntakeValidationError("receipt key and session ID do not match", "security");
  }

  return { receiptNumber, sessionId, receiptKey, manifestKey };
}

function parsePhone(contact: Record<string, unknown>): string | null {
  const direct = optionalString(contact, ["phone"]);
  if (direct) return direct;
  const phone = contact.phone_number ?? contact.phoneNumber;
  if (!phone || typeof phone !== "object" || Array.isArray(phone)) return null;
  const value = phone as Record<string, unknown>;
  const country = optionalString(value, ["country_code", "countryCode"]);
  const national = optionalString(value, ["national_number", "nationalNumber"]);
  return country && national
    ? `+${country.replace(/\D/g, "")}${national.replace(/\D/g, "")}`
    : null;
}

function parseContact(input: Record<string, unknown>): IntakeContact {
  const contact = record(input.contact, "manifest contact");
  return {
    firstName: requiredString(contact, ["first_name", "firstName"], "contact first name"),
    lastName: requiredString(contact, ["last_name", "lastName"], "contact last name"),
    company: optionalString(contact, ["company", "company_name", "companyName"]),
    email: requiredString(contact, ["email"], "contact email").toLowerCase(),
    phone: parsePhone(contact),
  };
}

function asset(
  value: unknown,
  sessionId: string,
  label: string,
): { key: string; fileName: string; contentType: string | null } {
  const input = record(value, label);
  const key = assertSessionKey(
    requiredString(input, ["key", "s3_key", "s3Key"], `${label} key`),
    sessionId,
    `${label} key`,
  );
  const fileName =
    optionalString(input, ["original_filename", "originalFilename", "file_name", "fileName"]) ??
    basename(key);
  if (
    fileName !== basename(fileName) ||
    fileName === "." ||
    fileName === ".." ||
    /[\\/]/.test(fileName) ||
    hasControlCharacter(fileName)
  ) {
    throw new IntakeValidationError(`${label} filename is unsafe`, "security");
  }
  return {
    key,
    fileName,
    contentType: optionalString(input, ["content_type", "contentType"]),
  };
}

function formatPartNote(part: Record<string, unknown>): string {
  const labels: Array<[string, unknown]> = [
    ["Quantity", part.quantity],
    ["Material", part.material],
    ["Primary tolerance", part.tolerance],
    ["Custom tolerance", part.custom_tolerance ?? part.customTolerance],
    ["Threads / features", part.threads_features ?? part.threadsFeatures],
    ["Customer notes", part.notes],
    ["Customer target unit price", part.target_unit_price ?? part.targetUnitPrice],
  ];
  const lines = labels
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `${label}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  const knownKeys = new Set([
    "id",
    "part_id",
    "partId",
    "quantity",
    "material",
    "tolerance",
    "custom_tolerance",
    "customTolerance",
    "threads_features",
    "threadsFeatures",
    "notes",
    "target_unit_price",
    "targetUnitPrice",
  ]);
  for (const key of Object.keys(part).filter((key) => !knownKeys.has(key)).sort()) {
    const value = part[key];
    if (value === undefined || value === null || value === "") continue;
    lines.push(
      `Additional ${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
    );
  }
  return lines.join("\n");
}

function parsePart(value: unknown, sessionId: string): IntakePart {
  const input = record(value, "manifest part");
  const id = requiredString(input, ["id", "part_id", "partId"], "part ID").toLowerCase();
  if (!UUID.test(id)) throw new IntakeValidationError("part ID must be a UUID");
  const rawQuantity = input.quantity;
  const quantity = typeof rawQuantity === "number" ? rawQuantity : Number(rawQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new IntakeValidationError("part quantity must be a positive integer");
  }

  const cadValue = input.cad ?? input.cad_file ?? input.cadFile;
  const drawingsValue = input.drawings ?? [];
  if (!Array.isArray(drawingsValue)) {
    throw new IntakeValidationError("part drawings must be an array");
  }
  const toleranceValue = input.tolerance;
  const tolerance =
    typeof toleranceValue === "string"
      ? toleranceValue
      : toleranceValue && typeof toleranceValue === "object" && !Array.isArray(toleranceValue)
        ? optionalString(toleranceValue as Record<string, unknown>, ["category", "primary"])
        : null;
  const cad = asset(cadValue, sessionId, "CAD asset");
  const drawings = drawingsValue.map((drawing) =>
    asset(drawing, sessionId, "drawing asset"),
  );
  const partFolder = `intake/${sessionId}/parts/${id}/`;
  if (!cad.key.startsWith(partFolder)) {
    throw new IntakeValidationError("CAD asset is not in its declared part folder", "security");
  }
  if (drawings.some((drawing) => !drawing.key.startsWith(partFolder))) {
    throw new IntakeValidationError("drawing asset is not in its declared part folder", "security");
  }

  return {
    id,
    quantity,
    cad,
    drawings,
    material: optionalString(input, ["material"]),
    tolerance,
    note: formatPartNote(input),
    raw: input,
  };
}

export function parseManifest(value: unknown, receipt: ReceiptPointer): IntakeManifest {
  const input = record(value, "manifest");
  const sessionId = requiredString(input, ["session_id", "sessionId"], "manifest session ID").toLowerCase();
  if (sessionId !== receipt.sessionId) {
    throw new IntakeValidationError("manifest and receipt sessions do not match", "security");
  }
  if (!Array.isArray(input.parts) || input.parts.length === 0) {
    throw new IntakeValidationError("manifest must contain at least one part");
  }

  const parts = input.parts.map((part) => parsePart(part, sessionId));
  if (new Set(parts.map((part) => part.id)).size !== parts.length) {
    throw new IntakeValidationError("manifest contains duplicate part IDs");
  }

  return {
    sessionId,
    contact: parseContact(input),
    ndaRequired: input.nda_required === true || input.ndaRequired === true,
    requestedDeliveryDate: optionalString(input, ["requested_delivery_date", "requestedDeliveryDate"]),
    leadTimePreference: optionalString(input, ["lead_time_preference", "leadTimePreference"]),
    destinationPostalCode: optionalString(input, ["destination_postal_code", "destinationPostalCode"]),
    poNumber: optionalString(input, ["po_number", "poNumber"]),
    globalNotes: optionalString(input, ["notes", "global_notes", "globalNotes"]),
    parts,
    raw: input,
  };
}

export function partDisplayName(fileName: string): string {
  const extension = extname(fileName);
  return basename(fileName, extension).replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[-_]/i,
    "",
  );
}

export function quoteIntakeNote(manifest: IntakeManifest): string {
  const contactName = `${manifest.contact.firstName} ${manifest.contact.lastName}`.trim();
  const rows: Array<[string, string | boolean | null]> = [
    ["Contact", contactName],
    ["Company", manifest.contact.company],
    ["Email", manifest.contact.email],
    ["Phone", manifest.contact.phone],
    ["Requested delivery date", manifest.requestedDeliveryDate],
    ["Lead-time preference", manifest.leadTimePreference],
    ["Destination postal code", manifest.destinationPostalCode],
    ["PO number", manifest.poNumber],
    ["NDA required", manifest.ndaRequired ? "Yes" : "No"],
    ["Global notes", manifest.globalNotes],
  ];
  return ["WordPress RFQ intake", ...rows.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`)].join("\n");
}
