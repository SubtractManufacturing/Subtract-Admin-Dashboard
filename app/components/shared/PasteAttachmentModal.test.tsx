// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasteAttachmentModal } from "./PasteAttachmentModal";

function renderModal(overrides: Partial<Parameters<typeof PasteAttachmentModal>[0]> = {}) {
  const props: Parameters<typeof PasteAttachmentModal>[0] = {
    isOpen: true,
    file: new File(["image"], "clipboard.png", { type: "image/png" }),
    initialFileName: "screenshot.png",
    isUploading: false,
    onClose: vi.fn(),
    onUpload: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<PasteAttachmentModal {...props} />),
    props,
  };
}

describe("PasteAttachmentModal", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:preview-url"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("submits the trimmed pasted image file name", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    renderModal({ initialFileName: "  pasted-image.png  ", onUpload });

    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(onUpload).toHaveBeenCalledWith("pasted-image.png");
  });

  it("disables upload while a validation error is shown", async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    renderModal({
      error: "File size exceeds 10MB limit",
      isUploadDisabled: true,
      onUpload,
    });

    expect(screen.getByText("File size exceeds 10MB limit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upload" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Upload" }));

    expect(onUpload).not.toHaveBeenCalled();
  });

  it("revokes the pasted image preview URL on unmount", () => {
    const { unmount } = renderModal();

    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(screen.getByAltText("Pasted attachment preview")).toHaveAttribute(
      "src",
      "blob:preview-url"
    );

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-url");
  });
});
