import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { getConversionStats, handleBatchConversion } from "~/lib/mesh-converter.server";
import { isConversionEnabled } from "~/lib/conversion-service.server";

/**
 * GET - Returns conversion statistics
 */
export async function loader({ request }: LoaderFunctionArgs) {
  await requireAuth(request);

  if (!isConversionEnabled()) {
    return json({
      error: "Mesh conversion service is not configured",
      serviceAvailable: false
    }, { status: 503 });
  }

  try {
    const stats = await getConversionStats();
    return json({ stats, serviceAvailable: true });
  } catch (error) {
    console.error("Error fetching conversion stats:", error);
    return json({ error: "Failed to fetch conversion stats" }, { status: 500 });
  }
}

/**
 * POST - Handles batch conversion mutations (convert-selected, convert-pending)
 */
export async function action({ request }: ActionFunctionArgs) {
  await requireAuth(request);

  if (!isConversionEnabled()) {
    return json({
      error: "Mesh conversion service is not configured",
      serviceAvailable: false
    }, { status: 503 });
  }

  const formData = await request.formData();
  const action = formData.get("action");

  if (typeof action !== "string") {
    return json({
      error: "Action is required"
    }, { status: 400 });
  }

  // Only handle write operations
  if (action !== "convert-selected" && action !== "convert-pending") {
    return json({
      error: "Invalid action. Use 'convert-selected' or 'convert-pending'"
    }, { status: 400 });
  }

  try {
    let partIds: string[] | undefined;

    // Parse partIds if provided for selected conversion
    if (action === "convert-selected") {
      const partIdsJson = formData.get("partIds");
      if (partIdsJson && typeof partIdsJson === "string") {
        try {
          partIds = JSON.parse(partIdsJson);
          if (!Array.isArray(partIds)) {
            return json({
              error: "Part IDs must be an array"
            }, { status: 400 });
          }
        } catch {
          return json({
            error: "Invalid part IDs format"
          }, { status: 400 });
        }
      }
    }

    const result = await handleBatchConversion(action, partIds);

    if (result.success) {
      return json(result);
    } else {
      return json(result, { status: 400 });
    }

  } catch (error) {
    console.error("Error during batch conversion:", error);
    return json({
      error: error instanceof Error ? error.message : "Failed to process batch conversion"
    }, { status: 500 });
  }
}