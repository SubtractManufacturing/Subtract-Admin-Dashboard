import { json } from "@remix-run/node"
import type { ActionFunctionArgs } from "@remix-run/node"
import { uploadFile, generateFileKey } from "~/lib/s3.server"
import { createAttachment, linkAttachmentToOrder } from "~/lib/attachments"
import { requireAuth } from "~/lib/auth.server"

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB

export async function action({ request }: ActionFunctionArgs) {
  await requireAuth(request)

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 })
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file") as File
    const orderId = formData.get("orderId") as string

    if (!file || !orderId) {
      return json({ error: "Missing required fields" }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE) {
      return json({ error: "File size exceeds 50MB limit" }, { status: 400 })
    }

    const orderIdNum = parseInt(orderId)
    if (isNaN(orderIdNum)) {
      return json({ error: "Invalid order ID" }, { status: 400 })
    }

    // Convert File to Buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Generate S3 key
    const key = generateFileKey(orderIdNum, file.name)

    // Upload to S3
    const uploadResult = await uploadFile({
      key,
      buffer,
      contentType: file.type || 'application/octet-stream',
      fileName: file.name,
    })

    // Create attachment record
    const attachment = await createAttachment({
      s3Bucket: uploadResult.bucket,
      s3Key: uploadResult.key,
      fileName: uploadResult.fileName,
      contentType: uploadResult.contentType,
      fileSize: uploadResult.size,
    })

    // Link to order
    await linkAttachmentToOrder(orderIdNum, attachment.id)

    return json({ 
      success: true, 
      attachment: {
        id: attachment.id,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        contentType: attachment.contentType,
        createdAt: attachment.createdAt,
      }
    })
  } catch (error) {
    console.error('Upload error:', error)
    return json({ error: "Failed to upload file" }, { status: 500 })
  }
}