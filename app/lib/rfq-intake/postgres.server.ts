import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../db";
import {
  actionItems,
  attachments,
  customers,
  eventLogs,
  notes,
  quoteAttachments,
  quoteLineItems,
  quotePartDrawings,
  quoteParts,
  quotes,
  rfqImportLedger,
} from "../db/schema";
import type {
  ImportLedgerSummary,
  PreparedImport,
  RfqPersistence,
} from "./types";

function displayName(contact: PreparedImport["manifest"]["contact"]): string {
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  return contact.company ? `${contact.company} - ${name}` : name;
}

function nextQuoteNumber(existing: string[], now: Date): string {
  const year = now.getFullYear().toString().slice(-2);
  const month = String(now.getMonth() + 1);
  const prefix = `Q${year}${month}-`;
  let letter = "A";
  let sequence = 99;
  for (const value of existing) {
    const match = /^Q(\d{2})(\d{1,2})-([A-Z])(\d+)$/.exec(value);
    if (!match || `Q${match[1]}${match[2]}-` !== prefix) continue;
    const candidateLetter = match[3];
    const candidateSequence = Number(match[4]);
    if (
      candidateLetter.charCodeAt(0) > letter.charCodeAt(0) ||
      (candidateLetter === letter && candidateSequence > sequence)
    ) {
      letter = candidateLetter;
      sequence = candidateSequence;
    }
  }
  if (sequence >= 999) {
    letter = String.fromCharCode(letter.charCodeAt(0) + 1);
    if (letter > "Z") throw new Error(`Maximum Quote number reached for ${year}/${month}`);
    sequence = 99;
  }
  return `${prefix}${letter}${String(sequence + 1).padStart(3, "0")}`;
}

async function upsertFailureActionItem(input: {
  receiptNumber: string;
  description: string;
  classification: string;
  nextAttemptAt: Date | null;
  now: Date;
}) {
  const values = {
    status: "active" as const,
    title: `RFQ import failed: ${input.receiptNumber}`,
    description: input.description,
    metadata: {
      receiptNumber: input.receiptNumber,
      classification: input.classification,
      nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
    },
    resolvedAt: null,
    resolvedBy: null,
    resolution: null,
    updatedAt: input.now,
  };

  await db
    .insert(actionItems)
    .values({
      type: "rfq_import_failure",
      entityType: "rfq_import",
      entityId: input.receiptNumber,
      ...values,
    })
    .onConflictDoUpdate({
      target: [actionItems.type, actionItems.entityType, actionItems.entityId],
      targetWhere: sql`type = 'rfq_import_failure' and deleted_at is null`,
      set: values,
    });
}

async function resolveFailureActionItem(receiptNumber: string, now: Date) {
  await db
    .update(actionItems)
    .set({
      status: "resolved",
      resolvedAt: now,
      resolution: "Import completed successfully",
      updatedAt: now,
    })
    .where(
      and(
        eq(actionItems.type, "rfq_import_failure"),
        eq(actionItems.entityType, "rfq_import"),
        eq(actionItems.entityId, receiptNumber),
        eq(actionItems.status, "active"),
        isNull(actionItems.deletedAt),
      ),
    );
}

export async function getRfqLedgerSummaries(
  receiptKeys: string[],
): Promise<Map<string, ImportLedgerSummary>> {
  if (receiptKeys.length === 0) return new Map();
  const rows = await db
    .select({
      receiptKey: rfqImportLedger.receiptKey,
      status: rfqImportLedger.status,
      nextAttemptAt: rfqImportLedger.nextAttemptAt,
    })
    .from(rfqImportLedger)
    .where(inArray(rfqImportLedger.receiptKey, receiptKeys));
  return new Map(
    rows.map((row) => [
      row.receiptKey,
      { status: row.status, nextAttemptAt: row.nextAttemptAt },
    ]),
  );
}

export const postgresRfqPersistence: RfqPersistence = {
  async findImportByReceiptKey(receiptKey) {
    const [ledger] = await db
      .select()
      .from(rfqImportLedger)
      .where(eq(rfqImportLedger.receiptKey, receiptKey))
      .limit(1);
    return ledger
      ? {
          receipt: {
            receiptNumber: ledger.receiptNumber,
            sessionId: ledger.sessionId,
            receiptKey: ledger.receiptKey,
            manifestKey: `${`intake/${ledger.sessionId}/`}meta/manifest.json`,
          },
          status: ledger.status,
          quoteId: ledger.quoteId,
        }
      : null;
  },

  async claimImport(receipt, now) {
    return db.transaction(async (tx) => {
      await tx
        .insert(rfqImportLedger)
        .values({
          receiptNumber: receipt.receiptNumber,
          sessionId: receipt.sessionId,
          receiptKey: receipt.receiptKey,
          status: "pending",
        })
        .onConflictDoNothing({ target: rfqImportLedger.receiptNumber });

      const [ledger] = await tx
        .select()
        .from(rfqImportLedger)
        .where(eq(rfqImportLedger.receiptNumber, receipt.receiptNumber))
        .for("update")
        .limit(1);
      if (!ledger) throw new Error("RFQ import ledger claim failed");
      if (ledger.receiptKey !== receipt.receiptKey || ledger.sessionId !== receipt.sessionId) {
        throw new Error("Receipt number was reused by a different intake package");
      }
      if (ledger.status === "completed" && ledger.quoteId) {
        return { kind: "already_completed" as const, quoteId: ledger.quoteId };
      }
      if (ledger.status === "cleanup_pending" && ledger.quoteId) {
        return {
          kind: "cleanup_only" as const,
          quoteId: ledger.quoteId,
          sessionId: ledger.sessionId,
        };
      }
      if (ledger.status === "processing") return { kind: "already_processing" as const };
      if (ledger.status === "permanent_failure") {
        return { kind: "already_processing" as const };
      }
      if (
        ledger.status === "retry_scheduled" &&
        ledger.nextAttemptAt &&
        ledger.nextAttemptAt > now
      ) {
        return { kind: "already_processing" as const };
      }

      const attemptCount = ledger.attemptCount + 1;
      await tx
        .update(rfqImportLedger)
        .set({
          status: "processing",
          attemptCount,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(eq(rfqImportLedger.id, ledger.id));
      return { kind: "claimed" as const, attemptCount };
    });
  },

  async commitImport(prepared) {
    return db.transaction(async (tx) => {
      // The lock protects the human-readable number generator without holding locks during S3 work.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('rfq-intake-quote-number'))`);
      const [ledger] = await tx
        .select()
        .from(rfqImportLedger)
        .where(eq(rfqImportLedger.receiptNumber, prepared.receipt.receiptNumber))
        .for("update")
        .limit(1);
      if (!ledger || ledger.status !== "processing") {
        throw new Error("RFQ import no longer owns its database claim");
      }

      const matchingCustomers = await tx
        .select()
        .from(customers)
        .where(
          and(
            eq(customers.isArchived, false),
            sql`lower(trim(${customers.email})) = ${prepared.manifest.contact.email}`,
          ),
        );
      let customerId: number;
      if (matchingCustomers.length === 1) {
        const customer = matchingCustomers[0];
        const [updated] = await tx
          .update(customers)
          .set({
            companyName: customer.companyName || prepared.manifest.contact.company,
            contactName:
              customer.contactName ||
              `${prepared.manifest.contact.firstName} ${prepared.manifest.contact.lastName}`.trim(),
            phone: customer.phone || prepared.manifest.contact.phone,
            updatedAt: prepared.now,
          })
          .where(eq(customers.id, customer.id))
          .returning({ id: customers.id });
        customerId = updated.id;
      } else {
        const [created] = await tx
          .insert(customers)
          .values({
            displayName: displayName(prepared.manifest.contact),
            companyName: prepared.manifest.contact.company,
            contactName: `${prepared.manifest.contact.firstName} ${prepared.manifest.contact.lastName}`.trim(),
            email: prepared.manifest.contact.email,
            phone: prepared.manifest.contact.phone,
          })
          .returning({ id: customers.id });
        customerId = created.id;
      }

      const year = prepared.now.getFullYear().toString().slice(-2);
      const month = String(prepared.now.getMonth() + 1);
      const existing = await tx
        .select({ quoteNumber: quotes.quoteNumber })
        .from(quotes)
        .where(sql`${quotes.quoteNumber} like ${`Q${year}${month}-%`}`);
      const quoteNumber = nextQuoteNumber(
        existing.map((row) => row.quoteNumber),
        prepared.now,
      );
      const [quote] = await tx
        .insert(quotes)
        .values({
          quoteNumber,
          customerId,
          status: "RFQ",
          subtotal: "0.00",
          total: "0.00",
          ndaRequired: prepared.manifest.ndaRequired,
          sourceReceiptNumber: prepared.receipt.receiptNumber,
          createdAt: prepared.now,
          updatedAt: prepared.now,
        })
        .returning({ id: quotes.id });

      for (const [index, part] of prepared.parts.entries()) {
        await tx.insert(quoteParts).values({
          id: part.quotePartId,
          quoteId: quote.id,
          partNumber: `${quoteNumber}-P${String(index + 1).padStart(2, "0")}`,
          partName: part.partName,
          description: part.note || null,
          material: part.material,
          tolerance: part.tolerance,
          partFileUrl: part.canonicalCadKey,
          specifications: part.raw,
          conversionStatus: "pending",
          createdAt: prepared.now,
          updatedAt: prepared.now,
        });
        await tx.insert(quoteLineItems).values({
          quoteId: quote.id,
          quotePartId: part.quotePartId,
          name: part.partName,
          quantity: part.quantity,
          unitPrice: "0.00",
          totalPrice: "0.00",
          description: part.note || null,
          sortOrder: index,
          createdAt: prepared.now,
          updatedAt: prepared.now,
        });

        for (const drawing of part.canonicalDrawings) {
          const [attachment] = await tx
            .insert(attachments)
            .values({
              s3Bucket: process.env.S3_BUCKET || "subtract-attachments",
              s3Key: drawing.key,
              fileName: drawing.fileName,
              contentType: drawing.contentType,
              fileSize: drawing.size,
              source: "system",
            })
            .returning({ id: attachments.id });
          await tx.insert(quotePartDrawings).values({
            quotePartId: part.quotePartId,
            attachmentId: attachment.id,
          });
        }
      }

      const [archiveAttachment] = await tx
        .insert(attachments)
        .values({
          s3Bucket: process.env.S3_BUCKET || "subtract-attachments",
          s3Key: prepared.archive.key,
          fileName: prepared.archive.fileName,
          contentType: prepared.archive.contentType,
          fileSize: prepared.archive.size,
          source: "system",
          documentKind: "rfq_intake_archive",
          isProtected: true,
        })
        .returning({ id: attachments.id });
      await tx.insert(quoteAttachments).values({
        quoteId: quote.id,
        attachmentId: archiveAttachment.id,
      });

      await tx.insert(notes).values({
        entityType: "quote",
        entityId: String(quote.id),
        content: prepared.quoteNote,
        createdBy: "system",
        createdAt: prepared.now,
        updatedAt: prepared.now,
      });
      await tx.insert(eventLogs).values({
        entityType: "quote",
        entityId: String(quote.id),
        eventType: "rfq_intake_imported",
        eventCategory: "system",
        title: "RFQ intake imported",
        description: `Created ${quoteNumber} from WordPress RFQ intake`,
        metadata: { source: "wordpress_rfq", receiptNumber: prepared.receipt.receiptNumber },
        userEmail: "System",
        createdAt: prepared.now,
      });

      if (matchingCustomers.length > 1) {
        await tx.insert(actionItems).values({
          type: "customer_match_review",
          title: `Review Customer match for ${quoteNumber}`,
          description: `${matchingCustomers.length} active Customers share ${prepared.manifest.contact.email}; a new Customer was created.`,
          entityType: "quote",
          entityId: String(quote.id),
          metadata: {
            email: prepared.manifest.contact.email,
            candidateCustomerIds: matchingCustomers.map((customer) => customer.id),
            createdCustomerId: customerId,
          },
          createdAt: prepared.now,
          updatedAt: prepared.now,
        });
      }

      await tx
        .update(rfqImportLedger)
        .set({
          quoteId: quote.id,
          // The quote is durable, but source cleanup still needs to happen. Keeping this
          // explicit makes a crash after commit recover as cleanup-only work.
          status: "cleanup_pending",
          nextAttemptAt: null,
          errorClassification: null,
          errorDetail: null,
          updatedAt: prepared.now,
        })
        .where(eq(rfqImportLedger.id, ledger.id));

      return { quoteId: quote.id, quotePartIds: prepared.parts.map((part) => part.quotePartId) };
    });
  },

  async recordFailure(input) {
    await db.transaction(async (tx) => {
      await tx
        .insert(rfqImportLedger)
        .values({
          receiptNumber: input.receipt.receiptNumber,
          sessionId: input.receipt.sessionId,
          receiptKey: input.receipt.receiptKey,
          status: input.nextAttemptAt ? "retry_scheduled" : "permanent_failure",
          attemptCount: input.attemptCount,
          firstFailureAt: input.now,
          lastFailureAt: input.now,
          nextAttemptAt: input.nextAttemptAt,
          errorClassification: input.classification,
          errorDetail: input.safeDetail,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: rfqImportLedger.receiptNumber,
          set: {
            status: input.nextAttemptAt ? "retry_scheduled" : "permanent_failure",
            attemptCount: input.attemptCount,
            firstFailureAt: sql`coalesce(${rfqImportLedger.firstFailureAt}, ${input.now})`,
            lastFailureAt: input.now,
            nextAttemptAt: input.nextAttemptAt,
            errorClassification: input.classification,
            errorDetail: input.safeDetail,
            updatedAt: input.now,
          },
        });
      await tx.insert(eventLogs).values({
        entityType: "rfq_import",
        entityId: input.receipt.receiptNumber,
        eventType: input.nextAttemptAt ? "rfq_import_retry_scheduled" : "rfq_import_failed",
        eventCategory: "system",
        title: input.nextAttemptAt ? "RFQ import retry scheduled" : "RFQ import failed",
        description: input.safeDetail,
        metadata: {
          classification: input.classification,
          attemptCount: input.attemptCount,
          nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
        },
        userEmail: "System",
        createdAt: input.now,
      });
    });
    await upsertFailureActionItem({
      receiptNumber: input.receipt.receiptNumber,
      description: input.safeDetail,
      classification: input.classification,
      nextAttemptAt: input.nextAttemptAt,
      now: input.now,
    });
  },

  async markCleanupPending(receipt, quoteId, safeDetail, now) {
    await db.transaction(async (tx) => {
      await tx
        .update(rfqImportLedger)
        .set({
          quoteId,
          status: "cleanup_pending",
          errorClassification: "cleanup",
          errorDetail: safeDetail,
          updatedAt: now,
        })
        .where(eq(rfqImportLedger.receiptNumber, receipt.receiptNumber));
      await tx.insert(eventLogs).values({
        entityType: "rfq_import",
        entityId: receipt.receiptNumber,
        eventType: "rfq_intake_cleanup_pending",
        eventCategory: "system",
        title: "RFQ intake cleanup pending",
        description: safeDetail,
        metadata: { quoteId },
        userEmail: "System",
        createdAt: now,
      });
    });
  },

  async markCompleted(receipt, quoteId, now) {
    await db.transaction(async (tx) => {
      await tx
        .update(rfqImportLedger)
        .set({
          quoteId,
          status: "completed",
          nextAttemptAt: null,
          errorClassification: null,
          errorDetail: null,
          updatedAt: now,
        })
        .where(eq(rfqImportLedger.receiptNumber, receipt.receiptNumber));
      await tx.insert(eventLogs).values({
        entityType: "rfq_import",
        entityId: receipt.receiptNumber,
        eventType: "rfq_intake_cleanup_completed",
        eventCategory: "system",
        title: "RFQ intake cleanup completed",
        description: "Source intake objects were deleted",
        metadata: { quoteId },
        userEmail: "System",
        createdAt: now,
      });
    });
    await resolveFailureActionItem(receipt.receiptNumber, now);
  },
};

export async function retryRfqImportNow(receiptNumber: string, now = new Date()) {
  const [updated] = await db
    .update(rfqImportLedger)
    .set({
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      errorClassification: null,
      errorDetail: null,
      updatedAt: now,
    })
    .where(eq(rfqImportLedger.receiptNumber, receiptNumber))
    .returning({ receiptKey: rfqImportLedger.receiptKey });
  return updated?.receiptKey ?? null;
}
