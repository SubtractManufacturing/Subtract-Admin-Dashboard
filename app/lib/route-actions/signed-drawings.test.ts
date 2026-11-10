import { describe, expect, it, vi } from "vitest";
import {
  DRAWING_URL_TTL_SECONDS,
  signDrawingAttachments,
  type StoredDrawingAttachment,
} from "./signed-drawings";

const att = (over: Partial<StoredDrawingAttachment> = {}): StoredDrawingAttachment => ({
  id: "a1",
  fileName: "dwg.pdf",
  contentType: "application/pdf",
  fileSize: 10,
  s3Key: "k/dwg.pdf",
  thumbnailS3Key: "k/dwg.pdf.thumb.png",
  ...over,
});

describe("signDrawingAttachments", () => {
  it("signs file and thumbnail", async () => {
    const sign = vi.fn(async (key: string) => `signed:${key}`);
    const out = await signDrawingAttachments([{ attachment: att() }], sign);
    expect(out).toEqual([
      {
        id: "a1",
        fileName: "dwg.pdf",
        contentType: "application/pdf",
        fileSize: 10,
        signedUrl: "signed:k/dwg.pdf",
        thumbnailSignedUrl: "signed:k/dwg.pdf.thumb.png",
      },
    ]);
    expect(sign).toHaveBeenCalledWith("k/dwg.pdf", DRAWING_URL_TTL_SECONDS);
  });

  it("skips records with no attachment (dangling link)", async () => {
    const out = await signDrawingAttachments(
      [{ attachment: null }, { attachment: att() }],
      async (k) => k,
    );
    expect(out).toHaveLength(1);
  });

  it("omits thumbnails that fail to sign but keeps the drawing", async () => {
    const sign = async (key: string) => {
      if (key.endsWith(".thumb.png")) throw new Error("no thumb");
      return `signed:${key}`;
    };
    const [d] = await signDrawingAttachments([{ attachment: att() }], sign);
    expect(d.signedUrl).toBe("signed:k/dwg.pdf");
    expect(d.thumbnailSignedUrl).toBeNull();
  });

  it("drops drawings whose file URL fails to sign", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const out = await signDrawingAttachments([{ attachment: att() }], async () => {
      throw new Error("s3 down");
    });
    expect(out).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("does not request a thumbnail when none is stored", async () => {
    const sign = vi.fn(async (k: string) => k);
    const [d] = await signDrawingAttachments(
      [{ attachment: att({ thumbnailS3Key: null }) }],
      sign,
    );
    expect(sign).toHaveBeenCalledTimes(1);
    expect(d.thumbnailSignedUrl).toBeNull();
  });
});
