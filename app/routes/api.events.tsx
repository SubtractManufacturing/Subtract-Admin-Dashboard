import { json, LoaderFunctionArgs } from "@remix-run/node";
import { getEventsByEntity } from "~/lib/events";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { headers } = await requireAuth(request);

  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const limit = parseInt(url.searchParams.get("limit") || "10");

  if (!entityType || !entityId) {
    return withAuthHeaders(
      json({ error: "entityType and entityId are required" }, { status: 400 }),
      headers
    );
  }

  try {
    const events = await getEventsByEntity(entityType, entityId, limit);
    return withAuthHeaders(json({ events }), headers);
  } catch (error) {
    console.error("Error fetching events:", error);
    return withAuthHeaders(
      json({ error: "Failed to fetch events" }, { status: 500 }),
      headers
    );
  }
}