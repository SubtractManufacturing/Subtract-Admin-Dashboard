import { type ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { getQuote } from "~/lib/quotes";
import { generatePdf } from "~/lib/pdf-generator.server";
import { uploadFile, generateFileKey } from "~/lib/s3.server";
import { createAttachment, type AttachmentEventContext } from "~/lib/attachments";
import { db } from "~/lib/db";
import { quoteAttachments } from "~/lib/db/schema";

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

    // Wrap the HTML content in a full HTML document
    const fullHtml = `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Quote ${quote.quoteNumber}</title>
        </head>
        <body>
          ${htmlContent}
        </body>
      </html>
    `;

    // Generate PDF
    const pdfBuffer = await generatePdf({
      html: fullHtml,
      filename: `quote-${quote.quoteNumber}.pdf`,
    });

    // Upload PDF to S3
    const fileName = `quote-${quote.quoteNumber}.pdf`;
    const fileKey = generateFileKey(quote.id, fileName);
    const uploadResult = await uploadFile({
      key: fileKey,
      buffer: pdfBuffer,
      contentType: "application/pdf",
      fileName,
    });

    const eventContext: AttachmentEventContext = {
      userId: user?.id,
      userEmail: user?.email || userDetails?.name || undefined,
    };

    // Create attachment record
    const attachment = await createAttachment(
      {
        s3Bucket: uploadResult.bucket,
        s3Key: uploadResult.key,
        fileName: uploadResult.fileName,
        contentType: uploadResult.contentType,
        fileSize: uploadResult.size,
      },
      eventContext
    );

    // Link to quote
    await db.insert(quoteAttachments).values({
      quoteId: quote.id,
      attachmentId: attachment.id,
    });

    // Return PDF as download
    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="quote-${quote.quoteNumber}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  } catch (error) {
    console.error("PDF generation error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Failed to generate PDF",
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
