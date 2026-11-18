import type { Action, Resource } from "./authorize";

export type DownloadAccess = { action: Action; resource?: Resource };

/**
 * Maps a `/download/{type}/…` segment to the action (and resource) that must
 * be authorized before any lookup happens. Returns null for unknown types.
 */
export function downloadAccess(type: string, id: string): DownloadAccess | null {
  switch (type) {
    case "attachment":
      return { action: "download.attachment", resource: { type: "attachment", id } };
    case "part":
      return { action: "download.part", resource: { type: "part", id } };
    case "quote-part":
      return { action: "download.quote-part", resource: { type: "quote-part", id } };
    case "quote":
      return { action: "download.quote", resource: { type: "quote", id } };
    case "mesh":
      return { action: "download.mesh", resource: { type: "part", id } };
    case "export-customers":
      return { action: "export.customers" };
    case "export-vendors":
      return { action: "export.vendors" };
    default:
      return null;
  }
}
