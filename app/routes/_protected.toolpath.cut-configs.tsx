import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { canUserAccessToolpath } from "~/lib/featureFlags";
import {
  isToolpathEnabled,
  listCutConfigs,
} from "~/lib/toolpath.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);

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
    const cutConfigs = await listCutConfigs();
    return withAuthHeaders(json({ cutConfigs }), headers);
  } catch (error) {
    console.error("Failed to load Toolpath cut configs:", error);
    return withAuthHeaders(
      json({ error: "Failed to load Toolpath cut configs" }, { status: 500 }),
      headers,
    );
  }
}
