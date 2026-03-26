import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";
import {
  isEmailContextKey,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import { enqueueOutboundUserEmail } from "~/lib/email/enqueue-outbound-email.server";
import type { SentEmailEntityType } from "~/lib/db/schema";

const ENTITY_TYPES: readonly SentEmailEntityType[] = [
  "quote",
  "order",
  "invoice",
];

function isSentEmailEntityType(x: string): x is SentEmailEntityType {
  return (ENTITY_TYPES as readonly string[]).includes(x);
}

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

  const entityTypeRaw = (formData.get("entityType") as string)?.trim() ?? "";
  if (!isSentEmailEntityType(entityTypeRaw)) {
    return json({ error: "Invalid or missing entityType" }, { status: 400 });
  }
  const entityType = entityTypeRaw;

  const entityId = (formData.get("entityId") as string)?.trim() ?? "";
  if (!entityId) {
    return json({ error: "Missing entityId" }, { status: 400 });
  }

  const subject = (formData.get("subject") as string) ?? "";
  const cc = (formData.get("cc") as string | null) ?? "";
  const idempotencyKey = (formData.get("idempotencyKey") as string) ?? "";
  const attachmentIds = formData.getAll("attachmentId") as string[];

  const result = await enqueueOutboundUserEmail({
    auth: { user, userDetails },
    contextKey,
    entityType,
    entityId,
    subject,
    cc,
    attachmentIds,
    idempotencyKey,
  });

  if (!result.ok) {
    return json({ error: result.error }, { status: result.status });
  }

  return json({ success: true });
}
