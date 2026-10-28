import type { IntakeManifest, ReceiptPointer } from "~/lib/rfq-intake/types";

export type QuoteCreationMetadataV1 = {
  version: 1;
  origin: "rfq_intake";
  contact: {
    email: string;
    firstName: string;
    lastName: string;
    company: string;
    phone: string;
    jobTitle: string;
  };
  receiptNumber: string;
  submittedAt: string;
  leadTimePreference: string;
  destinationPostalCode: string;
  requestedDeliveryDate: string;
  poNumber: string;
  referenceNumber: string;
  ndaRequired: boolean;
};

export type QuoteCreationMetadata = QuoteCreationMetadataV1;

export function buildRfqIntakeCreationMetadata(
  manifest: IntakeManifest,
  receipt: ReceiptPointer,
): QuoteCreationMetadata {
  const contact = manifest.contact;
  return {
    version: 1,
    origin: "rfq_intake",
    contact: {
      email: contact.email.trim(),
      firstName: contact.firstName.trim(),
      lastName: contact.lastName.trim(),
      company: (contact.company ?? "").trim(),
      phone: (contact.phone ?? "").trim(),
      jobTitle: (contact.jobTitle ?? "").trim(),
    },
    receiptNumber: (receipt.receiptNumber ?? "").trim(),
    submittedAt: receipt.submittedAt.trim(),
    leadTimePreference: (manifest.leadTimePreference ?? "").trim(),
    destinationPostalCode: (manifest.destinationPostalCode ?? "").trim(),
    requestedDeliveryDate: (manifest.requestedDeliveryDate ?? "").trim(),
    poNumber: (manifest.poNumber ?? "").trim(),
    referenceNumber: (manifest.referenceNumber ?? "").trim(),
    ndaRequired: manifest.ndaRequired,
  };
}

export function parseQuoteCreationMetadata(
  raw: unknown,
): QuoteCreationMetadata | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || o.origin !== "rfq_intake") return null;
  if (!o.contact || typeof o.contact !== "object") return null;
  const c = o.contact as Record<string, unknown>;
  if (typeof c.email !== "string") return null;
  return raw as QuoteCreationMetadata;
}
