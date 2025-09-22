import { json, type ActionFunction } from "@remix-run/node";
import { dismissEvent } from "~/lib/events";
import { requireAuth } from "~/lib/auth.server";

export const action: ActionFunction = async ({ request }) => {
  const session = await requireAuth(request);
  const userEmail = session.userDetails.email;

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const formData = await request.formData();
  const eventId = formData.get("eventId")?.toString();

  if (!eventId) {
    return json({ error: "Missing event ID" }, { status: 400 });
  }

  try {
    const result = await dismissEvent(eventId, userEmail);

    if (!result) {
      return json({ error: "Event not found" }, { status: 404 });
    }

    return json({ success: true });
  } catch (error) {
    console.error("Error dismissing event:", error);
    return json({ error: "Failed to dismiss event" }, { status: 500 });
  }
};