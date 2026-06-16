type PasteTarget = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
};

export const PASTED_IMAGE_SIZE_ERROR = "File size exceeds 10MB limit";

export function extractImageFromClipboardEvent(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of Array.from(items)) {
    if (!item.type.startsWith("image/")) continue;

    const file = item.getAsFile();
    if (file) return file;
  }

  return null;
}

export function isEditablePasteTarget(target: EventTarget | null): boolean {
  if (!target) return false;

  const element = target as PasteTarget;
  const tagName = element.tagName?.toUpperCase();

  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  if (element.isContentEditable) return true;

  return Boolean(
    element.closest?.("[contenteditable]") ||
      element.closest?.("[contenteditable='true']") ||
      element.closest?.("[contenteditable='plaintext-only']")
  );
}

export function getClipboardImageExtension(mimeType: string | undefined): string {
  const subtype = mimeType?.trim().toLowerCase().match(/^image\/([^;]+)/)?.[1];
  if (!subtype) return "png";

  return subtype.split("+")[0].replace(/[^a-z0-9]/g, "") || "png";
}

export function getPastedImageError(file: File, maxSizeBytes: number): string | null {
  return file.size > maxSizeBytes ? PASTED_IMAGE_SIZE_ERROR : null;
}

export function defaultScreenshotFileName(extension = "png"): string {
  const now = new Date();
  const safeExtension = extension.replace(/^\./, "") || "png";
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  const time = [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");

  return `screenshot-${timestamp}-${time}.${safeExtension}`;
}
