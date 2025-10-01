import { json, type LoaderFunctionArgs, type ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import {
  getPartConversionStatusWithLive,
  triggerPartConversion
} from "~/lib/mesh-converter.server";
import {
  isConversionEnabled
} from "~/lib/conversion-service.server";

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
    const conversionData = await getPartConversionStatusWithLive(partId);

    if (!conversionData) {
      return json({ error: "Part not found" }, { status: 404 });
    }

    return json({
      ...conversionData,
      serviceAvailable: true,
    });
  } catch (error) {
    console.error("Error fetching conversion status:", error);
    return json({
      error: "Failed to fetch conversion status"
    }, { status: 500 });
  }
}

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

  if (action !== "convert" && action !== "retry") {
    return json({
      error: "Invalid action. Use 'convert' or 'retry'"
    }, { status: 400 });
  }

  try {
    const result = await triggerPartConversion(partId, action);

    if (result.success) {
      return json({
        success: true,
        message: "message" in result ? result.message : "Mesh conversion started successfully",
        meshUrl: "meshUrl" in result ? result.meshUrl : undefined,
        jobId: "jobId" in result ? result.jobId : undefined,
      });
    } else {
      return json({
        success: false,
        error: "error" in result ? result.error : "Conversion failed",
        jobId: "jobId" in result ? result.jobId : undefined,
      }, { status: 400 });
    }

  } catch (error) {
    console.error("Error during mesh conversion:", error);
    return json({
      error: error instanceof Error ? error.message : "Failed to process conversion request"
    }, { status: 500 });
  }
}