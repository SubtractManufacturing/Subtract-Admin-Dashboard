import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { finished } from "node:stream/promises";
import archiver from "archiver";

import type { RfqStorage, StoredObject } from "./types";

type ArchiveIndexEntry = {
  key: string;
  size: number;
  contentType: string | null;
  lastModified: string | null;
  etag: string | null;
  sha256: string;
};

async function listAll(storage: Pick<RfqStorage, "list">, prefix: string) {
  const objects: StoredObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.list(prefix, cursor);
    objects.push(...page.objects);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return objects.sort((a, b) => a.key.localeCompare(b.key));
}

export async function createRawIntakeArchive(input: {
  storage: RfqStorage;
  prefix: string;
  destinationKey: string;
}): Promise<StoredObject> {
  const sourceObjects = await listAll(input.storage, input.prefix);
  const zip = archiver("zip", { forceZip64: true, store: true });
  const upload = input.storage.uploadStream(
    input.destinationKey,
    zip,
    "application/zip",
  );
  const index: ArchiveIndexEntry[] = [];

  try {
    for (const object of sourceObjects) {
      const hash = createHash("sha256");
      let streamedSize = 0;
      const hasher = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          hash.update(chunk);
          streamedSize += chunk.length;
          callback(null, chunk);
        },
      });
      (await input.storage.read(object.key)).pipe(hasher);
      zip.append(hasher, { name: object.key });
      await finished(hasher);
      if (streamedSize !== object.size) {
        throw new Error(`Object changed while archiving: ${object.key}`);
      }
      index.push({
        key: object.key,
        size: object.size,
        contentType: object.contentType,
        lastModified: object.lastModified?.toISOString() ?? null,
        etag: object.etag,
        sha256: hash.digest("hex"),
      });
    }

    zip.append(JSON.stringify({ version: 1, objects: index }, null, 2), {
      name: "archive-index.json",
    });
    await zip.finalize();
    return await upload;
  } catch (error) {
    zip.abort();
    await upload.catch(() => undefined);
    throw error;
  }
}
