import { Readable } from "node:stream";

import type { RfqStorage, StoredObject } from "../types";

/** In-memory RfqStorage for integration tests that exercise real Postgres. */
export class MemoryRfqStorage implements RfqStorage {
  objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, value: unknown, contentType = "application/json") {
    this.objects.set(key, {
      body: Buffer.from(
        typeof value === "string" ? value : JSON.stringify(value),
      ),
      contentType,
    });
  }
  metadata(key: string): StoredObject | null {
    const value = this.objects.get(key);
    return value
      ? {
          key,
          size: value.body.length,
          contentType: value.contentType,
          etag: "test",
          lastModified: new Date(),
        }
      : null;
  }
  async list(prefix: string) {
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((key) => this.metadata(key)!),
      nextCursor: null,
    };
  }
  async head(key: string) {
    return this.metadata(key);
  }
  async read(key: string) {
    return Readable.from(this.objects.get(key)!.body);
  }
  async readJson(key: string) {
    return JSON.parse(this.objects.get(key)!.body.toString("utf8"));
  }
  async copy(source: string, destination: string) {
    const value = this.objects.get(source)!;
    this.objects.set(destination, { ...value, body: Buffer.from(value.body) });
  }
  async uploadStream(key: string, body: Readable, contentType: string) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    this.objects.set(key, { body: Buffer.concat(chunks), contentType });
    return this.metadata(key)!;
  }
  async deletePrefix(prefix: string) {
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) this.objects.delete(key);
    }
  }
}
