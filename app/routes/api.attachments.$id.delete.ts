import { json } from "@remix-run/node"
import type { ActionFunctionArgs } from "@remix-run/node"
import { deleteFile } from "~/lib/s3.server"
import { getAttachment, deleteAttachment, unlinkAttachmentFromOrder } from "~/lib/attachments"
import { requireAuth } from "~/lib/auth.server"

export async function action({ request, params }: ActionFunctionArgs) {
  await requireAuth(request)

  if (request.method !== "DELETE") {
    return json({ error: "Method not allowed" }, { status: 405 })
  }

  const attachmentId = params.id
  if (!attachmentId) {
    return json({ error: "Attachment ID is required" }, { status: 400 })
  }

  try {
    const formData = await request.formData()
    const orderId = formData.get("orderId") as string

    if (!orderId) {
      return json({ error: "Order ID is required" }, { status: 400 })
    }

    const orderIdNum = parseInt(orderId)
    if (isNaN(orderIdNum)) {
      return json({ error: "Invalid order ID" }, { status: 400 })
    }

    // Get attachment details
    const attachment = await getAttachment(attachmentId)
    if (!attachment) {
      return json({ error: "Attachment not found" }, { status: 404 })
    }

    // Unlink from order first
    await unlinkAttachmentFromOrder(orderIdNum, attachmentId)

    // Delete from S3
    await deleteFile(attachment.s3Key)

    // Delete database record
    await deleteAttachment(attachmentId)

    return json({ success: true })
  } catch (error) {
    console.error('Delete error:', error)
    return json({ error: "Failed to delete attachment" }, { status: 500 })
  }
}