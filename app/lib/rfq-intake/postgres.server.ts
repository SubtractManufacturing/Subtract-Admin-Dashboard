import { and, eq, inArray, lte, or, sql } from "drizzle-orm";

import { db } from "../db";
import { nextQuoteNumberFromExisting } from "../number-generator";
import { SYSTEM_ACTOR_EMAIL, SYSTEM_ACTOR_ID } from "../system-actor";
import { intakePrefix } from "./keys";
import { IntakeValidationError } from "./package";
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
  users,
} from "../db/schema";
import type {
  ImportLedgerSummary,
  PreparedImport,
  RfqPersistence,
} from "./types";
import { RFQ_PROCESSING_LEASE_MS } from "./types";

function displayName(contact: PreparedImport["manifest"]["contact"]): string {
  const name = `${contact.firstName} ${contact.lastName}`.trim();
  return contact.company ? `${contact.company} - ${name}` : name;
}

function rfqImportEntityId(receiptKey: string): string {
  return receiptKey;
}

function rfqImportFailureTitle(receiptNumber: string | null, receiptKey: string): string {
  return receiptNumber
    ? `RFQ import failed: ${receiptNumber}`
    : `RFQ import failed: ${receiptKey}`;
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
      processingStartedAt: rfqImportLedger.processingStartedAt,
    })
    .from(rfqImportLedger)
    .where(inArray(rfqImportLedger.receiptKey, receiptKeys));
  return new Map(
    rows.map((row) => [
      row.receiptKey,
      {
        status: row.status,
        nextAttemptAt: row.nextAttemptAt,
        processingStartedAt: row.processingStartedAt,
      },
    ]),
  );
}

export async function getDueRfqLedgerReceiptKeys(now: Date): Promise<string[]> {
  const leaseExpiredAt = new Date(now.getTime() - RFQ_PROCESSING_LEASE_MS);
  const rows = await db
    .select({ receiptKey: rfqImportLedger.receiptKey })
    .from(rfqImportLedger)
    .where(
      or(
        eq(rfqImportLedger.status, "pending"),
        eq(rfqImportLedger.status, "cleanup_pending"),
        and(
          eq(rfqImportLedger.status, "retry_scheduled"),
          lte(rfqImportLedger.nextAttemptAt, now),
        ),
        and(
          eq(rfqImportLedger.status, "processing"),
          or(
            sql`${rfqImportLedger.processingStartedAt} is null`,
            lte(rfqImportLedger.processingStartedAt, leaseExpiredAt),
          ),
        ),
      ),
    );
  return rows.map((row) => row.receiptKey);
}

export function createPostgresRfqPersistence(input: {
  attachmentBucket: string;
}): RfqPersistence {
  return {
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
            manifestKey: `${intakePrefix(ledger.sessionId)}meta/manifest.json`,
            submittedAt: "",
          },
          status: ledger.status,
          quoteId: ledger.quoteId,
          attemptCount: ledger.attemptCount,
          nextAttemptAt: ledger.nextAttemptAt,
        }
      : null;
  },

  async claimImport(receipt, now) {
    return db.transaction(async (tx) => {
      let [ledger] = await tx
        .select()
        .from(rfqImportLedger)
        .where(eq(rfqImportLedger.receiptKey, receipt.receiptKey))
        .for("update")
        .limit(1);
      if (!ledger) {
        await tx
          .insert(rfqImportLedger)
          .values({
            receiptNumber: receipt.receiptNumber,
            sessionId: receipt.sessionId,
            receiptKey: receipt.receiptKey,
            status: "pending",
          })
          .onConflictDoNothing({ target: rfqImportLedger.receiptKey });
        [ledger] = await tx
          .select()
          .from(rfqImportLedger)
          .where(eq(rfqImportLedger.receiptKey, receipt.receiptKey))
          .for("update")
          .limit(1);
      } else if (!ledger.receiptNumber && receipt.receiptNumber) {
        const [receiptNumberOwner] = await tx
          .select({ id: rfqImportLedger.id })
          .from(rfqImportLedger)
          .where(eq(rfqImportLedger.receiptNumber, receipt.receiptNumber))
          .limit(1);
        if (receiptNumberOwner && receiptNumberOwner.id !== ledger.id) {
          throw new IntakeValidationError(
            "Receipt number was reused by a different intake package",
            "security",
          );
        }
        [ledger] = await tx
          .update(rfqImportLedger)
          .set({
            receiptNumber: receipt.receiptNumber,
            sessionId: receipt.sessionId,
            updatedAt: now,
          })
          .where(eq(rfqImportLedger.id, ledger.id))
          .returning();
      }
      if (!ledger) throw new Error("RFQ import ledger claim failed");
      if (ledger.receiptKey !== receipt.receiptKey || ledger.sessionId !== receipt.sessionId) {
        throw new IntakeValidationError(
          "Receipt number was reused by a different intake package",
          "security",
        );
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
      const leaseExpiredAt = new Date(
        now.getTime() - RFQ_PROCESSING_LEASE_MS,
      );
      const [timing] = await tx
        .select({
          processingLeaseActive: sql<boolean>`coalesce(${rfqImportLedger.processingStartedAt} > ${leaseExpiredAt}, false)`,
          retryNotDue: sql<boolean>`coalesce(${rfqImportLedger.nextAttemptAt} > ${now}, false)`,
        })
        .from(rfqImportLedger)
        .where(eq(rfqImportLedger.id, ledger.id))
        .limit(1);
      if (
        ledger.status === "processing" &&
        timing?.processingLeaseActive
      ) {
        return { kind: "already_processing" as const };
      }
      if (ledger.status === "permanent_failure") {
        return { kind: "already_processing" as const };
      }
      if (
        ledger.status === "retry_scheduled" &&
        timing?.retryNotDue
      ) {
        return { kind: "already_processing" as const };
      }

      const attemptCount = ledger.attemptCount + 1;
      await tx
        .update(rfqImportLedger)
        .set({
          status: "processing",
          attemptCount,
          processingStartedAt: now,
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
        .where(eq(rfqImportLedger.receiptKey, prepared.receipt.receiptKey))
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
      const quoteNumber = nextQuoteNumberFromExisting(
        existing.map((row) => row.quoteNumber),
        prepared.now,
      );
      // drizzle-kit push applies schema changes but not the data seed in the RFQ
      // migration. Ensure the non-login system actor exists before using it as
      // the quote's FK; the primary-key conflict makes this concurrency-safe.
      await tx
        .insert(users)
        .values({
          id: SYSTEM_ACTOR_ID,
          name: "System",
          email: SYSTEM_ACTOR_EMAIL,
          role: "User",
          status: "disabled",
          isArchived: true,
        })
        .onConflictDoNothing({ target: users.id });
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
          createdById: SYSTEM_ACTOR_ID,
          createdAt: prepared.now,
          updatedAt: prepared.now,
        })
        .returning({ id: quotes.id });

      const drawingAttachmentIds: string[] = [];
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
              s3Bucket: input.attachmentBucket,
              s3Key: drawing.key,
              fileName: drawing.fileName,
              contentType: drawing.contentType,
              fileSize: drawing.size,
              source: "system",
            })
            .returning({ id: attachments.id });
          drawingAttachmentIds.push(attachment.id);
          await tx.insert(quotePartDrawings).values({
            quotePartId: part.quotePartId,
            attachmentId: attachment.id,
          });
        }
      }

      const [archiveAttachment] = await tx
        .insert(attachments)
        .values({
          s3Bucket: input.attachmentBucket,
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
          processingStartedAt: null,
          nextAttemptAt: null,
          errorClassification: null,
          errorDetail: null,
          updatedAt: prepared.now,
        })
        .where(eq(rfqImportLedger.id, ledger.id));

      return {
        quoteId: quote.id,
        quotePartIds: prepared.parts.map((part) => part.quotePartId),
        drawingAttachmentIds,
      };
    });
  },

  async recordFailure(input) {
    await db.transaction(async (tx) => {
      let [ledger] = await tx
        .select()
        .from(rfqImportLedger)
        .where(eq(rfqImportLedger.receiptKey, input.receipt.receiptKey))
        .for("update")
        .limit(1);
      if (!ledger) {
        if (input.receipt.receiptNumber) {
          const [receiptNumberOwner] = await tx
            .select({ receiptKey: rfqImportLedger.receiptKey })
            .from(rfqImportLedger)
            .where(eq(rfqImportLedger.receiptNumber, input.receipt.receiptNumber))
            .limit(1);
          if (
            receiptNumberOwner &&
            receiptNumberOwner.receiptKey !== input.receipt.receiptKey
          ) {
            throw new IntakeValidationError(
              "Receipt number was reused by a different intake package",
              "security",
            );
          }
        }
        await tx
          .insert(rfqImportLedger)
          .values({
            receiptNumber: input.receipt.receiptNumber,
            sessionId: input.receipt.sessionId,
            receiptKey: input.receipt.receiptKey,
            status: "pending",
          })
          .onConflictDoNothing({ target: rfqImportLedger.receiptKey });
        [ledger] = await tx
          .select()
          .from(rfqImportLedger)
          .where(eq(rfqImportLedger.receiptKey, input.receipt.receiptKey))
          .for("update")
          .limit(1);
      }
      if (!ledger) throw new Error("RFQ import failure ledger could not be recorded");
      const importEntityId = rfqImportEntityId(input.receipt.receiptKey);
      const knownReceiptNumber = ledger.receiptNumber ?? input.receipt.receiptNumber;
      if (
        input.receipt.receiptNumber &&
        ledger.receiptNumber &&
        ledger.receiptNumber !== input.receipt.receiptNumber
      ) {
        throw new IntakeValidationError(
          "Receipt identity changed after an earlier failure",
          "security",
        );
      }
      await tx
        .update(rfqImportLedger)
        .set({
          status: input.nextAttemptAt ? "retry_scheduled" : "permanent_failure",
          attemptCount: input.attemptCount,
          processingStartedAt: null,
          receiptNumber: knownReceiptNumber,
          firstFailureAt: ledger.firstFailureAt ?? input.now,
          lastFailureAt: input.now,
          nextAttemptAt: input.nextAttemptAt,
          errorClassification: input.classification,
          errorDetail: input.safeDetail,
          updatedAt: input.now,
        })
        .where(eq(rfqImportLedger.id, ledger.id));
      await tx.insert(eventLogs).values({
        entityType: "rfq_import",
        entityId: importEntityId,
        eventType: input.nextAttemptAt ? "rfq_import_retry_scheduled" : "rfq_import_failed",
        eventCategory: "system",
        title: input.nextAttemptAt ? "RFQ import retry scheduled" : "RFQ import failed",
        description: input.safeDetail,
        metadata: {
          receiptKey: input.receipt.receiptKey,
          receiptNumber: knownReceiptNumber,
          classification: input.classification,
          attemptCount: input.attemptCount,
          nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
        },
        userEmail: "System",
        createdAt: input.now,
      });
      const actionValues = {
        status: "active" as const,
        title: rfqImportFailureTitle(knownReceiptNumber, input.receipt.receiptKey),
        description: input.safeDetail,
        metadata: {
          receiptKey: input.receipt.receiptKey,
          receiptNumber: knownReceiptNumber,
          classification: input.classification,
          nextAttemptAt: input.nextAttemptAt?.toISOString() ?? null,
        },
        resolvedAt: null,
        resolvedBy: null,
        resolution: null,
        updatedAt: input.now,
      };
      await tx
        .insert(actionItems)
        .values({
          type: "rfq_import_failure",
          entityType: "rfq_import",
          entityId: importEntityId,
          ...actionValues,
        })
        .onConflictDoUpdate({
          target: [actionItems.type, actionItems.entityType, actionItems.entityId],
          targetWhere: sql`type = 'rfq_import_failure' and is_archived = false`,
          set: actionValues,
        });
    });
  },

  async markCleanupPending(receipt, quoteId, safeDetail, now) {
    await db.transaction(async (tx) => {
      await tx
        .update(rfqImportLedger)
        .set({
          quoteId,
          status: "cleanup_pending",
          processingStartedAt: null,
          errorClassification: "cleanup",
          errorDetail: safeDetail,
          updatedAt: now,
        })
        .where(eq(rfqImportLedger.receiptKey, receipt.receiptKey));
      await tx.insert(eventLogs).values({
        entityType: "rfq_import",
        entityId: rfqImportEntityId(receipt.receiptKey),
        eventType: "rfq_intake_cleanup_pending",
        eventCategory: "system",
        title: "RFQ intake cleanup pending",
        description: safeDetail,
        metadata: { quoteId, receiptNumber: receipt.receiptNumber },
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
          processingStartedAt: null,
          nextAttemptAt: null,
          errorClassification: null,
          errorDetail: null,
          updatedAt: now,
        })
        .where(eq(rfqImportLedger.receiptKey, receipt.receiptKey));
      await tx.insert(eventLogs).values({
        entityType: "rfq_import",
        entityId: rfqImportEntityId(receipt.receiptKey),
        eventType: "rfq_intake_cleanup_completed",
        eventCategory: "system",
        title: "RFQ intake cleanup completed",
        description: "Source intake objects were deleted",
        metadata: { quoteId, receiptNumber: receipt.receiptNumber },
        userEmail: "System",
        createdAt: now,
      });
      await tx
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
            eq(actionItems.entityId, rfqImportEntityId(receipt.receiptKey)),
            eq(actionItems.status, "active"),
            eq(actionItems.isArchived, false),
          ),
        );
    });
  },
  };
}

export async function resetRfqImportForRetry(receiptNumber: string, now = new Date()) {
  const [updated] = await db
    .update(rfqImportLedger)
    .set({
      status: "pending",
      attemptCount: 0,
      processingStartedAt: null,
      nextAttemptAt: now,
      errorClassification: null,
      errorDetail: null,
      updatedAt: now,
    })
    .where(eq(rfqImportLedger.receiptNumber, receiptNumber))
    .returning({ receiptKey: rfqImportLedger.receiptKey });
  return updated?.receiptKey ?? null;
}

export async function resetRfqImportForRetryByReceiptKey(
  receiptKey: string,
  now = new Date(),
) {
  const [updated] = await db
    .update(rfqImportLedger)
    .set({
      status: "pending",
      attemptCount: 0,
      processingStartedAt: null,
      nextAttemptAt: now,
      errorClassification: null,
      errorDetail: null,
      updatedAt: now,
    })
    .where(eq(rfqImportLedger.receiptKey, receiptKey))
    .returning({ receiptKey: rfqImportLedger.receiptKey });
  return updated?.receiptKey ?? null;
}
