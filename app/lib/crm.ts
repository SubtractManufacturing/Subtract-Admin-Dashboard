import { and, count, desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  accounts,
  contacts,
  organizationCommunications,
  organizationContacts,
  organizations,
  users,
  type NewOrganizationCommunication,
  type OrganizationCommunication,
} from "./db/schema";
import { createEvent } from "./events";
import {
  COMMUNICATION_METHOD_LABELS,
  COMMUNICATION_METHODS,
  CRM_PAGE_SIZE,
  type CommunicationMethod,
} from "./crm-constants";

export {
  COMMUNICATION_METHOD_LABELS,
  COMMUNICATION_METHODS,
  CRM_PAGE_SIZE,
  isCommunicationMethod,
  type CommunicationMethod,
} from "./crm-constants";

export type CrmEventContext = {
  userId?: string;
  userEmail?: string;
};

export type CustomerCommunicationListItem = OrganizationCommunication & {
  /** The Organization's customer account, for links to the Customer page. */
  customerAccountId: string | null;
  customerDisplayName: string;
  contactName: string | null;
  authorName: string | null;
  authorEmail: string | null;
};

export type ListCommunicationsParams = {
  /** Communications of one Organization; omit for all. */
  organizationId?: string;
  page?: number; // 1-based
  pageSize?: number;
};

/** Communications are logged against the Organization (ADR-0013). */
export async function listCustomerCommunications(
  params: ListCommunicationsParams = {},
): Promise<{
  items: CustomerCommunicationListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const pageSize = params.pageSize ?? CRM_PAGE_SIZE;
  const conditions = [eq(organizationCommunications.isArchived, false)];
  if (params.organizationId != null) {
    conditions.push(eq(organizationCommunications.organizationId, params.organizationId));
  }
  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: count() })
    .from(organizationCommunications)
    .where(where);

  const totalCount = Number(countRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(params.page ?? 1, 1), totalPages);
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select({
      id: organizationCommunications.id,
      organizationId: organizationCommunications.organizationId,
      contactId: organizationCommunications.contactId,
      method: organizationCommunications.method,
      note: organizationCommunications.note,
      createdBy: organizationCommunications.createdBy,
      createdAt: organizationCommunications.createdAt,
      isArchived: organizationCommunications.isArchived,
      customerAccountId: accounts.id,
      customerDisplayName: organizations.name,
      contactName: contacts.name,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(organizationCommunications)
    .innerJoin(organizations, eq(organizationCommunications.organizationId, organizations.id))
    .leftJoin(
      accounts,
      and(eq(accounts.organizationId, organizations.id), eq(accounts.type, "customer")),
    )
    .leftJoin(contacts, eq(contacts.id, organizationCommunications.contactId))
    .leftJoin(users, eq(organizationCommunications.createdBy, users.id))
    .where(where)
    .orderBy(desc(organizationCommunications.createdAt))
    .limit(pageSize)
    .offset(offset);

  return { items: rows, totalCount, page, pageSize, totalPages };
}

/**
 * Log a communication with a Customer. `customerId` is the customer account
 * id; the entry is stored on its Organization, optionally naming a Contact.
 */
export async function createCustomerCommunication(
  data: {
    customerId: string;
    contactId?: string | null;
    method: CommunicationMethod;
    note: string;
    createdBy: string;
  },
  eventContext?: CrmEventContext,
): Promise<OrganizationCommunication> {
  const note = data.note.trim();
  if (!note) {
    throw new Error("Note is required");
  }
  if (!COMMUNICATION_METHODS.includes(data.method)) {
    throw new Error("Invalid communication method");
  }

  const [customer] = await db
    .select({ organizationId: organizations.id, displayName: organizations.name })
    .from(accounts)
    .innerJoin(organizations, eq(organizations.id, accounts.organizationId))
    .where(
      and(
        eq(accounts.id, data.customerId),
        eq(accounts.type, "customer"),
        eq(accounts.isArchived, false),
        eq(organizations.isArchived, false),
      ),
    )
    .limit(1);

  if (!customer) {
    throw new Error("Customer not found");
  }

  let contactId: string | null = null;
  if (data.contactId) {
    const [link] = await db
      .select({ contactId: organizationContacts.contactId })
      .from(organizationContacts)
      .where(
        and(
          eq(organizationContacts.organizationId, customer.organizationId),
          eq(organizationContacts.contactId, data.contactId),
          eq(organizationContacts.isArchived, false),
        ),
      )
      .limit(1);
    if (!link) throw new Error("Contact not found on this Customer");
    contactId = link.contactId;
  }

  const insertValues: NewOrganizationCommunication = {
    organizationId: customer.organizationId,
    contactId,
    method: data.method,
    note,
    createdBy: data.createdBy,
  };

  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(organizationCommunications)
      .values(insertValues)
      .returning();

    await createEvent(
      {
        entityType: "customer",
        entityId: data.customerId,
        eventType: "crm_communication_logged",
        eventCategory: "communication",
        title: "Communication logged",
        description: `${COMMUNICATION_METHOD_LABELS[data.method]} with ${customer.displayName}`,
        metadata: {
          communicationId: created.id,
          contactId,
          method: data.method,
          notePreview: note.substring(0, 100),
        },
        userId: eventContext?.userId,
        userEmail: eventContext?.userEmail,
      },
      tx,
    );

    return created;
  });
}
