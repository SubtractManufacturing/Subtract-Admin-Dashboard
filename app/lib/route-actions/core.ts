/**
 * Intent dispatch core shared by the Quote and Order detail routes.
 *
 * Interface: an {@link IntentTable} maps a form `intent` to a handler. Handlers
 * receive an entity context plus the parsed `FormData` and return a `Response`.
 * The route owns authentication, the response auth headers, and request parsing;
 * handlers never touch `Request` or auth cookies, which is what lets them be
 * tested with plain `FormData` and fake dependencies.
 */
import { json } from "@remix-run/node";

/** Who performed an action; stamped onto audit events. */
export type Actor = {
  userId?: string;
  userEmail?: string;
};

export type ActorSource = {
  user?: { id?: string | null; email?: string | null } | null;
  userDetails?: { name?: string | null } | null;
};

/** Event/audit identity for the signed-in user. Falls back to display name when email is absent. */
export function actorFromAuth({ user, userDetails }: ActorSource): Actor {
  return {
    userId: user?.id ?? undefined,
    userEmail: user?.email || userDetails?.name || undefined,
  };
}

export type IntentHandler<C> = (ctx: C, formData: FormData) => Promise<Response>;
export type IntentTable<C> = Readonly<Record<string, IntentHandler<C>>>;

/** Combine intent tables; two modules claiming the same intent is a programming error. */
export function mergeIntentTables<C>(
  ...tables: ReadonlyArray<IntentTable<C>>
): IntentTable<C> {
  const merged: Record<string, IntentHandler<C>> = {};
  for (const table of tables) {
    for (const [intent, handler] of Object.entries(table)) {
      if (Object.hasOwn(merged, intent)) {
        throw new Error(`Duplicate handler registered for intent "${intent}"`);
      }
      merged[intent] = handler;
    }
  }
  return merged;
}

export type DispatchMessages = {
  /** Error text for an unknown or missing intent (400). */
  unknownIntent: string;
  /** Error text when a handler throws (500). */
  failure: string;
};

/**
 * Run the handler for `intent`. Unknown intents yield 400; an uncaught handler
 * error is logged and yields 500 so the client always receives JSON.
 */
export async function dispatchIntent<C>(args: {
  table: IntentTable<C>;
  intent: FormDataEntryValue | null;
  ctx: C;
  formData: FormData;
  messages: DispatchMessages;
}): Promise<Response> {
  const { table, intent, ctx, formData, messages } = args;
  if (typeof intent !== "string" || !Object.hasOwn(table, intent)) {
    return badRequest(messages.unknownIntent);
  }
  try {
    return await table[intent](ctx, formData);
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: messages.failure }, { status: 500 });
  }
}

export function badRequest(error: string, extra?: Record<string, unknown>): Response {
  return json({ error, ...extra }, { status: 400 });
}

export function forbidden(error: string): Response {
  return json({ error }, { status: 403 });
}

export function notFound(error: string): Response {
  return json({ error }, { status: 404 });
}

export function serverError(error: string): Response {
  return json({ error }, { status: 500 });
}

export function ok(body: Record<string, unknown> = { success: true }): Response {
  return json(body);
}

/** Read a text field as a trimmed-or-null string. */
export function optionalText(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (typeof value !== "string") return null;
  return value;
}

/** Parse a base-10 integer id; `null` when absent or not a number. */
export function parseIntegerField(
  formData: FormData,
  key: string,
): number | null {
  const raw = formData.get(key);
  if (raw === null || raw === "") return null;
  const parsed = parseInt(String(raw), 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Maximum accepted upload size for any single file on a detail route. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
