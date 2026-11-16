import { describe, expect, it, vi } from "vitest";
import {
  collectDrawingFiles,
  sanitizeUploadFileName,
  uploadDrawings,
  type DrawingFile,
  type DrawingUploadPorts,
} from "./drawing-uploads";

function file(name: string, type: string, body = "data"): DrawingFile {
  const bytes = new TextEncoder().encode(body);
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
  };
}

/** In-memory adapters for storage, thumbnails and attachment records. */
function memoryPorts(opts: { thumbnailFails?: boolean } = {}) {
  const objects = new Map<string, { contentType: string; size: number }>();
  const records: Array<Record<string, unknown> & { id: string }> = [];
  const ports: DrawingUploadPorts = {
    storage: {
      async upload({ key, buffer, contentType }) {
        objects.set(key, { contentType, size: buffer.byteLength });
        return { key };
      },
    },
    thumbnails: {
      isPdf: (type, name) => type === "application/pdf" || name.toLowerCase().endsWith(".pdf"),
      async fromPdf() {
        if (opts.thumbnailFails) throw new Error("mupdf failed");
        return Buffer.from("png");
      },
    },
    attachments: {
      async create(input) {
        const record = { id: `att-${records.length + 1}`, ...input };
        records.push(record);
        return { id: record.id };
      },
    },
  };
  return { ports, objects, records };
}

describe("sanitizeUploadFileName", () => {
  it("dashes whitespace and strips unsafe characters", () => {
    expect(sanitizeUploadFileName("my drawing (v2).pdf")).toBe("my-drawing-v2.pdf");
    expect(sanitizeUploadFileName("a/b\\c:d.pdf")).toBe("abcd.pdf");
  });
});

describe("collectDrawingFiles", () => {
  it("keeps form positions and skips empty or missing slots", () => {
    const fd = new FormData();
    fd.set("drawingCount", "4");
    fd.set("drawing_0", new File(["a"], "a.pdf"));
    fd.set("drawing_1", new File([], "empty.pdf"));
    fd.set("drawing_3", new File(["c"], "c.pdf"));
    const found = collectDrawingFiles(fd);
    expect(found.map((d) => [d.index, d.file.name])).toEqual([
      [0, "a.pdf"],
      [3, "c.pdf"],
    ]);
  });

  it("returns nothing without a count", () => {
    expect(collectDrawingFiles(new FormData())).toEqual([]);
  });
});

describe("uploadDrawings", () => {
  const baseInput = (link: (id: string) => Promise<void>) => ({
    keyPrefix: "parts/p1/drawings",
    now: () => 1000,
    link,
  });

  it("stores, thumbnails PDFs, records and links each drawing", async () => {
    const { ports, objects, records } = memoryPorts();
    const link = vi.fn(async () => {});

    const ids = await uploadDrawings(ports, {
      ...baseInput(link),
      drawings: [
        { file: file("part 1.pdf", "application/pdf"), index: 0 },
        { file: file("sketch.png", "image/png"), index: 2 },
      ],
    });

    expect(ids).toEqual(["att-1", "att-2"]);
    expect([...objects.keys()].sort()).toEqual([
      "parts/p1/drawings/1000-0-part-1.pdf",
      "parts/p1/drawings/1000-0-part-1.pdf.thumb.png",
      "parts/p1/drawings/1000-2-sketch.png",
    ]);
    expect(objects.get("parts/p1/drawings/1000-0-part-1.pdf.thumb.png")?.contentType).toBe(
      "image/png",
    );
    expect(records[0]).toMatchObject({
      s3Key: "parts/p1/drawings/1000-0-part-1.pdf",
      fileName: "part 1.pdf",
      contentType: "application/pdf",
      thumbnailS3Key: "parts/p1/drawings/1000-0-part-1.pdf.thumb.png",
      source: "user_upload",
    });
    expect(records[1]).toMatchObject({ thumbnailS3Key: null, contentType: "image/png" });
    expect(link.mock.calls).toEqual([["att-1"], ["att-2"]]);
  });

  it("still uploads and links when the thumbnail fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ports, objects, records } = memoryPorts({ thumbnailFails: true });
    const link = vi.fn(async () => {});

    await uploadDrawings(ports, {
      ...baseInput(link),
      drawings: [{ file: file("a.pdf", "application/pdf"), index: 0 }],
    });

    expect(objects.size).toBe(1);
    expect(records[0].thumbnailS3Key).toBeNull();
    expect(link).toHaveBeenCalledWith("att-1");
    spy.mockRestore();
  });

  it("applies the index offset and content type rule", async () => {
    const { ports, objects, records } = memoryPorts();

    await uploadDrawings(ports, {
      ...baseInput(async () => {}),
      drawings: [{ file: file("extra.dwg", ""), index: 0 }],
      indexOffset: 1,
      contentTypeFor: () => "application/acad",
    });

    expect([...objects.keys()]).toEqual(["parts/p1/drawings/1000-1-extra.dwg"]);
    expect(records[0]).toMatchObject({ contentType: "application/acad", source: "user_upload" });
  });

  it("falls back to PDF when the browser reports no type", async () => {
    const { ports, records } = memoryPorts();
    await uploadDrawings(ports, {
      ...baseInput(async () => {}),
      drawings: [{ file: file("noext", ""), index: 0 }],
    });
    expect(records[0].contentType).toBe("application/pdf");
  });

  it("stops at the first failing link and does not swallow the error", async () => {
    const { ports, records } = memoryPorts();
    const link = vi.fn(async () => {
      throw new Error("fk violation");
    });
    await expect(
      uploadDrawings(ports, {
        ...baseInput(link),
        drawings: [
          { file: file("a.png", "image/png"), index: 0 },
          { file: file("b.png", "image/png"), index: 1 },
        ],
      }),
    ).rejects.toThrow("fk violation");
    expect(records).toHaveLength(1);
  });
});
