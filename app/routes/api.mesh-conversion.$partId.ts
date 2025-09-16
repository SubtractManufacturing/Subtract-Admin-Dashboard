import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { db } from "~/lib/db/index.js";
import { parts } from "~/lib/db/schema";
import { 
  convertPartToMesh, 
  retryPartConversion,
  type MeshConversionResult 
} from "~/lib/mesh-converter.server";
import { 
  checkConversionStatus,
  isConversionEnabled 
} from "~/lib/conversion-service.server";
import { requireAuth } from "~/lib/auth.server";

/**
 * GET /api/mesh-conversion/:partId
 * Get the conversion status for a part
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
  await requireAuth(request);
  
  const partId = params.partId;
  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    return json({ 
      error: "Mesh conversion service is not configured",
      serviceAvailable: false 
    }, { status: 503 });
  }

  try {
    // Get part details
    const [part] = await db.select({
      id: parts.id,
      partName: parts.partName,
      partFileUrl: parts.partFileUrl,
      partMeshUrl: parts.partMeshUrl,
      meshConversionStatus: parts.meshConversionStatus,
      meshConversionError: parts.meshConversionError,
      meshConversionJobId: parts.meshConversionJobId,
      meshConversionStartedAt: parts.meshConversionStartedAt,
      meshConversionCompletedAt: parts.meshConversionCompletedAt,
    })
    .from(parts)
    .where(eq(parts.id, partId));

    if (!part) {
      return json({ error: "Part not found" }, { status: 404 });
    }

    // If there's an active job, check its current status
    let liveStatus = null;
    if (part.meshConversionJobId && part.meshConversionStatus === "in_progress") {
      liveStatus = await checkConversionStatus(part.meshConversionJobId);
    }

    return json({
      part: {
        id: part.id,
        name: part.partName,
        hasModelFile: !!part.partFileUrl,
        hasMeshFile: !!part.partMeshUrl,
        meshUrl: part.partMeshUrl,
      },
      conversion: {
        status: part.meshConversionStatus,
        error: part.meshConversionError,
        jobId: part.meshConversionJobId,
        startedAt: part.meshConversionStartedAt,
        completedAt: part.meshConversionCompletedAt,
        liveStatus: liveStatus,
      },
      serviceAvailable: true,
    });
  } catch (error) {
    console.error("Error fetching conversion status:", error);
    return json({ 
      error: "Failed to fetch conversion status" 
    }, { status: 500 });
  }
}

/**
 * POST /api/mesh-conversion/:partId
 * Trigger mesh conversion for a part
 */
export async function action({ params, request }: ActionFunctionArgs) {
  await requireAuth(request);
  
  const partId = params.partId;
  if (!partId) {
    return json({ error: "Part ID is required" }, { status: 400 });
  }

  // Check if conversion is enabled
  if (!isConversionEnabled()) {
    return json({ 
      error: "Mesh conversion service is not configured",
      serviceAvailable: false 
    }, { status: 503 });
  }

  const formData = await request.formData();
  const action = formData.get("action");

  try {
    let result: MeshConversionResult;

    switch (action) {
      case "convert": {
        // Get part details
        const [part] = await db.select()
          .from(parts)
          .where(eq(parts.id, partId));

        if (!part) {
          return json({ error: "Part not found" }, { status: 404 });
        }

        if (!part.partFileUrl) {
          return json({ 
            error: "Part has no model file to convert" 
          }, { status: 400 });
        }

        // Check if already converted
        if (part.partMeshUrl && part.meshConversionStatus === "completed") {
          return json({ 
            message: "Part already has a mesh file",
            meshUrl: part.partMeshUrl,
            status: "completed" 
          });
        }

        // Start conversion
        result = await convertPartToMesh(partId, part.partFileUrl);
        break;
      }

      case "retry":
        // Retry failed conversion
        result = await retryPartConversion(partId);
        break;

      default:
        return json({ 
          error: "Invalid action. Use 'convert' or 'retry'" 
        }, { status: 400 });
    }

    if (result.success) {
      return json({
        success: true,
        message: "Mesh conversion started successfully",
        meshUrl: result.meshUrl,
        jobId: result.jobId,
      });
    } else {
      return json({
        success: false,
        error: result.error || "Conversion failed",
        jobId: result.jobId,
      }, { status: 400 });
    }

  } catch (error) {
    console.error("Error during mesh conversion:", error);
    return json({ 
      error: error instanceof Error ? error.message : "Failed to process conversion request" 
    }, { status: 500 });
  }
}