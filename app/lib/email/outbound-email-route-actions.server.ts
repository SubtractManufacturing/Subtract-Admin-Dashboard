import { json } from "@remix-run/node";
import type { SentEmailEntityType } from "~/lib/db/schema";
import { buildEmailContent } from "~/lib/email/build-email-content.server";
import {
  isEmailContextKey,
  type EmailContextKey,
} from "~/lib/email/email-context-registry";
import { enqueueOutboundUserEmail } from "~/lib/email/enqueue-outbound-email.server";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";
import { isOutboundEmailEnabled } from "~/lib/featureFlags";

const ENTITY_TYPES: readonly SentEmailEntityType[] = [
  "quote",
  "order",
  "invoice",
];

function isSentEmailEntityType(x: string): x is SentEmailEntityType {
  return (ENTITY_TYPES as readonly string[]).includes(x);
}

function collectBodyCopyOverrides(formData: FormData): Record<string, string> {
  const bodyCopyOverrides: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("slot.") && typeof value === "string") {
      bodyCopyOverrides[key.slice(5)] = value;
    }
  }
  return bodyCopyOverrides;
}

function parseContextKey(formData: FormData) {
  const contextKeyRaw = (formData.get("contextKey") as string)?.trim() ?? "";
  if (!contextKeyRaw || !isEmailContextKey(contextKeyRaw)) {
    return {
      ok: false as const,
      response: json({ error: "Invalid or missing contextKey" }, { status: 400 }),
    };
  }
  return { ok: true as const, contextKey: contextKeyRaw as EmailContextKey };
}

function parseEntityId(formData: FormData) {
  const entityId = (formData.get("entityId") as string)?.trim() ?? "";
  if (!entityId) {
    return {
      ok: false as const,
      response: json({ error: "Missing entityId" }, { status: 400 }),
    };
  }
  return { ok: true as const, entityId };
}

function validateExpectedScope(
  contextKey: EmailContextKey,
  entityId: string,
  expected: { contextKey: EmailContextKey; entityId: string },
) {
  if (contextKey !== expected.contextKey || entityId !== expected.entityId) {
    return json({ error: "Invalid email context for this route" }, { status: 400 });
  }
  return null;
}

export async function handleEmailPreviewAction({
  auth,
  formData,
  expected,
}: {
  auth: EmailEnqueueAuth;
  formData: FormData;
  expected: { contextKey: EmailContextKey; entityId: string };
}) {
  if (!(await isOutboundEmailEnabled())) {
    return json({ error: "Outbound email is disabled." }, { status: 403 });
  }

  const contextKeyResult = parseContextKey(formData);
  if (!contextKeyResult.ok) return contextKeyResult.response;

  const entityIdResult = parseEntityId(formData);
  if (!entityIdResult.ok) return entityIdResult.response;

  const scopeError = validateExpectedScope(
    contextKeyResult.contextKey,
    entityIdResult.entityId,
    expected,
  );
  if (scopeError) return scopeError;

  const subject = (formData.get("subject") as string) ?? "";
  const bodyCopyOverrides = collectBodyCopyOverrides(formData);

  const result = await buildEmailContent({
    auth,
    contextKey: contextKeyResult.contextKey,
    entityId: entityIdResult.entityId,
    subject,
    bodyCopyOverrides,
  });

  if (!result.ok) {
    return json({ error: result.error }, { status: result.status });
  }

  return json({ subject: result.subjectResolved, html: result.htmlBody });
}

export async function handleEmailQueueAction({
  auth,
  formData,
  expected,
}: {
  auth: EmailEnqueueAuth;
  formData: FormData;
  expected: {
    contextKey: EmailContextKey;
    entityType: SentEmailEntityType;
    entityId: string;
  };
}) {
  if (!(await isOutboundEmailEnabled())) {
    return json({ error: "Outbound email is disabled." }, { status: 403 });
  }

  const contextKeyResult = parseContextKey(formData);
  if (!contextKeyResult.ok) return contextKeyResult.response;

  const entityTypeRaw = (formData.get("entityType") as string)?.trim() ?? "";
  if (!isSentEmailEntityType(entityTypeRaw)) {
    return json({ error: "Invalid or missing entityType" }, { status: 400 });
  }

  const entityIdResult = parseEntityId(formData);
  if (!entityIdResult.ok) return entityIdResult.response;

  const scopeError = validateExpectedScope(
    contextKeyResult.contextKey,
    entityIdResult.entityId,
    expected,
  );
  if (scopeError) return scopeError;

  if (entityTypeRaw !== expected.entityType) {
    return json({ error: "Invalid email entity type for this route" }, { status: 400 });
  }

  const subject = (formData.get("subject") as string) ?? "";
  const cc = (formData.get("cc") as string | null) ?? "";
  const idempotencyKey = (formData.get("idempotencyKey") as string) ?? "";
  const attachmentIds = formData.getAll("attachmentId") as string[];
  const bodyCopyOverrides = collectBodyCopyOverrides(formData);

  const result = await enqueueOutboundUserEmail({
    auth,
    contextKey: contextKeyResult.contextKey,
    entityType: entityTypeRaw,
    entityId: entityIdResult.entityId,
    subject,
    cc,
    attachmentIds,
    idempotencyKey,
    bodyCopyOverrides: Object.keys(bodyCopyOverrides).length > 0
      ? bodyCopyOverrides
      : undefined,
  });

  if (!result.ok) {
    return json({ error: result.error }, { status: result.status });
  }

  return json({ success: true, delivery: result.delivery });
}
