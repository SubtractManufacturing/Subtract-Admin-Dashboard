import * as mupdf from "mupdf";

interface ThumbnailResult {
  buffer: Buffer;
  width: number;
  height: number;
}

/**
 * Generate a PNG thumbnail from the first page of a PDF using MuPDF (WASM)
 * @param pdfBuffer - The PDF file as a Buffer
 * @param maxWidth - Maximum width of the thumbnail (default 200px)
 * @param maxHeight - Maximum height of the thumbnail (default 200px)
 * @returns PNG buffer and dimensions
 */
export async function generatePdfThumbnail(
  pdfBuffer: Buffer,
  maxWidth: number = 200,
  maxHeight: number = 200
): Promise<ThumbnailResult> {
  // Open the PDF document from buffer
  const doc = mupdf.Document.openDocument(pdfBuffer, "application/pdf");

  // Get the first page (0-indexed)
  const page = doc.loadPage(0);

  // Get the page bounds to calculate dimensions [x0, y0, x1, y1]
  const bounds = page.getBounds();
  const pageWidth = bounds[2] - bounds[0];
  const pageHeight = bounds[3] - bounds[1];

  // Calculate scale to fit within maxWidth x maxHeight while maintaining aspect ratio
  const scaleX = maxWidth / pageWidth;
  const scaleY = maxHeight / pageHeight;
  const scale = Math.min(scaleX, scaleY);

  // Calculate final dimensions
  const width = Math.round(pageWidth * scale);
  const height = Math.round(pageHeight * scale);

  // Create a scaling matrix
  const matrix = mupdf.Matrix.scale(scale, scale);

  // Render the page to a pixmap with the scaling matrix
  const pixmap = page.toPixmap(
    matrix,
    mupdf.ColorSpace.DeviceRGB,
    false, // No transparency (alpha)
    true // Include annotations
  );

  // Convert to PNG
  const pngData = pixmap.asPNG();

  return {
    buffer: Buffer.from(pngData),
    width,
    height,
  };
}

/**
 * Check if a file is a PDF based on content type or filename
 */
export function isPdfFile(
  contentType?: string | null,
  fileName?: string | null
): boolean {
  if (contentType === "application/pdf") {
    return true;
  }
  if (fileName?.toLowerCase().endsWith(".pdf")) {
    return true;
  }
  return false;
}
