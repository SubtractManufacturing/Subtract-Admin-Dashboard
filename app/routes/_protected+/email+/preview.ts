import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import {
  isEmailContextKey,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import { buildEmailContent } from "~/lib/email/build-email-content.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!(await isOutboundEmailEnabled())) {
    return json({ error: "Outbound email is disabled." }, { status: 403 });
  }

  const { user, userDetails } = await requireAuth(request);
  const formData = await request.formData();

  const contextKeyRaw = (formData.get("contextKey") as string)?.trim() ?? "";
  if (!contextKeyRaw || !isEmailContextKey(contextKeyRaw)) {
    return json({ error: "Invalid or missing contextKey" }, { status: 400 });
  }
  const contextKey = contextKeyRaw as EmailContextKey;

  const entityId = (formData.get("entityId") as string)?.trim() ?? "";
  if (!entityId) {
    return json({ error: "Missing entityId" }, { status: 400 });
  }

  const subject = (formData.get("subject") as string) ?? "";

  // Collect slot.* overrides for per-send editable fields
  const bodyCopyOverrides: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("slot.") && typeof value === "string") {
      bodyCopyOverrides[key.slice(5)] = value;
    }
  }

  const result = await buildEmailContent({
    auth: { user, userDetails },
    contextKey,
    entityId,
    subject,
    bodyCopyOverrides,
  });

  if (!result.ok) {
    return json({ error: result.error }, { status: result.status });
  }

  return json({ subject: result.subjectResolved, html: result.htmlBody });
}
