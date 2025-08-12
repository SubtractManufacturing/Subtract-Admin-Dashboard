import { redirect } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { getDownloadUrl } from "~/lib/s3.server";
import { getAttachment } from "~/lib/attachments";
import { requireAuth } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  const attachmentId = params.id;
  if (!attachmentId) {
    throw new Response("Attachment ID is required", { status: 400 });
  }

  try {
    const attachment = await getAttachment(attachmentId);
    if (!attachment) {
      throw new Response("Attachment not found", { status: 404 });
    }

    // Generate a presigned URL for download
    const downloadUrl = await getDownloadUrl(attachment.s3Key);

    // Redirect to the presigned URL
    return redirect(downloadUrl);
  } catch (error) {
    console.error('Download error:', error);
    throw new Response("Failed to generate download URL", { status: 500 });
  }
}