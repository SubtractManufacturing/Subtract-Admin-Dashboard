const MAX_HOURS = 100_000;

/**
 * Parses admin input for outbound email list max age: plain hours, or with
 * suffix `d` (days), `w` (weeks), or `h` (hours). Examples: 96, 4d, 1w, 12h.
 */
export function parseOutboundListMaxAgeHoursInput(raw: string):
  | { ok: true; hours: number }
  | { ok: false; error: string } {
  const s = raw.trim().toLowerCase();
  if (s === "") {
    return { ok: true, hours: 0 };
  }

  const m = /^(\d+)\s*(w|d|h)?$/i.exec(s);
  if (!m) {
    return {
      ok: false,
      error:
        "Enter hours (e.g. 96), or use d for days or w for weeks (e.g. 4d, 1w).",
    };
  }

  const n = parseInt(m[1]!, 10);
  const suffix = (m[2] ?? "").toLowerCase();

  let hours: number;
  if (suffix === "w") {
    hours = n * 168;
  } else if (suffix === "d") {
    hours = n * 24;
  } else {
    hours = n;
  }

  if (hours < 0 || hours > MAX_HOURS) {
    return {
      ok: false,
      error: `Must be between 0 and ${MAX_HOURS} hours after conversion (0 = no limit).`,
    };
  }

  return { ok: true, hours };
}
