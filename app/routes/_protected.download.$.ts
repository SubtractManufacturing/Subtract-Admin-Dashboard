import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { requireAuth } from "~/lib/auth.server";
import { downloadFromS3 } from "~/lib/s3.server";
import { getAttachment } from "~/lib/attachments";
import { getPartWithAttachments, getPartMeshUrl } from "~/lib/parts";
import { getQuotePartWithAttachments } from "~/lib/quoteParts";
import { getOriginalFilename } from "~/lib/file-download.server";
import { downloadQuoteFiles } from "~/lib/downloadQuoteFiles";
import { getCustomersByIds } from "~/lib/customers";
import { getVendorsByIds } from "~/lib/vendors";
import {
  toExportCustomer,
  toExportVendor,
  customersToCSV,
  vendorsToCSV,
  customersTemplateCSV,
  vendorsTemplateCSV,
  toExportJSON,
  type ExportCustomer,
  type ExportVendor,
} from "~/lib/bulk-export";
import { createEvent } from "~/lib/events";

/**
 * Unified download resource route.
 *
 * URL patterns:
 *   /download/attachment/{id}           – Attachment by ID
 *   /download/part/{partId}             – Part CAD file
 *   /download/quote-part/{quotePartId}  – Quote part CAD file
 *   /download/quote/{quoteId}           – Quote bundle ZIP
 *   /download/mesh/{partId}             – Part mesh URL (JSON)
 *   /download/export-customers         – Bulk export customers (query: ids, format) – Admin/Dev only
 *   /download/export-vendors            – Bulk export vendors (query: ids, format) – Admin/Dev only
 *
 * Query parameters:
 *   ?inline  – Return with Content-Disposition: inline and the real content
 *              type so browsers can render the file (used by FileViewerModal).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);

  const path = params["*"];
  if (!path) {
    throw new Response("Download path required", { status: 400 });
  }

  const url = new URL(request.url);
  const inline = url.searchParams.has("inline");

  const [type, ...rest] = path.split("/");
  const id = rest.join("/");

  if (type === "export-customers" || type === "export-vendors") {
    if (userDetails.role !== "Admin" && userDetails.role !== "Dev") {
      return new Response("Forbidden", { status: 403 });
    }
    const idsParam = url.searchParams.get("ids");
    const format = url.searchParams.get("format") ?? "csv";
    if (!idsParam || !["csv", "json"].includes(format)) {
      return new Response("Missing or invalid ids or format (use ids=1,2,3&format=csv|json)", {
        status: 400,
      });
    }
    const isTemplate = idsParam.trim().toLowerCase() === "template";
    if (isTemplate) {
      if (format !== "csv") {
        return new Response("Template is only available as CSV", { status: 400 });
      }
      const templateBody =
        type === "export-customers" ? customersTemplateCSV() : vendorsTemplateCSV();
      const templateFilename =
        type === "export-customers"
          ? "customers-template.csv"
          : "vendors-template.csv";
      const buffer = Buffer.from(templateBody, "utf-8");
      return createDownloadResponse(buffer, templateFilename, "text/csv");
    }
    const ids = idsParam
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    if (ids.length === 0) {
      return new Response("No valid IDs provided", { status: 400 });
    }
    try {
      if (type === "export-customers") {
        return await handleExportCustomers(ids, format, user?.id, user?.email ?? userDetails.name ?? undefined);
      }
      return await handleExportVendors(ids, format, user?.id, user?.email ?? userDetails.name ?? undefined);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Export failed";
      console.error("Bulk export error:", err);
      await createEvent({
        entityType: "system",
        entityId: "bulk_export",
        eventType: "bulk_export_error",
        eventCategory: "system",
        title: "Bulk export failed",
        description: errorMessage,
        metadata: { entityType: type, format, error: errorMessage, ids },
        userId: user?.id,
        userEmail: user?.email ?? userDetails.name ?? undefined,
      });
      return new Response(errorMessage, { status: 500 });
    }
  }

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
    case "mesh":
      return handleMeshUrl(id);
    default:
      throw new Response(`Unknown download type: ${type}`, { status: 400 });
  }
}

async function handleExportCustomers(
  ids: number[],
  format: string,
  userId?: string,
  userEmail?: string
): Promise<Response> {
  const entities = await getCustomersByIds(ids);
  if (entities.length === 0) {
    const msg = "No customers found for the given IDs";
    console.error("Bulk export customers:", msg, { ids });
    await createEvent({
      entityType: "system",
      entityId: "bulk_export",
      eventType: "bulk_export_error",
      eventCategory: "system",
      title: "Bulk export failed",
      description: msg,
      metadata: { entityType: "customers", format, error: msg, ids },
      userId,
      userEmail,
    });
    return new Response(msg, { status: 404 });
  }
  await createEvent({
    entityType: "system",
    entityId: "bulk_export",
    eventType: "bulk_export_started",
    eventCategory: "system",
    title: "Bulk export started",
    description: `Exporting ${entities.length} customer(s) as ${format}`,
    metadata: { entityType: "customers", format, count: entities.length, ids },
    userId,
    userEmail,
  });
  const exportData: ExportCustomer[] = entities.map((r) => toExportCustomer(r));
  const filename = `customers-export-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "csv"}`;
  if (format === "json") {
    const body = toExportJSON("customers", exportData);
    const buffer = Buffer.from(body, "utf-8");
    return createDownloadResponse(buffer, filename, "application/json");
  }
  const body = customersToCSV(exportData);
  const buffer = Buffer.from(body, "utf-8");
  return createDownloadResponse(buffer, filename, "text/csv");
}

async function handleExportVendors(
  ids: number[],
  format: string,
  userId?: string,
  userEmail?: string
): Promise<Response> {
  const entities = await getVendorsByIds(ids);
  if (entities.length === 0) {
    const msg = "No vendors found for the given IDs";
    console.error("Bulk export vendors:", msg, { ids });
    await createEvent({
      entityType: "system",
      entityId: "bulk_export",
      eventType: "bulk_export_error",
      eventCategory: "system",
      title: "Bulk export failed",
      description: msg,
      metadata: { entityType: "vendors", format, error: msg, ids },
      userId,
      userEmail,
    });
    return new Response(msg, { status: 404 });
  }
  await createEvent({
    entityType: "system",
    entityId: "bulk_export",
    eventType: "bulk_export_started",
    eventCategory: "system",
    title: "Bulk export started",
    description: `Exporting ${entities.length} vendor(s) as ${format}`,
    metadata: { entityType: "vendors", format, count: entities.length, ids },
    userId,
    userEmail,
  });
  const exportData: ExportVendor[] = entities.map((r) => toExportVendor(r));
  const filename = `vendors-export-${new Date().toISOString().slice(0, 10)}.${format === "json" ? "json" : "csv"}`;
  if (format === "json") {
    const body = toExportJSON("vendors", exportData);
    const buffer = Buffer.from(body, "utf-8");
    return createDownloadResponse(buffer, filename, "application/json");
  }
  const body = vendorsToCSV(exportData);
  const buffer = Buffer.from(body, "utf-8");
  return createDownloadResponse(buffer, filename, "text/csv");
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
  const id = parseInt(quoteId, 10);
  if (isNaN(id)) {
    throw new Response("Invalid quote ID", { status: 400 });
  }
  const { buffer, filename } = await downloadQuoteFiles(id);

  return createDownloadResponse(buffer, filename, "application/zip");
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
  // Use a literal quoted filename. The simple filename= parameter accepts
  // spaces and most characters when quoted — do not percent-encode it here.
  // Only escape embedded double-quotes to keep the header well-formed.
  const safeFilename = filename.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const disposition = inline
    ? `inline; filename="${safeFilename}"`
    : `attachment; filename="${safeFilename}"`;

  return new Response(new Uint8Array(buffer), {
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
