import { describe, expect, it, vi } from "vitest";
import {
  NOT_READY,
  loadSendComposer,
  type SendComposerPorts,
} from "./send-composer";

const interpolate = (t: string, vars: Record<string, string>) =>
  t.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");

function ports(over: Partial<SendComposerPorts> = {}): SendComposerPorts {
  return {
    resolveTemplate: vi.fn(async () => ({
      layoutSlug: "quote",
      template: {
        subjectTemplate: "{{companyName}}: quote {{quoteNumber}} for {{customerName}} ({{userName}})",
        bodyCopy: { intro: "Hello", cta: "Pay now", footer: "" },
        requiredAttachmentDocumentKinds: ["quote"] as const,
      },
    })) as unknown as SendComposerPorts["resolveTemplate"],
    mergeFields: vi.fn(async () => ({ companyName: "Subtract" })),
    interpolate,
    layoutSlots: () => [
      { id: "intro", type: "markdown", adminLabel: "Intro", allowPerSendEdit: true },
      { id: "cta", type: "button", adminLabel: "CTA", allowPerSendEdit: true },
      { id: "footer", type: "plainText", adminLabel: "Footer", allowPerSendEdit: false },
      { id: "closing", type: "plainText", adminLabel: "Closing", allowPerSendEdit: true },
    ],
    parseBodyCopy: (_slug, raw) => ({ ok: true, data: raw }),
    ...over,
  };
}

const input = {
  contextKey: "quote_send" as never,
  actorMerge: { userName: "Ann" },
  subjectVars: { quoteNumber: "Q-1", customerName: "Acme" },
};

describe("loadSendComposer", () => {
  it("is not ready when no template resolves", async () => {
    const state = await loadSendComposer(
      ports({ resolveTemplate: vi.fn(async () => null) }),
      input,
    );
    expect(state).toEqual(NOT_READY);
  });

  it("builds the subject from merge fields, actor and entity variables", async () => {
    const state = await loadSendComposer(ports(), input);
    expect(state.ready).toBe(true);
    expect(state.defaultSubject).toBe("Subtract: quote Q-1 for Acme (Ann)");
    expect(state.requiredAttachmentDocumentKinds).toEqual(["quote"]);
  });

  it("lets entity variables win over merge fields", async () => {
    const state = await loadSendComposer(
      ports({ mergeFields: vi.fn(async () => ({ quoteNumber: "stale" })) }),
      input,
    );
    expect(state.defaultSubject).toContain("quote Q-1");
  });

  it("exposes only slots editable per send, excluding buttons", async () => {
    const state = await loadSendComposer(ports(), input);
    expect(state.editableSlots).toEqual([
      { id: "intro", type: "markdown", adminLabel: "Intro", templateValue: "Hello" },
      { id: "closing", type: "plainText", adminLabel: "Closing", templateValue: "" },
    ]);
  });

  it("stays ready with no editable slots when the body copy is invalid", async () => {
    const state = await loadSendComposer(
      ports({ parseBodyCopy: () => ({ ok: false }) }),
      input,
    );
    expect(state.ready).toBe(true);
    expect(state.editableSlots).toEqual([]);
    expect(state.defaultSubject).not.toBeNull();
  });

  it("defaults required attachment kinds to none", async () => {
    const state = await loadSendComposer(
      ports({
        resolveTemplate: vi.fn(async () => ({
          layoutSlug: "quote",
          template: { subjectTemplate: "s", requiredAttachmentDocumentKinds: null },
        })),
      }),
      input,
    );
    expect(state.requiredAttachmentDocumentKinds).toEqual([]);
  });
});
