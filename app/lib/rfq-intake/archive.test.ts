import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { createRawIntakeArchive } from "./archive";
import type { RfqStorage, StoredObject } from "./types";

describe("RFQ raw intake archive", () => {
  it("finalizes an archive made from asynchronously delivered object streams", async () => {
    const source = new Map([
      ["intake/session/meta/manifest.json", Buffer.from('{"parts":[]}')],
      ["intake/session/parts/example.step", Buffer.from("STEP")],
    ]);
    const uploaded = new Map<string, Buffer>();
    const metadata = (key: string, body: Buffer): StoredObject => ({
      key,
      size: body.length,
      contentType: "application/octet-stream",
      etag: `etag-${key}`,
      lastModified: new Date("2026-09-22T00:00:00Z"),
    });
    const storage: RfqStorage = {
      async list(prefix) {
        return {
          objects: [...source]
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, body]) => metadata(key, body)),
          nextCursor: null,
        };
      },
      async head(key) {
        const body = source.get(key) ?? uploaded.get(key);
        return body ? metadata(key, body) : null;
      },
      async read(key) {
        const body = source.get(key);
        if (!body) throw new Error(`Missing ${key}`);
        return Readable.from(
          (async function* () {
            await new Promise<void>((resolve) => setImmediate(resolve));
            yield body;
          })(),
        );
      },
      async readJson() {
        throw new Error("Not used");
      },
      async copy() {
        throw new Error("Not used");
      },
      async uploadStream(key, body) {
        expect(body).toBeInstanceOf(Readable);
        const chunks: Buffer[] = [];
        for await (const chunk of body) chunks.push(Buffer.from(chunk));
        const value = Buffer.concat(chunks);
        uploaded.set(key, value);
        return metadata(key, value);
      },
      async deletePrefix() {
        throw new Error("Not used");
      },
    };

    const result = await Promise.race([
      createRawIntakeArchive({
        storage,
        prefix: "intake/session/",
        destinationKey: "archives/test.zip",
      }),
      new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), 500),
      ),
    ]);

    expect(result).not.toBe("timeout");
    expect(uploaded.get("archives/test.zip")?.toString("latin1")).toContain(
      "archive-index.json",
    );
  });
});
