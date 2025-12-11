import { json, ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { canUserUploadCadRevision } from "~/lib/featureFlags";
import { restoreVersion, getCadVersionById, getCurrentCadVersion } from "~/lib/cadVersions";
import { handleVersionRestore } from "~/lib/quote-part-mesh-converter.server";
import { createEvent } from "~/lib/events";
import { db } from "~/lib/db";
import { quoteParts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const { quotePartId } = params;

  if (!quotePartId) {
    return json({ error: "Quote Part ID is required" }, { status: 400 });
  }

  // Feature flag check - use same permission as revision upload
  const canRevise = await canUserUploadCadRevision(userDetails?.role);
  if (!canRevise) {
    return json({ error: "CAD revisions are not enabled for your account" }, { status: 403 });
  }

  // Verify quote part exists and get quote ID for event logging
  const [quotePart] = await db
    .select({
      id: quoteParts.id,
      partName: quoteParts.partName,
      quoteId: quoteParts.quoteId,
    })
    .from(quoteParts)
    .where(eq(quoteParts.id, quotePartId))
    .limit(1);

  if (!quotePart) {
    return json({ error: "Quote part not found" }, { status: 404 });
  }

  try {
    // Parse request body
    const formData = await request.formData();
    const versionId = formData.get("versionId") as string | null;

    if (!versionId) {
      return json({ error: "Version ID is required" }, { status: 400 });
    }

    // Get the version to restore
    const versionToRestore = await getCadVersionById(versionId);
    if (!versionToRestore) {
      return json({ error: "Version not found" }, { status: 404 });
    }

    // Verify version belongs to this quote part
    if (versionToRestore.entityType !== "quote_part" || versionToRestore.entityId !== quotePartId) {
      return json({ error: "Version does not belong to this quote part" }, { status: 403 });
    }

    // Check if already current
    if (versionToRestore.isCurrentVersion) {
      return json({ error: "This version is already the current version" }, { status: 400 });
    }

    // Get current version for logging
    const currentVersion = await getCurrentCadVersion("quote_part", quotePartId);
    const fromVersion = currentVersion?.version || 0;

    // Restore the version (sets isCurrentVersion flag)
    await restoreVersion(versionId);

    // Handle version restore workflow (delete mesh, update CAD URL, trigger conversion)
    await handleVersionRestore(
      quotePartId,
      versionToRestore.s3Key,
      user.id,
      user.email || userDetails?.name || "unknown"
    );

    // Log event on quote_part
    await createEvent({
      entityType: "quote_part",
      entityId: quotePartId,
      eventType: "cad_version_restored",
      eventCategory: "document",
      title: `Restored to v${versionToRestore.version}`,
      description: `Restored CAD file from v${fromVersion} to v${versionToRestore.version}`,
      metadata: {
        fromVersion,
        toVersion: versionToRestore.version,
        restoredVersionId: versionId,
        fileName: versionToRestore.fileName,
      },
      userId: user.id,
      userEmail: user.email || userDetails?.name || undefined,
    });

    // Also log event on parent quote for visibility in quote timeline
    if (quotePart.quoteId) {
      await createEvent({
        entityType: "quote",
        entityId: quotePart.quoteId.toString(),
        eventType: "cad_version_restored",
        eventCategory: "document",
        title: `CAD restored: ${quotePart.partName || "Part"}`,
        description: `Restored from v${fromVersion} to v${versionToRestore.version}`,
        metadata: {
          quotePartId,
          partName: quotePart.partName,
          fromVersion,
          toVersion: versionToRestore.version,
          fileName: versionToRestore.fileName,
        },
        userId: user.id,
        userEmail: user.email || userDetails?.name || undefined,
      });
    }

    return json({
      success: true,
      restoredVersion: versionToRestore.version,
    });
  } catch (error) {
    console.error("Error restoring CAD version:", error);
    return json({
      error: error instanceof Error ? error.message : "Failed to restore version",
    }, { status: 500 });
  }
}
