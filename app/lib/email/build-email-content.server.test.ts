import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";

const {
  mockResolveTemplate,
  mockGetMergeFields,
  mockRenderEmailTemplate,
  mockPrepareEmailContent,
  mockBuildMergeProps,
  mockGetEmailSendHandler,
} = vi.hoisted(() => {
  const mockPrepareEmailContent = vi.fn(() => Promise.resolve());
  const mockBuildMergeProps = vi.fn(() => Promise.resolve({}));
  const mockHandler = {
    prepareEmailContent: mockPrepareEmailContent,
    buildMergeProps: mockBuildMergeProps,
  };
  return {
    mockResolveTemplate: vi.fn(),
    mockGetMergeFields: vi.fn(),
    mockRenderEmailTemplate: vi.fn(),
    mockPrepareEmailContent,
    mockBuildMergeProps,
    mockGetEmailSendHandler: vi.fn(() => mockHandler),
  };
});

vi.mock("~/lib/email/templates.server", () => ({
  resolveEmailTemplateForContext: mockResolveTemplate,
  getEmailMergeFieldsMap: mockGetMergeFields,
}));

vi.mock("~/lib/email/email-send-context-registry.server", () => ({
  getEmailSendHandler: mockGetEmailSendHandler,
}));

vi.mock("~/lib/email/resolve/actor-merge.server", () => ({
  resolveActorMergeTokens: vi.fn(() => ({})),
}));

vi.mock("~/emails/render.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("~/emails/render.server")>();
  return {
    ...original,
    renderEmailTemplate: mockRenderEmailTemplate,
  };
});

import { buildEmailContent } from "./build-email-content.server";

const mockIdentity = {
  id: 1,
  fromEmail: "noreply@example.com",
  fromDisplayName: "Subtract",
  replyToEmail: null as string | null,
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMergeFields.mockResolvedValue({});
  mockBuildMergeProps.mockResolvedValue({});
  mockRenderEmailTemplate.mockResolvedValue({
    html: "<p>Hello</p>",
    text: "Hello",
  });
  mockResolveTemplate.mockResolvedValue({
    template: {
      ...mockTemplateBase,
      layoutSlug: "styled-quote",
      bodyCopy: {
        intro: "Hi, your quote is attached.",
        cta: { buttonLabel: "", link: "" },
        wrapUp: "Best regards",
        footerNotice: "Footer.",
      },
    },
    identity: mockIdentity,
    layoutSlug: "styled-quote" as const,
  });
});

describe("buildEmailContent — simple-markdown HtmlBody", () => {
  beforeEach(() => {
    mockRenderEmailTemplate.mockResolvedValue({
      html: '<div data-react-email-render="junk"><p><strong>ignored</strong></p></div>',
      text: 'Hello\n\na < literal angle bracket line',
    });
    mockResolveTemplate.mockResolvedValue({
      template: {
        ...mockTemplateBase,
        layoutSlug: "simple-markdown",
        bodyCopy: {
          body: "Hi.",
        },
      },
      identity: mockIdentity,
      layoutSlug: "simple-markdown" as const,
    });
  });

  it("wraps interpolated plain-text MIME as minimal HTML instead of Markdown HTML", async () => {
    const result = await buildEmailContent({
      auth: mockAuth,
      contextKey: "quote_send",
      entityId: "99",
      subject: "Subject",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.htmlBody).not.toContain("data-react-email-render");
    expect(result.htmlBody).not.toContain("<strong>");
    expect(result.htmlBody).not.toContain("<p>");
    expect(result.htmlBody).toContain("&lt;");
    expect(result.htmlBody).toContain("white-space:pre-wrap");
    expect(result.textBody).toContain("a < literal");
  });
});

describe("buildEmailContent — prepareEmailContent", () => {
  it("runs prepareEmailContent before buildMergeProps", async () => {
    const result = await buildEmailContent({
      auth: mockAuth,
      contextKey: "quote_send",
      entityId: "99",
      subject: "Your quote",
    });
    expect(result.ok).toBe(true);
    expect(mockPrepareEmailContent).toHaveBeenCalledOnce();
    expect(mockPrepareEmailContent).toHaveBeenCalledWith(mockAuth, "99");
    expect(mockBuildMergeProps).toHaveBeenCalledOnce();
    expect(mockPrepareEmailContent.mock.invocationCallOrder[0]).toBeLessThan(
      mockBuildMergeProps.mock.invocationCallOrder[0],
    );
  });

  it("returns 400 when prepareEmailContent throws", async () => {
    mockPrepareEmailContent.mockRejectedValueOnce(
      new Error("Stripe is not configured"),
    );
    const result = await buildEmailContent({
      auth: mockAuth,
      contextKey: "quote_send",
      entityId: "99",
      subject: "Your quote",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("Stripe is not configured");
    }
    expect(mockBuildMergeProps).not.toHaveBeenCalled();
  });
});
