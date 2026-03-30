export type EmailSlotType = "plainText" | "markdown" | "button";
export type SlotEmptyBehavior = "hideBlock" | "renderEmpty" | "reject";

type BaseSlot<TType extends EmailSlotType> = {
  id: string;
  type: TType;
  required: boolean;
  emptyBehavior: SlotEmptyBehavior;
  adminLabel: string;
  adminHelpText?: string;
  placeholder?: string;
};

export type PlainTextSlot = BaseSlot<"plainText"> & { defaultValue?: string };
export type MarkdownSlot = BaseSlot<"markdown"> & { defaultValue?: string };
export type ButtonValue = { buttonLabel: string; link: string };
export type ButtonSlot = BaseSlot<"button"> & { defaultValue?: ButtonValue };
export type SlotDefinition = PlainTextSlot | MarkdownSlot | ButtonSlot;

export type EmailLayoutDefinition = {
  slots: readonly SlotDefinition[];
};

/** Placeholders {{key}} are validated only after interpolation at send time. */
function containsMergePlaceholder(s: string): boolean {
  return /\{\{\w+\}\}/.test(s);
}

export function validateHttpUrl(href: string): boolean {
  const t = href.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Button link policy: http(s) URL, empty, or merge placeholders (validated again after interpolation). */
export function validateButtonLinkPolicy(link: string): string | null {
  const t = link.trim();
  if (!t) return null;
  if (containsMergePlaceholder(t)) return null;
  if (!validateHttpUrl(t)) {
    return "Button link must start with http:// or https://";
  }
  return null;
}

export function validateButtonValue(
  value: unknown,
  options?: { allowLegacyString?: boolean; defaultLink?: string },
): { ok: true; value: ButtonValue } | { ok: false; error: string } {
  if (options?.allowLegacyString && typeof value === "string") {
    const label = value.trim();
    const link = (options.defaultLink ?? "").trim();
    if (!label && !link) {
      return { ok: true, value: { buttonLabel: "", link: "" } };
    }
    if (label.length > 0 !== link.length > 0) {
      return {
        ok: false,
        error:
          "Button label and link must both be filled or both empty.",
      };
    }
    const linkErr = validateButtonLinkPolicy(options.defaultLink ?? "");
    if (linkErr) {
      return { ok: false, error: linkErr };
    }
    return {
      ok: true,
      value: { buttonLabel: label, link: options.defaultLink ?? "" },
    };
  }

  if (!value || typeof value !== "object") {
    return { ok: false, error: "Button value must be an object" };
  }
  const { buttonLabel, link } = value as Record<string, unknown>;
  if (typeof buttonLabel !== "string" || typeof link !== "string") {
    return { ok: false, error: "buttonLabel and link must be strings" };
  }
  const label = buttonLabel.trim();
  const href = link.trim();
  if (label.length > 0 !== href.length > 0) {
    return {
      ok: false,
      error: "Button label and link must both be filled or both empty",
    };
  }
  const linkErr = validateButtonLinkPolicy(link);
  if (href && linkErr) {
    return { ok: false, error: linkErr };
  }
  return { ok: true, value: { buttonLabel, link } };
}

function slotFailsRequiredReject(
  slot: PlainTextSlot | MarkdownSlot,
  raw: unknown,
): boolean {
  return (
    slot.required &&
    slot.emptyBehavior === "reject" &&
    (typeof raw !== "string" || raw.trim().length === 0)
  );
}

function parseSlotValue(
  slot: SlotDefinition,
  raw: unknown,
  errors: Record<string, string>,
): unknown {
  if (slot.type === "plainText" || slot.type === "markdown") {
    if (raw === undefined || raw === null) {
      if (slotFailsRequiredReject(slot, "")) {
        errors[slot.id] = "This field is required.";
      }
      return "";
    }
    if (typeof raw !== "string") {
      errors[slot.id] = "Value must be a string.";
      return "";
    }
    if (slotFailsRequiredReject(slot, raw)) {
      errors[slot.id] = "This field is required.";
      return raw;
    }
    return raw;
  }

  const btnSlot = slot as ButtonSlot;
  const defaultLink =
    btnSlot.defaultValue?.link ??
    "";

  const rawBtn =
    raw === undefined || raw === null
      ? { buttonLabel: "", link: "" }
      : raw;
  const btn = validateButtonValue(rawBtn, {
    allowLegacyString: true,
    defaultLink: defaultLink,
  });
  if (!btn.ok) {
    errors[slot.id] = btn.error;
    return { buttonLabel: "", link: "" };
  }

  const label = btn.value.buttonLabel.trim();
  const href = btn.value.link.trim();

  if (btnSlot.required && btnSlot.emptyBehavior === "reject") {
    if (!label || !href) {
      errors[slot.id] = "This button slot is required.";
      return btn.value;
    }
  }

  if (href) {
    const linkErr = validateButtonLinkPolicy(btn.value.link);
    if (linkErr) {
      errors[slot.id] = linkErr;
    }
  }

  return btn.value;
}

export function getDefaultBodyCopyFromDefinition<TCopy extends Record<string, unknown>>(
  definition: EmailLayoutDefinition,
): TCopy {
  const out: Record<string, unknown> = {};
  for (const slot of definition.slots) {
    if (slot.type === "button") {
      out[slot.id] = {
        buttonLabel: slot.defaultValue?.buttonLabel ?? "",
        link: slot.defaultValue?.link ?? "",
      };
    } else {
      out[slot.id] = slot.defaultValue ?? "";
    }
  }
  return out as TCopy;
}

export function parseAndValidateBodyCopyForDefinition<TCopy extends Record<string, unknown>>(
  definition: EmailLayoutDefinition,
  raw: unknown,
): { ok: true; value: TCopy } | { ok: false; errors: Record<string, string> } {
  if (raw === null || raw === undefined) {
    return {
      ok: false,
      errors: { _root: "Body copy is required." },
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: { _root: "Body copy must be an object." } };
  }

  const obj = raw as Record<string, unknown>;
  const allowed = new Set(definition.slots.map((s) => s.id));
  const errors: Record<string, string> = {};

  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      errors[key] = `Unknown slot "${key}".`;
    }
  }

  const out: Record<string, unknown> = {};
  for (const slot of definition.slots) {
    out[slot.id] = parseSlotValue(slot, obj[slot.id], errors);
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: out as TCopy };
}

/** After merge interpolation: reject unresolved placeholders and non-http(s) links in button slots. */
export function validateInterpolatedButtonLinksInCopy(
  definition: EmailLayoutDefinition,
  copy: Record<string, unknown>,
): string | null {
  for (const slot of definition.slots) {
    if (slot.type !== "button") continue;
    const raw = copy[slot.id];
    if (!raw || typeof raw !== "object") continue;
    const link = String(
      (raw as { link?: unknown }).link ?? "",
    ).trim();
    if (!link) continue;
    if (/\{\{\w+\}\}/.test(link)) {
      return `Unresolved placeholder in button link (${slot.id})`;
    }
    if (!validateHttpUrl(link)) {
      return `Button link must start with http:// or https:// (${slot.id})`;
    }
  }
  return null;
}
