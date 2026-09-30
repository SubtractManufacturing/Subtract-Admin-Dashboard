import { createHash } from "node:crypto";
import { PassThrough, Transform } from "node:stream";
import { finished } from "node:stream/promises";
import archiver from "archiver";

import { IntakeValidationError } from "./package";
import type { RfqStorage, StoredObject } from "./types";

type ArchiveIndexEntry = {
  key: string;
  size: number;
  contentType: string | null;
  lastModified: string | null;
  etag: string | null;
  sha256: string;
};

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

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
  // archiver uses the userland `readable-stream` implementation, while the AWS
  // multipart uploader only accepts a native Node Readable. Bridge the archive
  // through a native stream so the runtime type check in @aws-sdk/lib-storage
  // accepts it.
  const uploadBody = new PassThrough();
  zip.pipe(uploadBody);
  const upload = input.storage.uploadStream(
    input.destinationKey,
    uploadBody,
    "application/zip",
  );
  // The upload runs concurrently with archive construction and can reject
  // before we reach the final await. Mark it handled immediately; awaiting it
  // below still propagates the same rejection through this function.
  void upload.catch(() => undefined);
  const index: ArchiveIndexEntry[] = [];

  try {
    for (const object of sourceObjects) {
      const relativeKey = object.key.slice(input.prefix.length);
      if (
        !object.key.startsWith(input.prefix) ||
        !relativeKey ||
        relativeKey.includes("\\") ||
        relativeKey.split("/").some((segment) => segment === "." || segment === "..") ||
        hasControlCharacter(relativeKey)
      ) {
        throw new IntakeValidationError(
          `Unsafe object key in intake archive: ${object.key}`,
          "security",
        );
      }
      const current = await input.storage.head(object.key);
      if (!current) {
        throw new Error(`Object disappeared while archiving: ${object.key}`);
      }
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
      const after = await input.storage.head(object.key);
      if (
        !after ||
        streamedSize !== current.size ||
        after.size !== current.size ||
        (current.etag !== null && after.etag !== current.etag)
      ) {
        throw new Error(`Object changed while archiving: ${object.key}`);
      }
      index.push({
        key: object.key,
        size: current.size,
        contentType: current.contentType,
        lastModified: current.lastModified?.toISOString() ?? null,
        etag: current.etag,
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
    uploadBody.destroy();
    await upload.catch(() => undefined);
    throw error;
  }
}
