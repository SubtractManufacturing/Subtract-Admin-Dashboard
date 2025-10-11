import { type ActionFunctionArgs } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { getOrder } from "~/lib/orders";
import { generateDocumentPdf } from "~/lib/pdf-service.server";

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);

  const orderId = params.orderId;
  if (!orderId) {
    return new Response(JSON.stringify({ error: "Order ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const order = await getOrder(parseInt(orderId));
  if (!order) {
    return new Response(JSON.stringify({ error: "Order not found" }), {
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
      entityType: "order",
      entityId: order.id,
      htmlContent,
      filename: `Invoice-${order.orderNumber}.pdf`,
      userId: user?.id,
      userEmail: user?.email || userDetails?.name || undefined,
    });

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Invoice-${order.orderNumber}.pdf"`,
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
