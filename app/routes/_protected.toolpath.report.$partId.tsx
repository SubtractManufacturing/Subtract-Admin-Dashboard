import { json, redirect, type LoaderFunctionArgs } from "@remix-run/node";
import { eq } from "drizzle-orm";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { db } from "~/lib/db";
import { quoteParts } from "~/lib/db/schema";
import { canUserAccessToolpath } from "~/lib/featureFlags";
import { isAllowedToolpathReportUrl } from "~/lib/toolpath";
import {
  isToolpathEnabled,
  isValidToolpathPartId,
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

  if (!isValidToolpathPartId(partId)) {
    return withAuthHeaders(
      json({ error: "Invalid Toolpath part ID" }, { status: 400 }),
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

  const [linkedQuotePart] = await db
    .select({ toolpathReportUrl: quoteParts.toolpathReportUrl })
    .from(quoteParts)
    .where(eq(quoteParts.toolpathPartId, partId))
    .limit(1);

  if (!linkedQuotePart) {
    return withAuthHeaders(
      json({ error: "Toolpath report not found for this quote part" }, { status: 404 }),
      headers,
    );
  }

  try {
    let reportUrl = linkedQuotePart.toolpathReportUrl;
    if (!reportUrl || !isAllowedToolpathReportUrl(reportUrl)) {
      reportUrl = await resolveToolpathReportUrl({ partId });
    }

    if (!reportUrl) {
      return withAuthHeaders(
        json(
          { error: "Toolpath report is not ready yet. Try again in a moment." },
          { status: 404 },
        ),
        headers,
      );
    }

    if (!isAllowedToolpathReportUrl(reportUrl)) {
      return withAuthHeaders(
        json({ error: "Invalid Toolpath report URL" }, { status: 502 }),
        headers,
      );
    }

    return withAuthHeaders(redirect(reportUrl), headers);
  } catch (error) {
    console.error("Failed to resolve Toolpath report URL:", error);
    return withAuthHeaders(
      json({ error: "Failed to open Toolpath report" }, { status: 500 }),
      headers,
    );
  }
}
