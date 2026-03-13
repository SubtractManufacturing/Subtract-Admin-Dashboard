import { createHash } from "node:crypto";

const HIBP_API_BASE = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 4000;

export interface PwnedPasswordResult {
  checked: boolean;
  isPwned: boolean;
  pwnedCount: number;
  warning?: string;
}

function getSha1HexUppercase(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex").toUpperCase();
}

export async function checkPasswordAgainstHibp(
  normalizedPassword: string
): Promise<PwnedPasswordResult> {
  if (!normalizedPassword) {
    return { checked: false, isPwned: false, pwnedCount: 0 };
  }

  const fullHash = getSha1HexUppercase(normalizedPassword);
  const prefix = fullHash.slice(0, 5);
  const suffix = fullHash.slice(5);

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), HIBP_TIMEOUT_MS);

  try {
    const response = await fetch(`${HIBP_API_BASE}${prefix}`, {
      method: "GET",
      headers: {
        "Add-Padding": "true",
      },
      signal: abortController.signal,
    });

    if (!response.ok) {
      return {
        checked: false,
        isPwned: false,
        pwnedCount: 0,
        warning: "Unable to verify breached-password status right now.",
      };
    }

    const body = await response.text();
    const lines = body.split("\n");
    for (const line of lines) {
      const [lineSuffix, rawCount] = line.trim().split(":");
      if (lineSuffix === suffix) {
        const count = Number.parseInt(rawCount ?? "0", 10) || 0;
        return {
          checked: true,
          isPwned: count > 0,
          pwnedCount: count,
        };
      }
    }

    return { checked: true, isPwned: false, pwnedCount: 0 };
  } catch {
    return {
      checked: false,
      isPwned: false,
      pwnedCount: 0,
      warning: "Unable to verify breached-password status right now.",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
