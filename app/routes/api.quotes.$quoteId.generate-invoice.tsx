import { type ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { getQuote } from "~/lib/quotes";
import { generateDocumentPdf } from "~/lib/pdf-service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);

  const quoteId = params.quoteId;
  if (!quoteId) {
    return new Response(JSON.stringify({ error: "Quote ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const quote = await getQuote(parseInt(quoteId));
  if (!quote) {
    return new Response(JSON.stringify({ error: "Quote not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const formData = await request.formData();
    const htmlContent = formData.get("htmlContent") as string;

    if (!htmlContent) {
      return new Response(JSON.stringify({ error: "Missing HTML content" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { pdfBuffer } = await generateDocumentPdf({
      entityType: "quote",
      entityId: quote.id,
      htmlContent,
      filename: `Invoice-${quote.quoteNumber}.pdf`,
      userId: user?.id,
      userEmail: user?.email || userDetails?.name || undefined,
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Invoice-${quote.quoteNumber}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("Invoice PDF generation error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to generate Invoice PDF",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
