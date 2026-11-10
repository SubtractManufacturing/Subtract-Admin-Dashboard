import { json, type ActionFunctionArgs } from "@remix-run/node";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { tryPartAssetAdminAction } from "~/lib/part-asset-admin.server";
import { getQuote } from "~/lib/quotes";
import { readFormData } from "~/lib/route-actions/request.server";
import { runQuoteIntent } from "./action";
import { createQuoteDeps } from "./deps.server";

/** Remix `action` for `/quotes/:quoteId`. */
export async function handleQuoteAction({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const respond = (response: Response) => withAuthHeaders(response, headers);

  if (!params.quoteId) {
    return respond(json({ error: "Quote ID is required" }, { status: 400 }));
  }
  const quote = await getQuote(parseInt(params.quoteId, 10));
  if (!quote) {
    return respond(json({ error: "Quote not found" }, { status: 404 }));
  }

  const parsed = await readFormData(request);
  if (!parsed.ok) return respond(parsed.response);
  const { formData, multipart } = parsed;

  // A multipart post with no intent is a plain attachment upload.
  const intent = formData.get("intent") ?? (multipart ? "uploadAttachment" : null);

  const response = await runQuoteIntent({
    quote,
    auth: { user, userDetails },
    formData,
    intent,
    deps: createQuoteDeps(),
    // Auth headers are applied once, below, so hand the admin helper none.
    partAssetAdmin: (fd) =>
      tryPartAssetAdminAction(
        fd,
        { type: "quote", quoteId: quote.id },
        { user: { id: user.id }, userDetails, headers: new Headers() },
      ),
  });
  return respond(response);
}
