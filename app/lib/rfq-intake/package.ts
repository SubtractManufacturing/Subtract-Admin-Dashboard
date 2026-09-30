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
  name: string,
  label: string,
): string {
  const value = source[name];
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new IntakeValidationError(`${label} is required`);
}

function optionalString(source: Record<string, unknown>, name: string): string | null {
  if (!(name in source)) return null;
  const value = source[name];
  if (value === null) return null;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "string") return null;
  throw new IntakeValidationError(`${name.replaceAll("_", " ")} must be a string or null`);
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

const UUID_FILE_PREFIX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_/i;

function safeFileName(fileName: string, label: string): string {
  if (
    !fileName ||
    fileName !== basename(fileName) ||
    fileName === "." ||
    fileName === ".." ||
    /[\\/]/.test(fileName) ||
    hasControlCharacter(fileName)
  ) {
    throw new IntakeValidationError(`${label} filename is unsafe`, "security");
  }
  return fileName;
}

export function parseReceipt(value: unknown, receiptKey: string): ReceiptPointer {
  const input = record(value, "receipt");
  const sessionId = requiredString(input, "session_id", "receipt session ID").toLowerCase();
  if (!UUID.test(sessionId)) throw new IntakeValidationError("receipt session ID must be a UUID");

  const receiptNumber = requiredString(input, "receipt_number", "receipt number");
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(receiptNumber)) {
    throw new IntakeValidationError("receipt number contains unsafe characters", "security");
  }

  const submittedAt = requiredString(input, "submitted_at", "receipt submitted at");

  const manifestKey = assertSessionKey(
    requiredString(input, "manifest_key", "manifest key"),
    sessionId,
    "manifest key",
  );
  if (manifestKey !== `intake/${sessionId}/meta/manifest.json`) {
    throw new IntakeValidationError("manifest key is not in the required meta folder", "security");
  }
  if (receiptKey !== `intake/${sessionId}/meta/receipt.json`) {
    throw new IntakeValidationError("receipt key and session ID do not match", "security");
  }

  return { receiptNumber, sessionId, receiptKey, manifestKey, submittedAt };
}

function parsePhone(contact: Record<string, unknown>): string | null {
  if (!("phone" in contact) || contact.phone === null) return null;
  if (typeof contact.phone !== "string" || !contact.phone.trim()) {
    throw new IntakeValidationError("contact phone must be a string or null");
  }
  const phone = contact.phone.trim();
  if (!/^\d+$/.test(phone)) {
    throw new IntakeValidationError("contact phone must contain digits only");
  }
  const countryCode = contact.phone_country_code;
  if (typeof countryCode !== "string" || !/^\d{1,4}$/.test(countryCode.trim())) {
    throw new IntakeValidationError("contact phone country code is required when phone is set");
  }
  return `+${countryCode.trim()}${phone}`;
}

function parseContact(input: Record<string, unknown>): IntakeContact {
  const contact = record(input.contact, "manifest contact");
  return {
    firstName: requiredString(contact, "first_name", "contact first name"),
    lastName: requiredString(contact, "last_name", "contact last name"),
    company: optionalString(contact, "company"),
    email: requiredString(contact, "email", "contact email").toLowerCase(),
    phone: parsePhone(contact),
    jobTitle: optionalString(contact, "job_title"),
  };
}

function parseFileKey(
  value: unknown,
  sessionId: string,
  label: string,
): { key: string; fileName: string; contentType: string | null } {
  if (typeof value !== "string" || !value.trim()) {
    throw new IntakeValidationError(`${label} is required`);
  }
  const key = assertSessionKey(value.trim(), sessionId, `${label}`);
  return {
    key,
    fileName: safeFileName(basename(key).replace(UUID_FILE_PREFIX, ""), label),
    contentType: null,
  };
}

function formatPartNote(part: Record<string, unknown>): string {
  const labels: Array<[string, unknown]> = [
    ["Quantity", part.quantity],
    ["Material", part.material],
    ["Primary tolerance", part.tolerance],
    ["Custom tolerance", part.tolerance_detail],
    ["Threads / features", part.threads_features],
    ["Customer notes", part.notes],
    ["Target price", part.target_unit_price],
  ];
  const lines = labels
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `${label}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
  const knownKeys = new Set([
    "part_id",
    "part_file_key",
    "drawing_file_keys",
    "quantity",
    "material",
    "tolerance",
    "tolerance_detail",
    "threads_features",
    "notes",
    "target_unit_price",
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
  const id = requiredString(input, "part_id", "part ID").toLowerCase();
  if (!UUID.test(id)) throw new IntakeValidationError("part ID must be a UUID");

  const rawQuantity = input.quantity;
  if (typeof rawQuantity !== "number" || !Number.isFinite(rawQuantity)) {
    throw new IntakeValidationError("part quantity must be a positive integer");
  }
  const quantity = Math.trunc(rawQuantity);
  if (quantity !== rawQuantity || quantity <= 0) {
    throw new IntakeValidationError("part quantity must be a positive integer");
  }

  if (!("drawing_file_keys" in input) || !Array.isArray(input.drawing_file_keys)) {
    throw new IntakeValidationError("part drawing file keys must be an array");
  }

  const tolerance = requiredString(input, "tolerance", "part tolerance");
  const toleranceDetail = optionalString(input, "tolerance_detail");
  if (tolerance === "custom" && !toleranceDetail) {
    throw new IntakeValidationError("part tolerance detail is required when tolerance is custom");
  }

  if ("target_unit_price" in input && input.target_unit_price !== null) {
    if (typeof input.target_unit_price !== "number" || !Number.isFinite(input.target_unit_price)) {
      throw new IntakeValidationError("part target unit price must be a number or null");
    }
  }

  const cad = parseFileKey(input.part_file_key, sessionId, "part file key");
  const drawings = input.drawing_file_keys.map((drawing) =>
    parseFileKey(drawing, sessionId, "drawing file key"),
  );

  const partFolder = `intake/${sessionId}/parts/`;
  if (!cad.key.startsWith(partFolder)) {
    throw new IntakeValidationError("part file key is not in the intake parts folder", "security");
  }
  const drawingFolder = `intake/${sessionId}/drawings/`;
  if (drawings.some((drawing) => !drawing.key.startsWith(drawingFolder))) {
    throw new IntakeValidationError(
      "drawing file key is not in the intake drawings folder",
      "security",
    );
  }

  return {
    id,
    quantity,
    cad,
    drawings,
    material: requiredString(input, "material", "part material"),
    tolerance,
    note: formatPartNote(input),
    raw: input,
  };
}

export function parseManifest(value: unknown, receipt: ReceiptPointer): IntakeManifest {
  const input = record(value, "manifest");
  const sessionId = requiredString(input, "session_id", "manifest session ID").toLowerCase();
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

  const globalInput = record(input.global, "manifest global");
  if (!("nda_required" in globalInput)) {
    throw new IntakeValidationError("nda required is required");
  }
  if (typeof globalInput.nda_required !== "boolean") {
    throw new IntakeValidationError("nda required must be a boolean");
  }

  const shippingDestination = record(
    globalInput.shipping_destination,
    "shipping destination",
  );

  return {
    sessionId,
    contact: parseContact(input),
    ndaRequired: globalInput.nda_required,
    requestedDeliveryDate: optionalString(globalInput, "required_delivery_date"),
    leadTimePreference: requiredString(
      globalInput,
      "lead_time_preference",
      "lead time preference",
    ),
    destinationPostalCode: requiredString(
      shippingDestination,
      "postal_code",
      "shipping destination postal code",
    ),
    poNumber: optionalString(globalInput, "po_number"),
    globalNotes: optionalString(globalInput, "notes"),
    parts,
    raw: input,
  };
}

export function partDisplayName(fileName: string): string {
  const extension = extname(fileName);
  return basename(fileName, extension).replace(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_/i,
    "",
  );
}

export function quoteIntakeNote(manifest: IntakeManifest, receipt: ReceiptPointer): string {
  const contactName = `${manifest.contact.firstName} ${manifest.contact.lastName}`.trim();
  const rows: Array<[string, string | boolean | null]> = [
    ["Contact", contactName],
    ["Company", manifest.contact.company],
    ["Email", manifest.contact.email],
    ["Phone", manifest.contact.phone],
    ["Job title", manifest.contact.jobTitle],
    ["Quote requested at", receipt.submittedAt],
    ["Requested delivery date", manifest.requestedDeliveryDate],
    ["Lead-time preference", manifest.leadTimePreference],
    ["Destination postal code", manifest.destinationPostalCode],
    ["PO number", manifest.poNumber],
    ["NDA required", manifest.ndaRequired ? "Yes" : "No"],
    ["Global notes", manifest.globalNotes],
  ];
  return [
    "WordPress RFQ intake",
    ...rows
      .filter(([, value]) => value !== null && value !== "")
      .map(([label, value]) => `${label}: ${value}`),
  ].join("\n");
}
