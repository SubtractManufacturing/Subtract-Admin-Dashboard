import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  numeric,
  pgEnum,
  uuid,
  primaryKey,
  boolean,
} from "drizzle-orm/pg-core";

export const quoteStatusEnum = pgEnum("quote_status", [
  "Draft",
  "Sent",
  "Accepted",
  "Rejected",
  "Expired",
]);
export const leadTimeEnum = pgEnum("lead_time", [
  "Standard",
  "Expedited",
  "Custom",
]);
export const currencyEnum = pgEnum("currency", ["USD", "EUR", "GBP", "CNY"]);
export const orderStatusEnum = pgEnum("order_status", [
  "Pending",
  "In_Production",
  "Completed",
  "Cancelled",
  "Archived",
]);

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Will match Supabase auth.users.id
  name: text("name"),
  email: text("email").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const customers = pgTable("customers", {
  id: serial("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  phone: text("phone"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  displayName: text("display_name").notNull(),
  companyName: text("company_name"),
  contactName: text("contact_name"),
  email: text("email"),
  phone: text("phone"),
  address: text("address"),
  notes: text("notes"),
  discordId: text("discord_id"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const quotes = pgTable("quotes", {
  id: serial("id").primaryKey(),
  quoteNumber: text("quote_number").notNull(),
  customerId: integer("customer_id")
    .references(() => customers.id)
    .notNull(),
  vendorId: integer("vendor_id")
    .references(() => vendors.id)
    .notNull(),
  status: quoteStatusEnum("status").default("Draft").notNull(),
  leadTime: leadTimeEnum("lead_time"),
  currency: currencyEnum("currency").default("USD").notNull(),
  totalPrice: numeric("total_price"),
  validUntil: timestamp("valid_until"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  vendorId: integer("vendor_id").references(() => vendors.id),
  quoteId: integer("quote_id").references(() => quotes.id),
  status: orderStatusEnum("status").default("Pending").notNull(),
  totalPrice: numeric("total_price"),
  vendorPay: numeric("vendor_pay"),
  shipDate: timestamp("ship_date"),
  notes: text("notes"),
  leadTime: integer("lead_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const parts = pgTable("parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  partName: text("part_name"),
  notes: text("notes"),
  material: text("material"),
  tolerance: text("tolerance"),
  finishing: text("finishing"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  s3Bucket: text("s3_bucket").notNull(),
  s3Key: text("s3_key").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  fileSize: integer("file_size"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const partDrawings = pgTable("part_drawings", {
  partId: uuid("part_id").notNull().references(() => parts.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.partId, table.attachmentId] }),
}));

export const partModels = pgTable("part_models", {
  partId: uuid("part_id").notNull().references(() => parts.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.partId, table.attachmentId] }),
}));

export const orderLineItems = pgTable("order_line_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => orders.id),
  partId: uuid("part_id").references(() => parts.id),
  name: text("name"),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price").notNull(),
  notes: text("notes"),
});

export const quoteLineItems = pgTable("quote_line_items", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull().references(() => quotes.id),
  partId: uuid("part_id").references(() => parts.id),
  name: text("name"),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price").notNull(),
  notes: text("notes"),
});

export const orderAttachments = pgTable("order_attachments", {
  orderId: integer("order_id").notNull().references(() => orders.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.orderId, table.attachmentId] }),
}));

export const customerAttachments = pgTable("customer_attachments", {
  customerId: integer("customer_id").notNull().references(() => customers.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.customerId, table.attachmentId] }),
}));

export const vendorAttachments = pgTable("vendor_attachments", {
  vendorId: integer("vendor_id").notNull().references(() => vendors.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.vendorId, table.attachmentId] }),
}));

export const loginAuditLogs = pgTable("login_audit_logs", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  userId: text("user_id"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  success: boolean("success").notNull(),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  content: text("content").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  isArchived: boolean("is_archived").default(false).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Vendor = typeof vendors.$inferSelect;
export type NewVendor = typeof vendors.$inferInsert;
export type Quote = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Part = typeof parts.$inferSelect;
export type NewPart = typeof parts.$inferInsert;
export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;
export type PartDrawing = typeof partDrawings.$inferSelect;
export type NewPartDrawing = typeof partDrawings.$inferInsert;
export type PartModel = typeof partModels.$inferSelect;
export type NewPartModel = typeof partModels.$inferInsert;
export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type NewOrderLineItem = typeof orderLineItems.$inferInsert;
export type QuoteLineItem = typeof quoteLineItems.$inferSelect;
export type NewQuoteLineItem = typeof quoteLineItems.$inferInsert;
export type OrderAttachment = typeof orderAttachments.$inferSelect;
export type NewOrderAttachment = typeof orderAttachments.$inferInsert;
export type CustomerAttachment = typeof customerAttachments.$inferSelect;
export type NewCustomerAttachment = typeof customerAttachments.$inferInsert;
export type VendorAttachment = typeof vendorAttachments.$inferSelect;
export type NewVendorAttachment = typeof vendorAttachments.$inferInsert;
export type LoginAuditLog = typeof loginAuditLogs.$inferSelect;
export type NewLoginAuditLog = typeof loginAuditLogs.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
