import { LoaderFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { canUserManageQuotes } from "~/lib/featureFlags";
import { downloadQuoteFiles } from "~/lib/downloadQuoteFiles";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  const quoteId = params.quoteId;
  if (!quoteId) {
    throw new Response("Quote ID is required", { status: 400 });
  }

  const canManageQuotes = await canUserManageQuotes();
  if (!canManageQuotes) {
    throw new Response("Not authorized to download files", { status: 403 });
  }

  try {
    const { buffer, filename } = await downloadQuoteFiles(parseInt(quoteId));

    return new Response(buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("[Download Resource] Error:", error);
    throw new Response("Failed to download files", { status: 500 });
  }
}
