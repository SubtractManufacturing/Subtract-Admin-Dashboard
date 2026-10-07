/** Largest object a single S3 CopyObject request can copy. */
export const MAX_SERVER_SIDE_COPY_BYTES = 5 * 1024 * 1024 * 1024;

export type S3Identity = {
  endpoint?: string;
  region: string;
  accessKeyId: string;
};

export type CopyStrategy = "server_side" | "stream";

function normalizeEndpoint(endpoint: string | undefined): string {
  return (endpoint ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

/**
 * Two buckets can use a server-side copy only when one set of credentials on one
 * endpoint can read the source and write the destination. Matching endpoint,
 * region, and access key is the conservative signal for that; anything else is
 * treated as a different provider or account.
 */
export function sharesStorageAccount(a: S3Identity, b: S3Identity): boolean {
  return (
    normalizeEndpoint(a.endpoint) === normalizeEndpoint(b.endpoint) &&
    a.region === b.region &&
    a.accessKeyId !== "" &&
    a.accessKeyId === b.accessKeyId
  );
}

export function chooseCopyStrategy(input: {
  sameAccount: boolean;
  sizeBytes: number;
}): CopyStrategy {
  return input.sameAccount && input.sizeBytes <= MAX_SERVER_SIDE_COPY_BYTES
    ? "server_side"
    : "stream";
}
