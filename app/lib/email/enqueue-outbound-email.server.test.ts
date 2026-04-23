import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDefaultBodyCopyForLayout } from "~/emails/registry";

// ---------------------------------------------------------------------------
// Hoist mutable fn references so vi.mock factories can close over them.
// ---------------------------------------------------------------------------

const {
  mockResolveTemplate,
  mockGetSettings,
  mockGetMergeFields,
  mockSendEmailJob,
  mockRenderEmailTemplate,
  mockBuildMergeProps,
  mockGetEmailSendHandler,
} = vi.hoisted(() => {
  const mockBuildMergeProps = vi.fn(() => Promise.resolve({}));
  const mockHandler = {
    assertCanSend: vi.fn(() => Promise.resolve()),
    verifyAttachmentIds: vi.fn(() => Promise.resolve()),
    getRecipientEmail: vi.fn(() => Promise.resolve("customer@example.com")),
    buildMergeProps: mockBuildMergeProps,
  };
  return {
    mockResolveTemplate: vi.fn(),
    mockGetSettings: vi.fn(),
    mockGetMergeFields: vi.fn(),
    mockSendEmailJob: vi.fn(() => Promise.resolve()),
    mockRenderEmailTemplate: vi.fn(),
    mockBuildMergeProps,
    mockGetEmailSendHandler: vi.fn(() => mockHandler),
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("~/lib/email/templates.server", () => ({
  resolveEmailTemplateForContext: mockResolveTemplate,
  getEmailSettings: mockGetSettings,
  getEmailMergeFieldsMap: mockGetMergeFields,
}));

vi.mock("~/lib/email/email-send-context-registry.server", () => ({
  getEmailSendHandler: mockGetEmailSendHandler,
}));

vi.mock("~/lib/queue/producer.server", () => ({
  sendEmailJob: mockSendEmailJob,
}));

vi.mock("~/emails/render.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/emails/render.server")>();
  return {
    ...original,
    renderEmailTemplate: mockRenderEmailTemplate,
  };
});

// DB mock: make .select() return a chainable object that resolves to [] by
// default, supporting .from().where().limit() as well as direct await.
// The transaction mock executes the callback with a minimal tx stub.
vi.mock("~/lib/db", () => {
  function makeChain(result: unknown[]): Record<string, unknown> {
    const p = Promise.resolve(result);
    const chain: Record<string, unknown> = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      limit: vi.fn(() => p),
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    };
    return chain;
  }

  const mockTx = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(() => Promise.resolve([{ id: 42 }])),
      })),
    })),
  };

  return {
    db: {
      // First call: entity throttle → [] (not busy).
      // Second call: user count throttle → [{ c: 0 }] (under limit).
      select: vi
        .fn()
        .mockReturnValueOnce(makeChain([]))
        .mockReturnValueOnce(makeChain([{ c: 0 }]))
        .mockReturnValue(makeChain([])),
      transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx)),
    },
  };
});

// Import the function under test AFTER all mocks are in place.
import { enqueueOutboundUserEmail } from "./enqueue-outbound-email.server";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

const baseInput = {
  auth: {
    user: { id: "user-1", email: "sender@example.com", name: "Sender" },
  },
  contextKey: "quote_send" as const,
  entityType: "quote" as const,
  entityId: "1",
  subject: "Your quote",
  cc: "",
  attachmentIds: [] as string[],
  idempotencyKey: VALID_UUID,
};

const mockIdentity = {
  id: 1,
  fromEmail: "noreply@example.com",
  fromDisplayName: "Subtract",
  replyToEmail: null,
  isDefault: true,
  isArchived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: null,
};

const mockTemplateBase = {
  id: 1,
  slug: "quote-send-default",
  name: "Quote Send Default",
  contextKey: "quote_send",
  emailIdentityId: 1,
  subjectTemplate: "Your quote",
  isArchived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  updatedBy: null,
};

beforeEach(() => {
  mockGetSettings.mockResolvedValue({
    outboundDelayMinutes: "0",
    recipientOverride: "",
  });
  mockGetMergeFields.mockResolvedValue({});
  mockBuildMergeProps.mockResolvedValue({});
  mockRenderEmailTemplate.mockResolvedValue({
    html: "<p>Hello</p>",
    text: "Hello",
  });
});

// ---------------------------------------------------------------------------
// Early input validation (no DB / handler needed)
// ---------------------------------------------------------------------------

describe("enqueueOutboundUserEmail — input validation", () => {
  it("returns 400 for a missing idempotency key", async () => {
    const result = await enqueueOutboundUserEmail({ ...baseInput, idempotencyKey: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("idempotency");
    }
  });

  it("returns 400 for an invalid idempotency key format", async () => {
    const result = await enqueueOutboundUserEmail({ ...baseInput, idempotencyKey: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 for an invalid entity type", async () => {
    const result = await enqueueOutboundUserEmail({
      ...baseInput,
      entityType: "widget" as "quote",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("returns 400 for an empty subject", async () => {
    const result = await enqueueOutboundUserEmail({ ...baseInput, subject: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("subject");
    }
  });

  it("returns 400 for a newline-injected subject", async () => {
    const result = await enqueueOutboundUserEmail({
      ...baseInput,
      subject: "Safe subject\r\nBcc: evil@example.com",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Invalid stored body copy fails before rendering
// ---------------------------------------------------------------------------

describe("enqueueOutboundUserEmail — invalid stored body copy", () => {
  it("returns 400 with a 'template body is invalid' message", async () => {
    // bodyCopy has a required slot ('headline' in example-kitchen-sink requiredReject)
    // but we use quote-send layout where the schema expects strings — provide a non-string value
    // for a slot that expects a string so parseBodyCopyForLayout fails.
    mockResolveTemplate.mockResolvedValue({
      template: {
        ...mockTemplateBase,
        layoutSlug: "quote-send",
        // greeting expects a string; supply a number to force a parse error
        bodyCopy: { greeting: 42 },
      },
      identity: mockIdentity,
      layoutSlug: "quote-send" as const,
    });

    const result = await enqueueOutboundUserEmail(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("template body is invalid");
    }
  });
});

// ---------------------------------------------------------------------------
// Unresolved placeholders fail send
// ---------------------------------------------------------------------------

describe("enqueueOutboundUserEmail — unresolved placeholders", () => {
  it("returns 400 naming the missing tokens when merge map is incomplete", async () => {
    const defaults = getDefaultBodyCopyForLayout("quote-send");
    // Default bodyCopy references {{customerName}}, {{quoteNumber}}, etc.
    // Supply an empty merge map so those tokens are unresolved.
    mockResolveTemplate.mockResolvedValue({
      template: {
        ...mockTemplateBase,
        layoutSlug: "quote-send",
        bodyCopy: defaults,
      },
      identity: mockIdentity,
      layoutSlug: "quote-send" as const,
    });
    mockGetMergeFields.mockResolvedValue({});
    mockBuildMergeProps.mockResolvedValue({});

    const result = await enqueueOutboundUserEmail(baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      // The error message names the token(s)
      expect(result.error).toMatch(/\{\{[^}]+\}\}/);
    }
  });

  it("returns 400 when a token referenced in the subject is missing", async () => {
    mockResolveTemplate.mockResolvedValue({
      template: {
        ...mockTemplateBase,
        layoutSlug: "quote-send",
        // Use a bodyCopy with no placeholders so only the subject fails
        bodyCopy: {
          greeting: "Hello",
          intro: "Body text.",
          totalLabel: "Total:",
          payNowButton: { buttonLabel: "", link: "" },
          signOff: "Regards",
          signature: "",
          footer: "Footer",
        },
      },
      identity: mockIdentity,
      layoutSlug: "quote-send" as const,
    });
    mockGetMergeFields.mockResolvedValue({});
    mockBuildMergeProps.mockResolvedValue({});

    const result = await enqueueOutboundUserEmail({
      ...baseInput,
      subject: "Quote {{quoteNumber}} — ready for review",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("{{quoteNumber}}");
    }
  });
});

// ---------------------------------------------------------------------------
// Valid data — renders HTML and plain text, stores and enqueues
// ---------------------------------------------------------------------------

describe("enqueueOutboundUserEmail — valid send", () => {
  it("returns ok:true when template, identity, and merge map are all valid", async () => {
    mockResolveTemplate.mockResolvedValue({
      template: {
        ...mockTemplateBase,
        layoutSlug: "quote-send",
        bodyCopy: {
          greeting: "Hi Acme Corp,",
          intro: "Your quote 26Q00001 is attached.",
          totalLabel: "Total:",
          payNowButton: { buttonLabel: "", link: "" },
          signOff: "Best regards",
          signature: "Subtract Manufacturing",
          footer: "You received this email because you submitted an RFQ.",
        },
      },
      identity: mockIdentity,
      layoutSlug: "quote-send" as const,
    });
    // Merge map has no unresolved placeholders (bodyCopy has no {{tokens}})
    mockGetMergeFields.mockResolvedValue({});
    mockBuildMergeProps.mockResolvedValue({});

    const result = await enqueueOutboundUserEmail(baseInput);
    expect(result.ok).toBe(true);
    expect(mockRenderEmailTemplate).toHaveBeenCalledOnce();
    expect(mockSendEmailJob).toHaveBeenCalledOnce();
  });
});
