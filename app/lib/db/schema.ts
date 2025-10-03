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
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const quoteStatusEnum = pgEnum("quote_status", [
  "RFQ",
  "Draft",
  "Sent",
  "Accepted",
  "Rejected",
  "Dropped",
  "Expired",
]);
export const leadTimeEnum = pgEnum("lead_time", [
  "Standard",
  "Expedited",
  "Custom",
]);
export const orderStatusEnum = pgEnum("order_status", [
  "Pending",
  "In_Production",
  "Completed",
  "Cancelled",
  "Archived",
]);
export const userRoleEnum = pgEnum("user_role", ["User", "Admin", "Dev"]);

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Will match Supabase auth.users.id
  name: text("name"),
  email: text("email").notNull(),
  role: userRoleEnum("role").default("User").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
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
  quoteNumber: text("quote_number").notNull().unique(),
  customerId: integer("customer_id")
    .references(() => customers.id)
    .notNull(),
  vendorId: integer("vendor_id").references(() => vendors.id),
  status: quoteStatusEnum("status").default("RFQ").notNull(),
  validUntil: timestamp("valid_until"),
  expirationDays: integer("expiration_days"),
  sentAt: timestamp("sent_at"),
  acceptedAt: timestamp("accepted_at"),
  expiredAt: timestamp("expired_at"),
  archivedAt: timestamp("archived_at"),
  subtotal: numeric("subtotal", { precision: 10, scale: 2 }),
  tax: numeric("tax", { precision: 10, scale: 2 }).default("0"),
  total: numeric("total", { precision: 10, scale: 2 }),
  createdById: text("created_by_id").references(() => users.id),
  convertedToOrderId: integer("converted_to_order_id"),
  rejectionReason: text("rejection_reason"),
  isArchived: boolean("is_archived").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  vendorId: integer("vendor_id").references(() => vendors.id),
  quoteId: integer("quote_id"),
  sourceQuoteId: integer("source_quote_id"),
  status: orderStatusEnum("status").default("Pending").notNull(),
  totalPrice: numeric("total_price"),
  vendorPay: numeric("vendor_pay"),
  shipDate: timestamp("ship_date"),
  notes: text("notes"),
  leadTime: integer("lead_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const meshConversionStatusEnum = pgEnum("mesh_conversion_status", [
  "pending",
  "queued", 
  "in_progress",
  "completed",
  "failed",
  "skipped"
]);

export const parts = pgTable("parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  customerId: integer("customer_id").references(() => customers.id),
  partName: text("part_name"),
  notes: text("notes"),
  material: text("material"),
  tolerance: text("tolerance"),
  finishing: text("finishing"),
  thumbnailUrl: text("thumbnail_url"),
  partFileUrl: text("part_file_url"), // Original CAD file (STEP, SLDPRT, etc.)
  partMeshUrl: text("part_mesh_url"), // Web-friendly 3D mesh (STL, OBJ, GLTF)
  meshConversionStatus: text("mesh_conversion_status").default("pending"),
  meshConversionError: text("mesh_conversion_error"),
  meshConversionJobId: text("mesh_conversion_job_id"),
  meshConversionStartedAt: timestamp("mesh_conversion_started_at"),
  meshConversionCompletedAt: timestamp("mesh_conversion_completed_at"),
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

export const quotePartDrawings = pgTable("quote_part_drawings", {
  quotePartId: uuid("quote_part_id").notNull().references(() => quoteParts.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.quotePartId, table.attachmentId] }),
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

export const quoteParts = pgTable("quote_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: integer("quote_id").notNull().references(() => quotes.id),
  partNumber: text("part_number").notNull(),
  partName: text("part_name").notNull(),
  description: text("description"),
  material: text("material"),
  finish: text("finish"),
  tolerance: text("tolerance"),
  thumbnailUrl: text("thumbnail_url"),
  partFileUrl: text("part_file_url"),
  partMeshUrl: text("part_mesh_url"),
  conversionStatus: meshConversionStatusEnum("conversion_status").default("pending"),
  meshConversionError: text("mesh_conversion_error"),
  meshConversionJobId: text("mesh_conversion_job_id"),
  meshConversionStartedAt: timestamp("mesh_conversion_started_at"),
  meshConversionCompletedAt: timestamp("mesh_conversion_completed_at"),
  specifications: jsonb("specifications"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const quoteLineItems = pgTable("quote_line_items", {
  id: serial("id").primaryKey(),
  quoteId: integer("quote_id").notNull().references(() => quotes.id),
  quotePartId: uuid("quote_part_id").references(() => quoteParts.id),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }).notNull(),
  leadTimeDays: integer("lead_time_days"),
  description: text("description"),
  notes: text("notes"),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const orderAttachments = pgTable("order_attachments", {
  orderId: integer("order_id").notNull().references(() => orders.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.orderId, table.attachmentId] }),
}));

export const quoteAttachments = pgTable("quote_attachments", {
  quoteId: integer("quote_id").notNull().references(() => quotes.id),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.quoteId, table.attachmentId] }),
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

export const featureFlags = pgTable("feature_flags", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: boolean("enabled").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export const eventCategoryEnum = pgEnum("event_category", [
  "status",
  "document",
  "financial",
  "communication",
  "system",
  "quality",
  "manufacturing",
]);


export const eventLogs = pgTable("event_logs", {
  id: uuid("id").primaryKey().defaultRandom(),

  // Polymorphic association
  entityType: text("entity_type").notNull(), // 'order', 'customer', 'vendor', 'part', 'quote'
  entityId: text("entity_id").notNull(),

  // Event details
  eventType: text("event_type").notNull(),
  eventCategory: eventCategoryEnum("event_category").notNull(),

  // Event data
  title: text("title").notNull(),
  description: text("description"),
  metadata: jsonb("metadata"), // Additional structured data

  // User tracking
  userId: text("user_id").references(() => users.id),
  userEmail: text("user_email"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),

  // Dismissal tracking
  isDismissed: boolean("is_dismissed").notNull().default(false),
  dismissedAt: timestamp("dismissed_at"),
  dismissedBy: text("dismissed_by"),

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  entityIdx: index("event_logs_entity_idx").on(table.entityType, table.entityId),
  timestampIdx: index("event_logs_timestamp_idx").on(table.createdAt),
  categoryIdx: index("event_logs_category_idx").on(table.eventCategory),
}));

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
export type QuotePartDrawing = typeof quotePartDrawings.$inferSelect;
export type NewQuotePartDrawing = typeof quotePartDrawings.$inferInsert;
export type PartModel = typeof partModels.$inferSelect;
export type NewPartModel = typeof partModels.$inferInsert;
export type OrderLineItem = typeof orderLineItems.$inferSelect;
export type NewOrderLineItem = typeof orderLineItems.$inferInsert;
export type QuotePart = typeof quoteParts.$inferSelect;
export type NewQuotePart = typeof quoteParts.$inferInsert;
export type QuoteLineItem = typeof quoteLineItems.$inferSelect;
export type NewQuoteLineItem = typeof quoteLineItems.$inferInsert;
export type OrderAttachment = typeof orderAttachments.$inferSelect;
export type NewOrderAttachment = typeof orderAttachments.$inferInsert;
export type QuoteAttachment = typeof quoteAttachments.$inferSelect;
export type NewQuoteAttachment = typeof quoteAttachments.$inferInsert;
export type CustomerAttachment = typeof customerAttachments.$inferSelect;
export type NewCustomerAttachment = typeof customerAttachments.$inferInsert;
export type VendorAttachment = typeof vendorAttachments.$inferSelect;
export type NewVendorAttachment = typeof vendorAttachments.$inferInsert;
export type LoginAuditLog = typeof loginAuditLogs.$inferSelect;
export type NewLoginAuditLog = typeof loginAuditLogs.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type FeatureFlag = typeof featureFlags.$inferSelect;
export type NewFeatureFlag = typeof featureFlags.$inferInsert;
export type EventLog = typeof eventLogs.$inferSelect;
export type NewEventLog = typeof eventLogs.$inferInsert;
