import { describe, expect, it, vi } from "vitest";
import { buildQuotePartView, type PartViewPorts, type PartViewSource } from "./part-view";

const part: PartViewSource = {
  id: "qp-1",
  specifications: null,
  partFileUrl: "https://bucket.s3/quote-parts/qp-1/source/a.step",
  partMeshUrl: "quote-parts/qp-1/mesh.glb",
  conversionStatus: "completed",
  thumbnailUrl: "quote-parts/qp-1/thumbnails/t.png",
};

function ports(over: Partial<PartViewPorts> = {}): PartViewPorts {
  return {
    preview: () => ({
      cadKey: "quote-parts/qp-1/source/a.step",
      meshKey: "quote-parts/qp-1/mesh.glb",
      effectiveConversionStatus: "completed",
    }),
    usesPlaceholderCad: () => false,
    meshUrl: vi.fn(async () => ({ url: "https://signed/mesh" })),
    sign: vi.fn(async (key: string) => `signed:${key}`),
    extractKey: (v) => v.replace("https://bucket.s3/", ""),
    drawingRecords: vi.fn(async () => []),
    ...over,
  };
}

describe("buildQuotePartView", () => {
  it("signs the source file, mesh and thumbnail for an uploaded part", async () => {
    const view = await buildQuotePartView(part, ports());
    expect(view).toMatchObject({
      id: "qp-1",
      signedMeshUrl: "https://signed/mesh",
      signedFileUrl: "signed:quote-parts/qp-1/source/a.step",
      signedThumbnailUrl: "signed:quote-parts/qp-1/thumbnails/t.png",
      usesPlaceholderCad: false,
      drawings: [],
    });
  });

  it("skips the mesh until conversion has completed", async () => {
    const p = ports({
      preview: () => ({ cadKey: null, meshKey: "m", effectiveConversionStatus: "skipped" }),
    });
    const view = await buildQuotePartView(part, p);
    expect(view.signedMeshUrl).toBeUndefined();
    expect(p.meshUrl).not.toHaveBeenCalled();
  });

  it("skips the mesh when no mesh key exists", async () => {
    const p = ports({
      preview: () => ({ cadKey: null, meshKey: null, effectiveConversionStatus: "completed" }),
    });
    await buildQuotePartView(part, p);
    expect(p.meshUrl).not.toHaveBeenCalled();
  });

  it("ignores a mesh lookup that reports an error", async () => {
    const view = await buildQuotePartView(
      part,
      ports({ meshUrl: vi.fn(async () => ({ error: "not ready" })) }),
    );
    expect(view.signedMeshUrl).toBeUndefined();
  });

  it("previews the Settings placeholder CAD for placeholder parts", async () => {
    const view = await buildQuotePartView(
      { ...part, specifications: { usesPlaceholderCad: true } },
      ports({
        usesPlaceholderCad: () => true,
        preview: () => ({
          cadKey: "settings/placeholder.step",
          meshKey: "settings/placeholder.glb",
          effectiveConversionStatus: "completed",
        }),
      }),
    );
    expect(view.signedFileUrl).toBe("signed:settings/placeholder.step");
    expect(view.usesPlaceholderCad).toBe(true);
  });

  it("falls back to the part's own file when the placeholder is not ready", async () => {
    const view = await buildQuotePartView(
      part,
      ports({
        usesPlaceholderCad: () => true,
        preview: () => ({ cadKey: null, meshKey: null, effectiveConversionStatus: "skipped" }),
      }),
    );
    expect(view.signedFileUrl).toBe("signed:quote-parts/qp-1/source/a.step");
  });

  it("has no file URL when the part has no file", async () => {
    const view = await buildQuotePartView({ ...part, partFileUrl: null }, ports());
    expect(view.signedFileUrl).toBeUndefined();
  });

  it("survives signing failures, logging each", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = await buildQuotePartView(
      part,
      ports({ sign: vi.fn(async () => { throw new Error("s3 down"); }) }),
    );
    expect(view.signedFileUrl).toBeUndefined();
    expect(view.signedThumbnailUrl).toBeUndefined();
    expect(view.signedMeshUrl).toBe("https://signed/mesh");
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it("attaches signed drawings", async () => {
    const view = await buildQuotePartView(
      part,
      ports({
        drawingRecords: async () => [
          {
            attachment: {
              id: "d1",
              fileName: "dwg.pdf",
              contentType: "application/pdf",
              fileSize: 5,
              s3Key: "k/dwg.pdf",
              thumbnailS3Key: null,
            },
          },
        ],
      }),
    );
    expect(view.drawings).toEqual([
      {
        id: "d1",
        fileName: "dwg.pdf",
        contentType: "application/pdf",
        fileSize: 5,
        signedUrl: "signed:k/dwg.pdf",
        thumbnailSignedUrl: null,
      },
    ]);
  });
});
