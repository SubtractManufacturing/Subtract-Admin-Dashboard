import { type ActionFunction } from "@remix-run/node";
import { restoreEvent } from "~/lib/events";
import { requireAuth } from "~/lib/auth.server";

export const action: ActionFunction = async ({ request }) => {
  await requireAuth(request);

  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const eventId = formData.get("eventId")?.toString();

  if (!eventId) {
    return Response.json({ error: "Missing event ID" }, { status: 400 });
  }

  try {
    const result = await restoreEvent(eventId);

    if (!result) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    return Response.json({ success: true });
  } catch (error) {
    console.error("Error restoring event:", error);
    return Response.json({ error: "Failed to restore event" }, { status: 500 });
  }
};