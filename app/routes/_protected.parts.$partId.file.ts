import type { LoaderFunctionArgs } from "@remix-run/node";
import { getDownloadUrl } from "~/lib/s3.server";
import { getPartWithAttachments } from "~/lib/parts";
import { getOriginalFilename } from "~/lib/file-download.server";
import { requireAuth } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  const partId = params.partId;
  if (!partId) {
    throw new Response("Part ID is required", { status: 400 });
  }

  try {
    const partWithAttachments = await getPartWithAttachments(partId);
    if (!partWithAttachments) {
      throw new Response("Part not found", { status: 404 });
    }

    if (!partWithAttachments.partFileUrl) {
      throw new Response("Part has no file", { status: 404 });
    }

    // Find attachment filename if available
    const attachmentFilename = partWithAttachments.models?.find(
      m => m.attachment.s3Key === partWithAttachments.partFileUrl
    )?.attachment?.fileName;

    // Get the original filename from various sources
    const filename = await getOriginalFilename(
      partWithAttachments.partFileUrl,
      attachmentFilename
    );

    // Generate presigned URL and fetch the file
    const downloadUrl = await getDownloadUrl(partWithAttachments.partFileUrl);
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
