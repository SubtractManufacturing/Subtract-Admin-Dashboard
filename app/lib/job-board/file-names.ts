/** Leading segments added at upload time, e.g. `1773942319843-26b6dd0f1694d361-`. */
const STORAGE_BASENAME_PREFIX = /^\d+-[a-zA-Z0-9]+-/;

function storageBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  return segments.pop() ?? filePath;
}

export function stripStorageBasenamePrefix(basename: string): string {
  let name = basename;
  while (STORAGE_BASENAME_PREFIX.test(name)) {
    name = name.replace(STORAGE_BASENAME_PREFIX, "");
  }
  return name || basename;
}

function looksLikePrefixedStorageBasename(name: string): boolean {
  return STORAGE_BASENAME_PREFIX.test(storageBasename(name));
}

/**
 * Discord upload filename: prefer a clean display name; otherwise derive from the S3 key basename.
 */
export function jobBoardDiscordFileName(
  s3Key: string,
  preferredFileName?: string | null,
): string {
  const preferred = preferredFileName?.trim();
  if (preferred && !looksLikePrefixedStorageBasename(preferred)) {
    return storageBasename(preferred);
  }

  const fromKey = stripStorageBasenamePrefix(storageBasename(s3Key));
  if (fromKey) return fromKey;

  return preferred
    ? storageBasename(preferred)
    : storageBasename(s3Key);
}
