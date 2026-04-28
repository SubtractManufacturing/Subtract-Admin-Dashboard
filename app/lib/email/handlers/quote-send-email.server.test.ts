import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoist mocks ─────────────────────────────────────────────────────────────

const { mockDbSelect } = vi.hoisted(() => ({
  mockDbSelect: vi.fn(),
}));

vi.mock("~/lib/db", () => ({
  db: {
    select: mockDbSelect,
  },
}));

vi.mock("~/lib/quotes", () => ({
  getQuote: vi.fn(),
  updateQuote: vi.fn(),
}));

vi.mock("~/lib/customers", () => ({
  getCustomer: vi.fn(),
}));

vi.mock("~/lib/quotes.server", () => ({
  validateQuoteCanBeSent: vi.fn(() => Promise.resolve({ success: true })),
  ensureQuoteStripePaymentLink: vi.fn(() => Promise.resolve({ success: true })),
  transitionQuoteToSent: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock("~/lib/email/resolve/quote.server", () => ({
  resolveQuoteTokens: vi.fn(() => Promise.resolve({})),
}));

vi.mock("~/lib/events", () => ({
  createEvent: vi.fn(() => Promise.resolve()),
}));

const { mockResolveEmailTemplateForContext } = vi.hoisted(() => ({
  mockResolveEmailTemplateForContext: vi.fn(),
}));

vi.mock("~/lib/email/templates.server", () => ({
  resolveEmailTemplateForContext: mockResolveEmailTemplateForContext,
}));

// Import after mocks
import { quoteSendEmailHandler } from "./quote-send-email.server";
import type { EmailEnqueueAuth } from "./quote-send-email.server";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ENTITY_ID = "42";
const ATTACHMENT_ID_PDF = "attach-pdf-1";
const ATTACHMENT_ID_OTHER = "attach-other-1";

const mockAuth: EmailEnqueueAuth = {
  user: {
    id: "user-1",
    email: "sender@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: new Date().toISOString(),
  } as EmailEnqueueAuth["user"],
  userDetails: {
    id: "user-1",
    email: "sender@example.com",
    name: "Sender",
    role: "Admin",
  },
};

/** Returns a drizzle-style chainable that resolves to `rows`. */
function makeDbChain(rows: unknown[]) {
  const p = Promise.resolve(rows);
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => p),
    then: p.then.bind(p),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return chain;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const templateWithKinds = (kinds: string[]) => ({
  template: {
    requiredAttachmentDocumentKinds: kinds,
  },
  identity: {} as { id: number },
  layoutSlug: "styled-quote" as const,
});

describe("quoteSendEmailHandler.verifyAttachmentIds — quote PDF requirement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveEmailTemplateForContext.mockResolvedValue(
      templateWithKinds(["quote"]),
    );
  });

  it("throws when no attachment IDs are provided and template requires quote", async () => {
    await expect(
      quoteSendEmailHandler.verifyAttachmentIds(mockAuth, ENTITY_ID, []),
    ).rejects.toThrow(/requires at least one attachment/i);
  });

  it("throws when no selected attachment has documentKind 'quote' but template requires it", async () => {
    mockDbSelect.mockReturnValue(
      makeDbChain([
        { id: ATTACHMENT_ID_OTHER, documentKind: "invoice" },
      ]),
    );

    await expect(
      quoteSendEmailHandler.verifyAttachmentIds(mockAuth, ENTITY_ID, [
        ATTACHMENT_ID_OTHER,
      ]),
    ).rejects.toThrow(/requires a quote PDF attachment/i);
  });

  it("throws when the attachment list length does not match (invalid attachment)", async () => {
    // DB returns fewer rows than requested = some IDs don't belong to this quote
    mockDbSelect.mockReturnValue(makeDbChain([]));

    await expect(
      quoteSendEmailHandler.verifyAttachmentIds(mockAuth, ENTITY_ID, [
        ATTACHMENT_ID_PDF,
      ]),
    ).rejects.toThrow(/invalid attachment selection/i);
  });

  it("succeeds when at least one attachment has documentKind 'quote'", async () => {
    mockDbSelect.mockReturnValue(
      makeDbChain([
        { id: ATTACHMENT_ID_PDF, documentKind: "quote" },
      ]),
    );

    await expect(
      quoteSendEmailHandler.verifyAttachmentIds(mockAuth, ENTITY_ID, [
        ATTACHMENT_ID_PDF,
      ]),
    ).resolves.toBeUndefined();
  });

  it("succeeds with mixed attachments when at least one is a quote PDF", async () => {
    mockDbSelect.mockReturnValue(
      makeDbChain([
        { id: ATTACHMENT_ID_PDF, documentKind: "quote" },
        { id: ATTACHMENT_ID_OTHER, documentKind: null },
      ]),
    );

    await expect(
      quoteSendEmailHandler.verifyAttachmentIds(mockAuth, ENTITY_ID, [
        ATTACHMENT_ID_PDF,
        ATTACHMENT_ID_OTHER,
      ]),
    ).resolves.toBeUndefined();
  });

  it("succeeds with no attachments when template requires none", async () => {
    mockResolveEmailTemplateForContext.mockResolvedValue(
      templateWithKinds([]),
    );
    await expect(
      quoteSendEmailHandler.verifyAttachmentIds(mockAuth, ENTITY_ID, []),
    ).resolves.toBeUndefined();
    expect(mockDbSelect).not.toHaveBeenCalled();
  });

  it("requires each configured kind", async () => {
    mockResolveEmailTemplateForContext.mockResolvedValue(
      templateWithKinds(["quote", "invoice"]),
    );
    mockDbSelect.mockReturnValue(
      makeDbChain([{ id: ATTACHMENT_ID_PDF, documentKind: "quote" }]),
    );
    await expect(
      quoteSendEmailHandler.verifyAttachmentIds(mockAuth, ENTITY_ID, [
        ATTACHMENT_ID_PDF,
      ]),
    ).rejects.toThrow(/Invoice/i);
  });
});

describe("quoteSendEmailHandler.prepareEmailContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls ensureQuoteStripePaymentLink with quote id and auth context", async () => {
    const { ensureQuoteStripePaymentLink } = await import("~/lib/quotes.server");
    await quoteSendEmailHandler.prepareEmailContent!(mockAuth, ENTITY_ID);
    expect(ensureQuoteStripePaymentLink).toHaveBeenCalledWith(42, {
      userId: "user-1",
      userEmail: "sender@example.com",
    });
  });

  it("throws when ensureQuoteStripePaymentLink fails", async () => {
    const { ensureQuoteStripePaymentLink } = await import("~/lib/quotes.server");
    vi.mocked(ensureQuoteStripePaymentLink).mockResolvedValueOnce({
      success: false,
      error: "Quote total must be greater than $0",
    });
    await expect(
      quoteSendEmailHandler.prepareEmailContent!(mockAuth, ENTITY_ID),
    ).rejects.toThrow(/Quote total must be greater than \$0/);
  });
});
