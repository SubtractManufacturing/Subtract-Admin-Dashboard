import { json, ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { restoreVersion, getCadVersionById, getCurrentCadVersion } from "~/lib/cadVersions";
import { handlePartVersionRestore } from "~/lib/part-mesh-converter.server";
import { createEvent } from "~/lib/events";
import { db } from "~/lib/db";
import { parts } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const { partId } = params;

  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  // Verify part exists and get customer ID for event logging
  const [part] = await db
    .select({
      id: parts.id,
      partName: parts.partName,
      customerId: parts.customerId,
    })
    .from(parts)
    .where(eq(parts.id, partId))
    .limit(1);

  if (!part) {
    return json({ error: "Part not found" }, { status: 404 });
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

    // Verify version belongs to this part
    if (versionToRestore.entityType !== "part" || versionToRestore.entityId !== partId) {
      return json({ error: "Version does not belong to this part" }, { status: 403 });
    }

    // Check if already current
    if (versionToRestore.isCurrentVersion) {
      return json({ error: "This version is already the current version" }, { status: 400 });
    }

    // Get current version for logging
    const currentVersion = await getCurrentCadVersion("part", partId);
    const fromVersion = currentVersion?.version || 0;

    // Restore the version (sets isCurrentVersion flag)
    await restoreVersion(versionId);

    // Handle version restore workflow (delete mesh, update CAD URL, trigger conversion)
    await handlePartVersionRestore(
      partId,
      versionToRestore.s3Key,
      user.id,
      user.email || userDetails?.name || "unknown"
    );

    // Log event on part
    await createEvent({
      entityType: "part",
      entityId: partId,
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

    // Also log event on customer for visibility
    if (part.customerId) {
      await createEvent({
        entityType: "customer",
        entityId: part.customerId.toString(),
        eventType: "cad_version_restored",
        eventCategory: "document",
        title: `CAD restored: ${part.partName || "Part"}`,
        description: `Restored from v${fromVersion} to v${versionToRestore.version}`,
        metadata: {
          partId,
          partName: part.partName,
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
