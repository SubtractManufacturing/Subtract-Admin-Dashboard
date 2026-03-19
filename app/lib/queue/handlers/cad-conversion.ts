import type { Job } from "pg-boss";
import type { CadConversionPayload } from "../types";
import { db } from "../../db/index.js";
import { parts, quoteParts } from "../../db/schema";
import { eq } from "drizzle-orm";
import { convertPartToMesh } from "../../part-mesh-converter.server";
import { convertQuotePartToMesh } from "../../quote-part-mesh-converter.server";
import { createEvent } from "../../events";

export async function handleCadConversion(jobs: Job<CadConversionPayload>[]) {
  for (const job of jobs) {
    const { entityType, entityId } = job.data;
    const start = Date.now();

    console.log(
      `[Worker:CadConversion] Processing ${entityType} ${entityId} (job ${job.id})`,
    );

    try {
      const fileUrl = await getEntityFileUrl(entityType, entityId);

      if (!fileUrl) {
        throw new Error(`No CAD file found for ${entityType} ${entityId}`);
      }

      const result =
        entityType === "part"
          ? await convertPartToMesh(entityId, fileUrl)
          : await convertQuotePartToMesh(entityId, fileUrl);

      if (!result.success) {
        throw new Error(result.error || "Conversion returned unsuccessful");
      }

      await createEvent({
        entityType,
        entityId,
        eventType: "mesh_conversion_completed",
        eventCategory: "system",
        title: "Mesh conversion completed",
        description: `Converted CAD to mesh in ${Date.now() - start}ms`,
        metadata: {
          jobId: job.id,
          kernelJobId: result.jobId,
          meshUrl: result.meshUrl,
          durationMs: Date.now() - start,
        },
      });

      console.log(
        `[Worker:CadConversion] ${entityType} ${entityId} completed in ${Date.now() - start}ms`,
      );
    } catch (error) {
      console.error(
        `[Worker:CadConversion] ${entityType} ${entityId} failed:`,
        error,
      );
      throw error;
    }
  }
}

async function getEntityFileUrl(
  entityType: "part" | "quote_part",
  entityId: string,
): Promise<string | null> {
  if (entityType === "part") {
    const [part] = await db
      .select({ partFileUrl: parts.partFileUrl })
      .from(parts)
      .where(eq(parts.id, entityId))
      .limit(1);
    return part?.partFileUrl ?? null;
  }

  const [quotePart] = await db
    .select({ partFileUrl: quoteParts.partFileUrl })
    .from(quoteParts)
    .where(eq(quoteParts.id, entityId))
    .limit(1);
  return quotePart?.partFileUrl ?? null;
}
