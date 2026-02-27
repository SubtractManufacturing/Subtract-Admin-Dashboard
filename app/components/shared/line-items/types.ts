import type { LineItemWithPart } from "~/lib/lineItems";

export interface NormalizedDrawing {
  id: string;
  fileName: string;
  contentType: string | null;
  fileSize: number | null;
  signedUrl: string;
  thumbnailSignedUrl: string | null;
}

export interface NormalizedPart {
  id: string;
  partName?: string;
  thumbnailUrl?: string;
  material?: string;
  tolerance?: string;
  finish?: string;
  drawings: NormalizedDrawing[];
  modelUrl?: string;
  solidModelUrl?: string;
  cadFileUrl?: string;
  conversionStatus?: string;
}

export interface NormalizedLineItem {
  id: number;
  name: string;
  description?: string;
  notes?: string;
  quantity: number;
  unitPrice: string;
  totalPrice?: string;
  part?: NormalizedPart;
}

type QuoteLineItemInput = {
  id: number;
  quotePartId: string | null;
  name: string | null;
  description: string | null;
  notes: string | null;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
};

type QuoteDrawingInput = {
  id: string;
  fileName: string;
  contentType: string | null;
  fileSize: number | null;
  signedUrl?: string;
  thumbnailSignedUrl?: string | null;
};

type QuotePartInput = {
  id: string;
  partName: string;
  material: string | null;
  tolerance: string | null;
  finish: string | null;
  conversionStatus: string | null;
  partFileUrl?: string | null;
  signedFileUrl?: string;
  signedMeshUrl?: string;
  signedThumbnailUrl?: string;
  drawings?: QuoteDrawingInput[];
};

export function normalizeOrderLineItems(
  items: LineItemWithPart[]
): NormalizedLineItem[] {
  return items.map(({ lineItem, part }) => ({
    id: lineItem.id,
    name: lineItem.name || "",
    description: lineItem.description || undefined,
    notes: lineItem.notes || undefined,
    quantity: lineItem.quantity || 0,
    unitPrice: lineItem.unitPrice || "0",
    totalPrice: undefined,
    part: part
      ? {
          id: part.id,
          partName: part.partName || undefined,
          thumbnailUrl: part.thumbnailUrl || undefined,
          material: part.material || undefined,
          tolerance: part.tolerance || undefined,
          finish: part.finishing || undefined,
          drawings: (part.drawings || []).map((d) => ({
            id: d.id,
            fileName: d.fileName,
            contentType: d.contentType,
            fileSize: d.fileSize,
            signedUrl: d.signedUrl,
            thumbnailSignedUrl: d.thumbnailSignedUrl,
          })),
          modelUrl: part.partMeshUrl || undefined,
          solidModelUrl: part.partFileUrl || undefined,
          cadFileUrl: part.partFileUrl || undefined,
          conversionStatus: part.meshConversionStatus || undefined,
        }
      : undefined,
  }));
}

export function normalizeQuoteLineItems(
  lineItems: QuoteLineItemInput[],
  parts: QuotePartInput[]
): NormalizedLineItem[] {
  return lineItems.map((lineItem) => {
    const part = parts.find((p) => p.id === lineItem.quotePartId);
    return {
      id: lineItem.id,
      name: lineItem.name || "",
      description: lineItem.description || undefined,
      notes: lineItem.notes || undefined,
      quantity: lineItem.quantity || 0,
      unitPrice: lineItem.unitPrice || "0",
      totalPrice: lineItem.totalPrice || "0",
      part: part
        ? {
            id: part.id,
            partName: part.partName || undefined,
            thumbnailUrl: part.signedThumbnailUrl || undefined,
            material: part.material || undefined,
            tolerance: part.tolerance || undefined,
            finish: part.finish || undefined,
            drawings: (part.drawings || []).map((d) => ({
              id: d.id,
              fileName: d.fileName,
              contentType: d.contentType,
              fileSize: d.fileSize,
              signedUrl: d.signedUrl || `/download/attachment/${d.id}`,
              thumbnailSignedUrl: d.thumbnailSignedUrl || null,
            })),
            modelUrl: part.signedMeshUrl || undefined,
            solidModelUrl: part.signedFileUrl || undefined,
            cadFileUrl: part.partFileUrl || part.signedFileUrl || undefined,
            conversionStatus: part.conversionStatus || undefined,
          }
        : undefined,
    };
  });
}
