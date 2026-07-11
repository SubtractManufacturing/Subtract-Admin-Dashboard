import { and, count, desc, eq } from "drizzle-orm";
import { db } from "./db";
import {
  customerCommunications,
  customers,
  users,
  type CustomerCommunication,
  type NewCustomerCommunication,
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

export type CustomerCommunicationListItem = CustomerCommunication & {
  customerDisplayName: string;
  authorName: string | null;
  authorEmail: string | null;
};

export type ListCommunicationsParams = {
  customerId?: number;
  page?: number; // 1-based
  pageSize?: number;
};

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
  const conditions = [eq(customerCommunications.isArchived, false)];
  if (params.customerId != null) {
    conditions.push(eq(customerCommunications.customerId, params.customerId));
  }
  const where = and(...conditions);

  const [countRow] = await db
    .select({ count: count() })
    .from(customerCommunications)
    .where(where);

  const totalCount = Number(countRow?.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(Math.max(params.page ?? 1, 1), totalPages);
  const offset = (page - 1) * pageSize;

  const rows = await db
    .select({
      id: customerCommunications.id,
      customerId: customerCommunications.customerId,
      method: customerCommunications.method,
      note: customerCommunications.note,
      createdBy: customerCommunications.createdBy,
      createdAt: customerCommunications.createdAt,
      isArchived: customerCommunications.isArchived,
      customerDisplayName: customers.displayName,
      authorName: users.name,
      authorEmail: users.email,
    })
    .from(customerCommunications)
    .innerJoin(customers, eq(customerCommunications.customerId, customers.id))
    .leftJoin(users, eq(customerCommunications.createdBy, users.id))
    .where(where)
    .orderBy(desc(customerCommunications.createdAt))
    .limit(pageSize)
    .offset(offset);

  return { items: rows, totalCount, page, pageSize, totalPages };
}

export async function createCustomerCommunication(
  data: {
    customerId: number;
    method: CommunicationMethod;
    note: string;
    createdBy: string;
  },
  eventContext?: CrmEventContext,
): Promise<CustomerCommunication> {
  const note = data.note.trim();
  if (!note) {
    throw new Error("Note is required");
  }
  if (!COMMUNICATION_METHODS.includes(data.method)) {
    throw new Error("Invalid communication method");
  }

  const [customer] = await db
    .select({ id: customers.id, displayName: customers.displayName })
    .from(customers)
    .where(
      and(eq(customers.id, data.customerId), eq(customers.isArchived, false)),
    )
    .limit(1);

  if (!customer) {
    throw new Error("Customer not found");
  }

  const insertValues: NewCustomerCommunication = {
    customerId: data.customerId,
    method: data.method,
    note,
    createdBy: data.createdBy,
  };

  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(customerCommunications)
      .values(insertValues)
      .returning();

    await createEvent(
      {
        entityType: "customer",
        entityId: String(data.customerId),
        eventType: "crm_communication_logged",
        eventCategory: "communication",
        title: "Communication logged",
        description: `${COMMUNICATION_METHOD_LABELS[data.method]} with ${customer.displayName}`,
        metadata: {
          communicationId: created.id,
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
