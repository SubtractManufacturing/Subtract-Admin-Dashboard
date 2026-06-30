import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { canUserAccessToolpath } from "~/lib/featureFlags";
import {
  isToolpathEnabled,
  resolveToolpathReportUrl,
} from "~/lib/toolpath.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);
  const partId = params.partId;

  if (!partId) {
    return withAuthHeaders(
      json({ error: "Toolpath part ID is required" }, { status: 400 }),
      headers,
    );
  }

  if (!(await canUserAccessToolpath())) {
    return withAuthHeaders(
      json({ error: "Toolpath integration is not enabled" }, { status: 403 }),
      headers,
    );
  }

  if (!isToolpathEnabled()) {
    return withAuthHeaders(
      json({ error: "Toolpath API is not configured" }, { status: 503 }),
      headers,
    );
  }

  try {
    const reportUrl = await resolveToolpathReportUrl({ partId });
    if (!reportUrl) {
      return withAuthHeaders(
        json(
          { error: "Toolpath report is not ready yet. Try again in a moment." },
          { status: 404 },
        ),
        headers,
      );
    }

    return redirect(reportUrl);
  } catch (error) {
    console.error("Failed to resolve Toolpath report URL:", error);
    return withAuthHeaders(
      json({ error: "Failed to open Toolpath report" }, { status: 500 }),
      headers,
    );
  }
}
