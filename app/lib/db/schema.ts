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
  foreignKey,
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
  "Waiting_For_Shop_Selection",
  "In_Production",
  "In_Inspection",
  "Shipped",
  "Delivered",
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

export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    displayName: text("display_name").notNull(),

    // Contact info
    companyName: text("company_name"),
    contactName: text("contact_name"),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimaryContact: boolean("is_primary_contact").default(false),

    // Billing address (structured for shipping integrations)
    billingAddressLine1: text("billing_address_line1"),
    billingAddressLine2: text("billing_address_line2"),
    billingCity: text("billing_city"),
    billingState: text("billing_state"),
    billingPostalCode: text("billing_postal_code"),
    billingCountry: text("billing_country").default("US"),

    // Shipping address (structured for shipping integrations)
    shippingAddressLine1: text("shipping_address_line1"),
    shippingAddressLine2: text("shipping_address_line2"),
    shippingCity: text("shipping_city"),
    shippingState: text("shipping_state"),
    shippingPostalCode: text("shipping_postal_code"),
    shippingCountry: text("shipping_country").default("US"),

    // Business terms
    paymentTerms: text("payment_terms"),

    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyNameIdx: index("customers_company_name_idx").on(table.companyName),
  })
);

export const vendors = pgTable(
  "vendors",
  {
    id: serial("id").primaryKey(),
    displayName: text("display_name").notNull(),

    // Contact info
    companyName: text("company_name"),
    contactName: text("contact_name"),
    title: text("title"),
    email: text("email"),
    phone: text("phone"),
    isPrimaryContact: boolean("is_primary_contact").default(false),

    // Billing address (structured for shipping integrations)
    billingAddressLine1: text("billing_address_line1"),
    billingAddressLine2: text("billing_address_line2"),
    billingCity: text("billing_city"),
    billingState: text("billing_state"),
    billingPostalCode: text("billing_postal_code"),
    billingCountry: text("billing_country").default("US"),

    // Shipping address (structured for shipping integrations)
    shippingAddressLine1: text("shipping_address_line1"),
    shippingAddressLine2: text("shipping_address_line2"),
    shippingCity: text("shipping_city"),
    shippingState: text("shipping_state"),
    shippingPostalCode: text("shipping_postal_code"),
    shippingCountry: text("shipping_country").default("US"),

    // Business terms
    paymentTerms: text("payment_terms"),

    // Legacy fields
    address: text("address"), // Keep for now, can migrate data later
    notes: text("notes"),
    discordId: text("discord_id"),

    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    companyNameIdx: index("vendors_company_name_idx").on(table.companyName),
  })
);

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
  total: numeric("total", { precision: 10, scale: 2 }),
  createdById: text("created_by_id").references(() => users.id),
  convertedToOrderId: integer("converted_to_order_id").references(
    () => orders.id
  ),
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
  totalPrice: numeric("total_price", { precision: 10, scale: 2 }),
  vendorPay: numeric("vendor_pay", { precision: 10, scale: 2 }),
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
  "skipped",
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
  thumbnailS3Key: text("thumbnail_s3_key"), // For PDF/document thumbnails
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const partDrawings = pgTable(
  "part_drawings",
  {
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.partId, table.attachmentId] }),
  })
);

export const quotePartDrawings = pgTable(
  "quote_part_drawings",
  {
    quotePartId: uuid("quote_part_id")
      .notNull()
      .references(() => quoteParts.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.quotePartId, table.attachmentId] }),
  })
);

export const partModels = pgTable(
  "part_models",
  {
    partId: uuid("part_id")
      .notNull()
      .references(() => parts.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.partId, table.attachmentId] }),
  })
);

export const orderLineItems = pgTable("order_line_items", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id")
    .notNull()
    .references(() => orders.id),
  partId: uuid("part_id").references(() => parts.id),
  name: text("name"),
  description: text("description"),
  quantity: integer("quantity").notNull(),
  unitPrice: numeric("unit_price", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
});

export const quoteParts = pgTable("quote_parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: integer("quote_id")
    .notNull()
    .references(() => quotes.id),
  partNumber: text("part_number").notNull(),
  partName: text("part_name").notNull(),
  description: text("description"),
  material: text("material"),
  finish: text("finish"),
  tolerance: text("tolerance"),
  thumbnailUrl: text("thumbnail_url"),
  partFileUrl: text("part_file_url"),
  partMeshUrl: text("part_mesh_url"),
  conversionStatus:
    meshConversionStatusEnum("conversion_status").default("pending"),
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
  quoteId: integer("quote_id")
    .notNull()
    .references(() => quotes.id),
  quotePartId: uuid("quote_part_id").references(() => quoteParts.id),
  name: text("name"),
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

export const orderAttachments = pgTable(
  "order_attachments",
  {
    orderId: integer("order_id")
      .notNull()
      .references(() => orders.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.orderId, table.attachmentId] }),
  })
);

export const quoteAttachments = pgTable(
  "quote_attachments",
  {
    quoteId: integer("quote_id")
      .notNull()
      .references(() => quotes.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.quoteId, table.attachmentId] }),
  })
);

export const customerAttachments = pgTable(
  "customer_attachments",
  {
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.customerId, table.attachmentId] }),
  })
);

export const vendorAttachments = pgTable(
  "vendor_attachments",
  {
    vendorId: integer("vendor_id")
      .notNull()
      .references(() => vendors.id),
    attachmentId: uuid("attachment_id")
      .notNull()
      .references(() => attachments.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.vendorId, table.attachmentId] }),
  })
);

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

// Email "Send As" addresses configuration
export const emailSendAsAddresses = pgTable("email_send_as_addresses", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  label: text("label").notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  createdBy: text("created_by"),
});

export type EmailSendAsAddress = typeof emailSendAsAddresses.$inferSelect;
export type NewEmailSendAsAddress = typeof emailSendAsAddresses.$inferInsert;

export const eventCategoryEnum = pgEnum("event_category", [
  "status",
  "document",
  "financial",
  "communication",
  "system",
  "quality",
  "manufacturing",
]);

export const eventLogs = pgTable(
  "event_logs",
  {
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
  },
  (table) => ({
    entityIdx: index("event_logs_entity_idx").on(
      table.entityType,
      table.entityId
    ),
    timestampIdx: index("event_logs_timestamp_idx").on(table.createdAt),
    categoryIdx: index("event_logs_category_idx").on(table.eventCategory),
  })
);

// CAD File Version tracking for quote parts and regular parts
export const cadFileVersions = pgTable(
  "cad_file_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // Polymorphic reference (quote part or regular part)
    entityType: text("entity_type").notNull(), // "quote_part" or "part"
    entityId: uuid("entity_id").notNull(), // quotePartId or partId

    // Version info
    version: integer("version").notNull(),
    isCurrentVersion: boolean("is_current_version").default(false).notNull(),

    // File info (CAD file only - mesh is stored on parent entity)
    s3Key: text("s3_key").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size"),
    contentType: text("content_type"),

    // Audit trail
    uploadedBy: text("uploaded_by").references(() => users.id),
    uploadedByEmail: text("uploaded_by_email"), // Denormalized for audit
    notes: text("notes"), // Optional revision notes

    // Timestamps
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    entityIdx: index("cad_versions_entity_idx").on(
      table.entityType,
      table.entityId
    ),
    currentIdx: index("cad_versions_current_idx").on(
      table.entityType,
      table.entityId,
      table.isCurrentVersion
    ),
    versionIdx: index("cad_versions_version_idx").on(
      table.entityType,
      table.entityId,
      table.version
    ),
  })
);

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

// Quote Pricing Calculator Schema
export const quotePriceCalculations = pgTable(
  "quote_price_calculations",
  {
    id: serial("id").primaryKey(),
    quoteId: integer("quote_id")
      .notNull()
      .references(() => quotes.id),
    quoteLineItemId: integer("quote_line_item_id"),
    quotePartId: uuid("quote_part_id").references(() => quoteParts.id),

    // Base inputs
    toolpathGrandTotal: numeric("toolpath_grand_total", {
      precision: 10,
      scale: 2,
    }).notNull(),

    // Lead time
    leadTimeOption: text("lead_time_option").notNull(), // "3-5 Days", "5-7 Days", "7-12 Days"
    leadTimeMultiplier: numeric("lead_time_multiplier", {
      precision: 4,
      scale: 2,
    }).notNull(),

    // Thread costs
    smallThreadCount: integer("small_thread_count").default(0).notNull(),
    smallThreadRate: numeric("small_thread_rate", { precision: 6, scale: 2 })
      .default("0.90")
      .notNull(),
    mediumThreadCount: integer("medium_thread_count").default(0).notNull(),
    mediumThreadRate: numeric("medium_thread_rate", { precision: 6, scale: 2 })
      .default("0.75")
      .notNull(),
    largeThreadCount: integer("large_thread_count").default(0).notNull(),
    largeThreadRate: numeric("large_thread_rate", { precision: 6, scale: 2 })
      .default("1.10")
      .notNull(),
    totalThreadCost: numeric("total_thread_cost", {
      precision: 10,
      scale: 2,
    }).notNull(),

    // Multipliers
    complexityMultiplier: numeric("complexity_multiplier", {
      precision: 4,
      scale: 2,
    }).notNull(),
    toleranceMultiplier: numeric("tolerance_multiplier", {
      precision: 4,
      scale: 2,
    }).notNull(),

    // Optional tooling
    toolingCost: numeric("tooling_cost", { precision: 10, scale: 2 }),
    toolingMarkup: numeric("tooling_markup", { precision: 10, scale: 2 }),

    // Calculated prices
    basePrice: numeric("base_price", { precision: 10, scale: 2 }).notNull(),
    adjustedPrice: numeric("adjusted_price", {
      precision: 10,
      scale: 2,
    }).notNull(),
    finalPrice: numeric("final_price", { precision: 10, scale: 2 }).notNull(),

    // Metadata
    notes: text("notes"),
    calculatedBy: text("calculated_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    lineItemFk: foreignKey({
      columns: [table.quoteLineItemId],
      foreignColumns: [quoteLineItems.id],
      name: "quote_calc_line_item_fk",
    }).onDelete("cascade"),
  })
);

export const quotePriceCalculationTemplates = pgTable(
  "quote_price_calculation_templates",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),

    // Default values
    leadTimeOption: text("lead_time_option"),
    smallThreadCount: integer("small_thread_count"),
    mediumThreadCount: integer("medium_thread_count"),
    largeThreadCount: integer("large_thread_count"),
    complexityMultiplier: numeric("complexity_multiplier", {
      precision: 4,
      scale: 2,
    }),
    toleranceMultiplier: numeric("tolerance_multiplier", {
      precision: 4,
      scale: 2,
    }),

    // Metadata
    isGlobal: boolean("is_global").default(false).notNull(),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }
);

// Developer Settings for storing key-value configuration (e.g., banana model URLs)
export const developerSettings = pgTable("developer_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

// Email tracking enums
export const emailDirectionEnum = pgEnum("email_direction", [
  "inbound",
  "outbound",
]);

export const emailStatusEnum = pgEnum("email_status", [
  "sent",
  "delivered",
  "bounced",
  "spam_complaint",
  "failed",
]);

// Emails table - tracks all inbound and outbound email communications
export const emails = pgTable(
  "emails",
  {
    id: serial("id").primaryKey(),

    // Postmark identifiers
    postmarkMessageId: text("postmark_message_id").unique(),
    postmarkMessageStreamId: text("postmark_message_stream_id"),

    // Threading - CRITICAL for conversation grouping
    threadId: text("thread_id").notNull(), // UUID generated for thread root, inherited by replies

    // Direction and status
    direction: emailDirectionEnum("direction").notNull(),
    status: emailStatusEnum("status").default("sent").notNull(),

    // Email addresses
    fromAddress: text("from_address").notNull(),
    fromName: text("from_name"),
    toAddresses: text("to_addresses").array().notNull(),
    ccAddresses: text("cc_addresses").array(),
    bccAddresses: text("bcc_addresses").array(),
    replyTo: text("reply_to"),

    // Content
    subject: text("subject").notNull(),
    textBody: text("text_body"),
    htmlBody: text("html_body"),

    // Headers for threading
    messageId: text("message_id"), // RFC 2822 Message-ID
    inReplyTo: text("in_reply_to"),
    references: text("references"),

    // Entity relationships (nullable) - stored in metadata AND columns for efficient queries
    quoteId: integer("quote_id").references(() => quotes.id),
    orderId: integer("order_id").references(() => orders.id),
    customerId: integer("customer_id").references(() => customers.id),
    vendorId: integer("vendor_id").references(() => vendors.id),

    // Metadata - CRITICAL: includes Postmark metadata for efficient lookups
    metadata: jsonb("metadata"), // Contains: { quoteId, orderId, customerId, postmarkMetadata }

    // Gmail mirroring
    gmailMirrored: boolean("gmail_mirrored").default(false),

    // Timestamps
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    bouncedAt: timestamp("bounced_at"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // CRITICAL: These indexes are essential for performance at scale (1000+ emails)
    quoteIdx: index("emails_quote_idx").on(table.quoteId),
    orderIdx: index("emails_order_idx").on(table.orderId),
    customerIdx: index("emails_customer_idx").on(table.customerId),
    messageIdIdx: index("emails_message_id_idx").on(table.messageId),
    postmarkIdx: index("emails_postmark_idx").on(table.postmarkMessageId),
    threadIdx: index("emails_thread_idx").on(table.threadId), // For thread queries
    inReplyToIdx: index("emails_in_reply_to_idx").on(table.inReplyTo), // For thread matching
    directionStatusIdx: index("emails_direction_status_idx").on(
      table.direction,
      table.status
    ), // For inbox filtering
    sentAtIdx: index("emails_sent_at_idx").on(table.sentAt), // For sorting by date
  })
);

// Email attachments table - tracks attachments stored in S3
export const emailAttachments = pgTable(
  "email_attachments",
  {
    id: serial("id").primaryKey(),
    emailId: integer("email_id")
      .references(() => emails.id)
      .notNull(),

    filename: text("filename").notNull(),
    contentType: text("content_type"),
    contentLength: integer("content_length"),

    // Storage location (S3)
    s3Bucket: text("s3_bucket"),
    s3Key: text("s3_key"),

    // Postmark specific
    contentId: text("content_id"), // For inline attachments

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index("email_attachments_email_idx").on(table.emailId),
  })
);

export type QuotePriceCalculation = typeof quotePriceCalculations.$inferSelect;
export type NewQuotePriceCalculation =
  typeof quotePriceCalculations.$inferInsert;
export type QuotePriceCalculationTemplate =
  typeof quotePriceCalculationTemplates.$inferSelect;
export type NewQuotePriceCalculationTemplate =
  typeof quotePriceCalculationTemplates.$inferInsert;
export type CadFileVersion = typeof cadFileVersions.$inferSelect;
export type NewCadFileVersion = typeof cadFileVersions.$inferInsert;
export type DeveloperSetting = typeof developerSettings.$inferSelect;
export type NewDeveloperSetting = typeof developerSettings.$inferInsert;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type EmailAttachment = typeof emailAttachments.$inferSelect;
export type NewEmailAttachment = typeof emailAttachments.$inferInsert;