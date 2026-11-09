import {
  json,
  MaxPartSizeExceededError,
  unstable_createMemoryUploadHandler,
  unstable_parseMultipartFormData,
} from "@remix-run/node";
import { MAX_UPLOAD_BYTES } from "./core";

export type ParsedForm =
  | { ok: true; formData: FormData; multipart: boolean }
  | { ok: false; response: Response };

/**
 * Read a detail-route POST body. Multipart bodies are buffered in memory with a
 * per-file cap; an oversized file becomes a 400 rather than an unhandled error.
 */
export async function readFormData(request: Request): Promise<ParsedForm> {
  const multipart = !!request.headers.get("content-type")?.includes("multipart/form-data");
  if (!multipart) {
    return { ok: true, formData: await request.formData(), multipart };
  }

  try {
    const formData = await unstable_parseMultipartFormData(
      request,
      unstable_createMemoryUploadHandler({ maxPartSize: MAX_UPLOAD_BYTES }),
    );
    return { ok: true, formData, multipart };
  } catch (error) {
    if (error instanceof MaxPartSizeExceededError) {
      return {
        ok: false,
        response: json({ error: "File size exceeds 10MB limit" }, { status: 400 }),
      };
    }
    throw error;
  }
}
