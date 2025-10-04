import type { LoaderFunctionArgs } from "@remix-run/node";
import { getDownloadUrl } from "~/lib/s3.server";
import { getQuotePartWithAttachments } from "~/lib/quoteParts";
import { getOriginalFilename } from "~/lib/file-download.server";
import { requireAuth } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  const quotePartId = params.quotePartId;
  if (!quotePartId) {
    throw new Response("Quote Part ID is required", { status: 400 });
  }

  try {
    const quotePartWithAttachments = await getQuotePartWithAttachments(quotePartId);
    if (!quotePartWithAttachments) {
      throw new Response("Quote part not found", { status: 404 });
    }

    if (!quotePartWithAttachments.partFileUrl) {
      throw new Response("Quote part has no file", { status: 404 });
    }

    // Find attachment filename if available
    const attachmentFilename = quotePartWithAttachments.drawings?.find(
      d => d.attachment.s3Key === quotePartWithAttachments.partFileUrl
    )?.attachment?.fileName;

    // Get the original filename from various sources
    const filename = await getOriginalFilename(
      quotePartWithAttachments.partFileUrl,
      attachmentFilename
    );

    // Generate presigned URL and fetch the file
    const downloadUrl = await getDownloadUrl(quotePartWithAttachments.partFileUrl);
    const fileResponse = await fetch(downloadUrl);

    if (!fileResponse.ok) {
      throw new Response("Failed to fetch file from storage", { status: 500 });
    }

    const fileBuffer = await fileResponse.arrayBuffer();

    // Return with proper Content-Disposition header for filename
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename || 'download.step'}"`,
        "Content-Length": fileBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error('Download error:', error);
    throw new Response("Failed to download file", { status: 500 });
  }
}