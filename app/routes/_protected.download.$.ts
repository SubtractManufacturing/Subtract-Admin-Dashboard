import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { downloadFromS3 } from "~/lib/s3.server";
import { getAttachment } from "~/lib/attachments";
import { getPartWithAttachments, getPartMeshUrl } from "~/lib/parts";
import { getQuotePartWithAttachments } from "~/lib/quoteParts";
import { getOriginalFilename } from "~/lib/file-download.server";
import { downloadQuoteFiles } from "~/lib/downloadQuoteFiles";

/**
 * Unified download resource route.
 *
 * URL patterns:
 *   /download/attachment/{id}           – Attachment by ID
 *   /download/part/{partId}             – Part CAD file
 *   /download/quote-part/{quotePartId}  – Quote part CAD file
 *   /download/quote/{quoteId}           – Quote bundle ZIP
 *   /download/s3/{...s3Key}             – Direct S3 key download
 *   /download/mesh/{partId}             – Part mesh URL (JSON)
 *
 * Query parameters:
 *   ?inline  – Return with Content-Disposition: inline and the real content
 *              type so browsers can render the file (used by FileViewerModal).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  await requireAuth(request);

  const path = params["*"];
  if (!path) {
    throw new Response("Download path required", { status: 400 });
  }

  const url = new URL(request.url);
  const inline = url.searchParams.has("inline");

  const [type, ...rest] = path.split("/");
  const id = rest.join("/");

  if (!id) {
    throw new Response("Resource ID required", { status: 400 });
  }

  switch (type) {
    case "attachment":
      return handleAttachmentDownload(id, inline);
    case "part":
      return handlePartDownload(id);
    case "quote-part":
      return handleQuotePartDownload(id);
    case "quote":
      return handleQuoteBundleDownload(id);
    case "s3":
      return handleS3Download(id, inline);
    case "mesh":
      return handleMeshUrl(id);
    default:
      throw new Response(`Unknown download type: ${type}`, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleAttachmentDownload(id: string, inline = false) {
  const attachment = await getAttachment(id);
  if (!attachment) {
    throw new Response("Attachment not found", { status: 404 });
  }

  const filename = await getOriginalFilename(
    attachment.s3Key,
    attachment.fileName
  );
  const buffer = await downloadFromS3(attachment.s3Key);
  const resolvedFilename = filename || attachment.fileName || "download";

  // When inline, use the stored content type so browsers can render the file
  const contentType = inline
    ? (attachment.contentType || getMimeType(resolvedFilename))
    : "application/octet-stream";

  return createDownloadResponse(buffer, resolvedFilename, contentType, inline);
}

async function handlePartDownload(partId: string) {
  const part = await getPartWithAttachments(partId);
  if (!part) {
    throw new Response("Part not found", { status: 404 });
  }
  if (!part.partFileUrl) {
    throw new Response("Part has no file", { status: 404 });
  }

  const attachmentFilename = part.models?.find(
    (m) => m.attachment.s3Key === part.partFileUrl
  )?.attachment?.fileName;

  const filename = await getOriginalFilename(
    part.partFileUrl,
    attachmentFilename
  );
  const buffer = await downloadFromS3(part.partFileUrl);

  return createDownloadResponse(
    buffer,
    filename || "download.step",
    "application/octet-stream"
  );
}

async function handleQuotePartDownload(quotePartId: string) {
  const quotePart = await getQuotePartWithAttachments(quotePartId);
  if (!quotePart) {
    throw new Response("Quote part not found", { status: 404 });
  }
  if (!quotePart.partFileUrl) {
    throw new Response("Quote part has no file", { status: 404 });
  }

  const attachmentFilename = quotePart.drawings?.find(
    (d) => d.attachment.s3Key === quotePart.partFileUrl
  )?.attachment?.fileName;

  const filename = await getOriginalFilename(
    quotePart.partFileUrl,
    attachmentFilename
  );
  const buffer = await downloadFromS3(quotePart.partFileUrl);

  return createDownloadResponse(
    buffer,
    filename || "download.step",
    "application/octet-stream"
  );
}

async function handleQuoteBundleDownload(quoteId: string) {
  const { buffer, filename } = await downloadQuoteFiles(parseInt(quoteId));

  return createDownloadResponse(buffer, filename, "application/zip");
}

async function handleS3Download(s3Key: string, inline = false) {
  const buffer = await downloadFromS3(s3Key);
  const filename = s3Key.split("/").pop() || "download";
  const contentType = inline ? getMimeType(filename) : "application/octet-stream";

  return createDownloadResponse(buffer, filename, contentType, inline);
}

async function handleMeshUrl(partId: string) {
  const result = await getPartMeshUrl(partId);

  if ("error" in result) {
    const statusCode =
      result.error === "Part not found" || result.error === "Part has no mesh file"
        ? 404
        : 500;
    return json({ error: result.error }, { status: statusCode });
  }

  return json({ url: result.url });
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function createDownloadResponse(
  buffer: Buffer,
  filename: string,
  contentType: string,
  inline = false
): Response {
  const disposition = inline
    ? `inline; filename="${encodeRFC5987(filename)}"`
    : `attachment; filename="${encodeRFC5987(filename)}"`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Content-Length": buffer.length.toString(),
      "Cache-Control": "private, no-cache",
    },
  });
}

/**
 * RFC 5987 encoding for filenames with special / international characters.
 */
function encodeRFC5987(filename: string): string {
  return encodeURIComponent(filename)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}

/**
 * Derive MIME type from a filename extension.
 * Used when serving files inline so browsers can render them correctly.
 */
function getMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    // Documents
    pdf: "application/pdf",
    // Images
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    tiff: "image/tiff",
    tif: "image/tiff",
    // Video
    mp4: "video/mp4",
    webm: "video/webm",
    ogg: "video/ogg",
    mov: "video/quicktime",
    // Audio
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    // Text
    txt: "text/plain",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    html: "text/html",
    css: "text/css",
    js: "text/javascript",
    // CAD / Engineering
    step: "application/octet-stream",
    stp: "application/octet-stream",
    stl: "application/octet-stream",
    obj: "application/octet-stream",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    // Archives
    zip: "application/zip",
    gz: "application/gzip",
    tar: "application/x-tar",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}
