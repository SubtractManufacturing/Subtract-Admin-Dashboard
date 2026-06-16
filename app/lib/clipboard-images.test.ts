import { describe, expect, it, vi } from "vitest";
import {
  defaultScreenshotFileName,
  extractImageFromClipboardEvent,
  isEditablePasteTarget,
} from "./clipboard-images";

function clipboardEventWithItems(items: Array<Partial<DataTransferItem>>) {
  return {
    clipboardData: {
      items,
    },
  } as unknown as ClipboardEvent;
}

describe("clipboard-images", () => {
  it("extracts the first image file from a paste event", () => {
    const screenshot = new File(["image"], "pasted.png", { type: "image/png" });
    const event = clipboardEventWithItems([
      { kind: "string", type: "text/plain", getAsFile: () => null },
      { kind: "file", type: "image/png", getAsFile: () => screenshot },
    ]);

    expect(extractImageFromClipboardEvent(event)).toBe(screenshot);
  });

  it("ignores non-image clipboard files", () => {
    const pdf = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
    const event = clipboardEventWithItems([
      { kind: "file", type: "application/pdf", getAsFile: () => pdf },
    ]);

    expect(extractImageFromClipboardEvent(event)).toBeNull();
  });

  it("treats form fields and contenteditable elements as editable paste targets", () => {
    expect(isEditablePasteTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditablePasteTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditablePasteTarget({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);

    const childOfEditable = {
      tagName: "SPAN",
      isContentEditable: false,
      closest: (selector: string) => selector === "[contenteditable='true']",
    } as unknown as EventTarget;

    expect(isEditablePasteTarget(childOfEditable)).toBe(true);
    expect(isEditablePasteTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
  });

  it("formats stable screenshot file names", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T20:06:07"));

    expect(defaultScreenshotFileName("jpeg")).toBe("screenshot-2026-06-15-200607.jpeg");
    expect(defaultScreenshotFileName()).toBe("screenshot-2026-06-15-200607.png");

    vi.useRealTimers();
  });
});
