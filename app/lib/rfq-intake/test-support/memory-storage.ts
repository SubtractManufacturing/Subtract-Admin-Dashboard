import { Readable } from "node:stream";

import type { RfqCanonicalStorage, RfqIntakeStorage, StoredObject } from "../types";

type MemoryObject = { body: Buffer; contentType: string };

function metadata(objects: Map<string, MemoryObject>, key: string): StoredObject | null {
  const object = objects.get(key);
  return object
    ? {
        key,
        size: object.body.length,
        contentType: object.contentType,
        etag: `etag-${key}`,
        lastModified: new Date("2026-09-20T12:00:00Z"),
      }
    : null;
}

/**
 * In-memory stand-in for the two buckets. `objects` is the intake bucket and
 * `canonicalObjects` is the application bucket, so tests catch files written to
 * or read from the wrong side. Methods are looked up at call time through
 * `buckets`, which lets tests override a single method on the instance.
 */
export class MemoryStorage {
  readonly objects = new Map<string, MemoryObject>();
  readonly canonicalObjects = new Map<string, MemoryObject>();

  /** Seeds the intake bucket. */
  put(key: string, value: unknown, contentType = "application/json") {
    const body = Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
    this.objects.set(key, { body, contentType });
  }

  async list(prefix: string) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => metadata(this.objects, key)!),
      nextCursor: null,
    };
  }

  async head(key: string) {
    return metadata(this.objects, key);
  }

  async read(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Missing ${key}`);
    return Readable.from(object.body);
  }

  async readJson(key: string) {
    const object = this.objects.get(key);
    if (!object) throw new Error(`Missing ${key}`);
    return JSON.parse(object.body.toString("utf8"));
  }

  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }

  async canonicalHead(key: string) {
    return metadata(this.canonicalObjects, key);
  }

  async uploadStream(key: string, body: Readable, contentType: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    this.canonicalObjects.set(key, { body: Buffer.concat(chunks), contentType });
    return metadata(this.canonicalObjects, key)!;
  }

  async copyFromIntake(intakeKey: string, canonicalKey: string) {
    const source = this.objects.get(intakeKey);
    if (!source) throw new Error(`Missing ${intakeKey}`);
    this.canonicalObjects.set(canonicalKey, { ...source, body: Buffer.from(source.body) });
  }

  get buckets(): { intake: RfqIntakeStorage; canonical: RfqCanonicalStorage } {
    return {
      intake: {
        list: (prefix) => this.list(prefix),
        head: (key) => this.head(key),
        read: (key) => this.read(key),
        readJson: (key) => this.readJson(key),
        deletePrefix: (prefix) => this.deletePrefix(prefix),
      },
      canonical: {
        head: (key) => this.canonicalHead(key),
        uploadStream: (key, body, contentType) => this.uploadStream(key, body, contentType),
        copyFromIntake: (intakeKey, canonicalKey) =>
          this.copyFromIntake(intakeKey, canonicalKey),
      },
    };
  }
}
