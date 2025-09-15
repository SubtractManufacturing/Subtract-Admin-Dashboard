import { json, type ActionFunctionArgs } from "@remix-run/node";
import { 
  batchConvertParts,
  findPartsNeedingConversion,
  getConversionStats,
  type MeshConversionResult 
} from "~/lib/mesh-converter.server";
import { isConversionEnabled } from "~/lib/conversion-service.server";
import { requireAuth } from "~/lib/auth.server";

interface PartRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * POST /api/mesh-conversion/batch
 * Batch process mesh conversions
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAuth(request);

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
    switch (action) {
      case "convert-selected": {
        // Convert specific parts
        const partIdsJson = formData.get("partIds");
        if (!partIdsJson || typeof partIdsJson !== "string") {
          return json({ 
            error: "Part IDs are required for selected conversion" 
          }, { status: 400 });
        }

        let partIds: string[];
        try {
          partIds = JSON.parse(partIdsJson);
        } catch {
          return json({ 
            error: "Invalid part IDs format" 
          }, { status: 400 });
        }

        if (!Array.isArray(partIds) || partIds.length === 0) {
          return json({ 
            error: "Part IDs must be a non-empty array" 
          }, { status: 400 });
        }

        const results = await batchConvertParts(partIds);
        
        // Convert Map to object for JSON serialization
        const resultsObj: Record<string, MeshConversionResult> = {};
        for (const [partId, result] of results) {
          resultsObj[partId] = result;
        }

        return json({
          success: true,
          message: `Started conversion for ${partIds.length} parts`,
          results: resultsObj,
          stats: await getConversionStats(),
        });
      }

      case "convert-pending": {
        // Find and convert parts that need conversion
        const pendingParts = await findPartsNeedingConversion();
        
        if (pendingParts.length === 0) {
          return json({
            success: true,
            message: "No parts pending conversion",
            stats: await getConversionStats(),
          });
        }

        const partIds = pendingParts.map((p: PartRecord) => p.id);
        const results = await batchConvertParts(partIds);

        // Convert Map to object for JSON serialization
        const resultsObj: Record<string, MeshConversionResult> = {};
        for (const [partId, result] of results) {
          resultsObj[partId] = result;
        }

        return json({
          success: true,
          message: `Started conversion for ${partIds.length} pending parts`,
          results: resultsObj,
          stats: await getConversionStats(),
        });
      }

      case "get-stats": {
        // Just return conversion statistics
        const stats = await getConversionStats();
        return json({
          success: true,
          stats,
        });
      }

      default:
        return json({ 
          error: "Invalid action. Use 'convert-selected', 'convert-pending', or 'get-stats'" 
        }, { status: 400 });
    }

  } catch (error) {
    console.error("Error during batch conversion:", error);
    return json({ 
      error: error instanceof Error ? error.message : "Failed to process batch conversion" 
    }, { status: 500 });
  }
}