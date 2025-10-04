import { db } from "./db/index.js";
import { quoteParts, quotePartDrawings, attachments } from "./db/schema.js";
import { eq } from "drizzle-orm";

export async function getQuotePart(id: string) {
  try {
    const [result] = await db
      .select()
      .from(quoteParts)
      .where(eq(quoteParts.id, id))
      .limit(1);

    return result || null;
  } catch (error) {
    console.error('Error fetching quote part:', error);
    return null;
  }
}

export async function getQuotePartWithAttachments(quotePartId: string) {
  try {
    const quotePart = await getQuotePart(quotePartId);
    if (!quotePart) return null;

    // Get quote part drawings with attachments
    const drawingsData = await db
      .select({
        drawing: quotePartDrawings,
        attachment: attachments
      })
      .from(quotePartDrawings)
      .innerJoin(attachments, eq(quotePartDrawings.attachmentId, attachments.id))
      .where(eq(quotePartDrawings.quotePartId, quotePartId));

    return {
      ...quotePart,
      drawings: drawingsData.map(d => ({ ...d.drawing, attachment: d.attachment }))
    };
  } catch (error) {
    console.error('Error fetching quote part with attachments:', error);
    return null;
  }
}