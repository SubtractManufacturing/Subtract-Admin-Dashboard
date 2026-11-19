/**
 * Contact and address intents shared by the Customer and Vendor pages
 * (ADR-0013). Each page passes the account it shows; every write is checked
 * against that account's Organization by the data layer.
 */
import { json } from "@remix-run/node";

import { createEvent } from "../events";
import {
  AccountProfileError,
  addAddress,
  addContact,
  archiveAddress,
  removeContact,
  setBillingAddress,
  setDefaultShippingAddress,
  setPrimaryContact,
  updateAddress,
  updateContact,
} from "./accounts.server";
import type { AccountRecord, AddressInput, ContactInput } from "./types";
import { uuidField } from "./types";

export const ORGANIZATION_INTENTS = [
  "addContact",
  "updateContact",
  "setPrimaryContact",
  "removeContact",
  "addAddress",
  "updateAddress",
  "setDefaultShipping",
  "setBillingAddress",
  "archiveAddress",
] as const;

export type OrganizationIntent = (typeof ORGANIZATION_INTENTS)[number];

export function isOrganizationIntent(intent: unknown): intent is OrganizationIntent {
  return typeof intent === "string" && (ORGANIZATION_INTENTS as readonly string[]).includes(intent);
}

function text(form: FormData, key: string): string | null | undefined {
  if (!form.has(key)) return undefined;
  const value = String(form.get(key) ?? "").trim();
  return value ? value : null;
}

function contactInput(form: FormData): ContactInput {
  return {
    name: text(form, "contactName"),
    title: text(form, "title"),
    email: text(form, "email"),
    phone: text(form, "phone"),
    role: text(form, "role"),
  };
}

function addressInput(form: FormData): AddressInput {
  return {
    label: text(form, "label"),
    line1: text(form, "line1"),
    line2: text(form, "line2"),
    city: text(form, "city"),
    state: text(form, "state"),
    postalCode: text(form, "postalCode"),
    country: text(form, "country"),
  };
}

const TITLES: Record<OrganizationIntent, string> = {
  addContact: "Contact added",
  updateContact: "Contact updated",
  setPrimaryContact: "Primary contact changed",
  removeContact: "Contact removed",
  addAddress: "Address added",
  updateAddress: "Address updated",
  setDefaultShipping: "Default shipping address changed",
  setBillingAddress: "Billing address changed",
  archiveAddress: "Address removed",
};

/** Handle one Contact/address intent for `account`'s Organization. */
export async function handleOrganizationIntent(
  intent: OrganizationIntent,
  form: FormData,
  account: Pick<AccountRecord, "id" | "type" | "organizationId">,
  eventContext: { userId?: string; userEmail?: string },
): Promise<Response> {
  const orgId = account.organizationId;
  const contactId = uuidField(form.get("contactId"));
  const addressId = uuidField(form.get("addressId"));
  try {
    let subjectId: string | null = contactId ?? addressId;
    switch (intent) {
      case "addContact":
        subjectId = await addContact(orgId, contactInput(form), {
          makePrimary: form.get("makePrimary") === "true",
        });
        break;
      case "updateContact":
        if (!contactId) return json({ error: "Contact is required" }, { status: 400 });
        await updateContact(orgId, contactId, contactInput(form));
        break;
      case "setPrimaryContact":
        if (!contactId) return json({ error: "Contact is required" }, { status: 400 });
        await setPrimaryContact(orgId, contactId);
        break;
      case "removeContact":
        if (!contactId) return json({ error: "Contact is required" }, { status: 400 });
        await removeContact(orgId, contactId);
        break;
      case "addAddress":
        subjectId = await addAddress(orgId, addressInput(form), {
          makeDefaultShipping: form.get("makeDefaultShipping") === "true",
        });
        if (form.get("useForBilling") === "true") await setBillingAddress(account.id, subjectId);
        break;
      case "updateAddress":
        if (!addressId) return json({ error: "Address is required" }, { status: 400 });
        await updateAddress(orgId, addressId, addressInput(form));
        break;
      case "setDefaultShipping":
        if (!addressId) return json({ error: "Address is required" }, { status: 400 });
        await setDefaultShippingAddress(orgId, addressId);
        break;
      case "setBillingAddress":
        await setBillingAddress(account.id, addressId);
        break;
      case "archiveAddress":
        if (!addressId) return json({ error: "Address is required" }, { status: 400 });
        await archiveAddress(orgId, addressId);
        break;
    }
    await createEvent({
      entityType: account.type,
      entityId: account.id,
      eventType: `organization_${intent.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}`,
      eventCategory: "system",
      title: TITLES[intent],
      metadata: { organizationId: orgId, subjectId },
      userId: eventContext.userId,
      userEmail: eventContext.userEmail,
    });
    return json({ ok: true, intent });
  } catch (error) {
    if (error instanceof AccountProfileError) {
      return json({ error: error.message, intent }, { status: error.status });
    }
    throw error;
  }
}
