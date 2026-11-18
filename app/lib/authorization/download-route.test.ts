import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "~/lib/authorization/authorize";

const mocks = vi.hoisted(() => ({
  requireStaff: vi.fn(),
  getAttachment: vi.fn(),
  getPartMeshUrl: vi.fn(),
  downloadFromS3: vi.fn(),
  getCustomersByIds: vi.fn(),
  getOriginalFilename: vi.fn(),
  createEvent: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({ requireStaff: mocks.requireStaff }));
vi.mock("~/lib/s3.server", () => ({ downloadFromS3: mocks.downloadFromS3 }));
vi.mock("~/lib/attachments", () => ({ getAttachment: mocks.getAttachment }));
vi.mock("~/lib/parts", () => ({
  getPartWithAttachments: vi.fn(),
  getPartMeshUrl: mocks.getPartMeshUrl,
}));
vi.mock("~/lib/quoteParts", () => ({ getQuotePartWithAttachments: vi.fn() }));
vi.mock("~/lib/file-download.server", () => ({
  getOriginalFilename: mocks.getOriginalFilename,
}));
vi.mock("~/lib/downloadQuoteFiles", () => ({ downloadQuoteFiles: vi.fn() }));
vi.mock("~/lib/customers", () => ({ getCustomersByIds: mocks.getCustomersByIds }));
vi.mock("~/lib/vendors", () => ({ getVendorsByIds: vi.fn() }));
vi.mock("~/lib/events", () => ({ createEvent: mocks.createEvent }));

import { loader } from "~/routes/_protected.download.$";

const staff = (role: "User" | "Admin" | "Dev"): Actor => ({
  kind: "staff",
  userId: "u1",
  email: "u1@example.com",
  name: null,
  role,
});
const external: Actor = { kind: "external", userId: "ext" };

function signIn(actor: Actor) {
  mocks.requireStaff.mockResolvedValue({
    actor,
    user: { id: actor.userId, email: "u1@example.com" },
    userDetails: { role: actor.kind === "staff" ? actor.role : undefined, name: null },
  });
}

async function call(path: string, query = "") {
  const request = new Request(`http://localhost/download/${path}${query}`);
  try {
    return await loader({
      request,
      params: { "*": path },
      context: {},
    } as Parameters<typeof loader>[0]);
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getAttachment.mockResolvedValue({
    s3Key: "k",
    fileName: "f.step",
    contentType: "application/octet-stream",
  });
  mocks.getOriginalFilename.mockResolvedValue("f.step");
  mocks.downloadFromS3.mockResolvedValue(Buffer.from("data"));
  mocks.getPartMeshUrl.mockResolvedValue({ url: "https://example.com/m.glb" });
});

describe("/download/* authorization", () => {
  it("rejects an external actor before touching any resource", async () => {
    signIn(external);
    for (const path of [
      "attachment/1",
      "part/1",
      "quote-part/1",
      "quote/1",
      "mesh/1",
    ]) {
      const response = await call(path);
      expect(response.status, path).toBe(403);
    }
    expect(mocks.getAttachment).not.toHaveBeenCalled();
    expect(mocks.getPartMeshUrl).not.toHaveBeenCalled();
    expect(mocks.downloadFromS3).not.toHaveBeenCalled();
  });

  it("rejects an external actor on bulk export", async () => {
    signIn(external);
    const response = await call("export-customers", "?ids=1&format=csv");
    expect(response.status).toBe(403);
    expect(mocks.getCustomersByIds).not.toHaveBeenCalled();
  });

  it("lets staff download an attachment", async () => {
    signIn(staff("User"));
    const response = await call("attachment/1");
    expect(response.status).toBe(200);
    expect(mocks.getAttachment).toHaveBeenCalledWith("1");
  });

  it("lets staff fetch a mesh url", async () => {
    signIn(staff("User"));
    const response = await call("mesh/1");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ url: "https://example.com/m.glb" });
  });

  it("forbids User-role staff from bulk export without looking anything up", async () => {
    signIn(staff("User"));
    const response = await call("export-vendors", "?ids=1&format=csv");
    expect(response.status).toBe(403);
    expect(mocks.getCustomersByIds).not.toHaveBeenCalled();
  });

  it("lets Admin staff download the export template", async () => {
    signIn(staff("Admin"));
    const response = await call("export-customers", "?ids=template&format=csv");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv");
  });

  it("answers 403 for an external actor before the missing-id 400", async () => {
    signIn(external);
    expect((await call("attachment/")).status).toBe(403);
  });

  it("gates a trailing path on an export type", async () => {
    signIn(staff("User"));
    expect((await call("export-customers/x", "?ids=template&format=csv")).status).toBe(403);
  });

  it("forbids User staff from the export template", async () => {
    signIn(staff("User"));
    expect((await call("export-customers", "?ids=template&format=csv")).status).toBe(403);
  });

  it("lets Admin export customers and answers 404 when none match", async () => {
    signIn(staff("Admin"));
    mocks.getCustomersByIds.mockResolvedValue([]);
    expect((await call("export-customers", "?ids=1&format=csv")).status).toBe(404);
    expect(mocks.getCustomersByIds).toHaveBeenCalledWith([1]);
  });

  it("does not match download types case-insensitively", async () => {
    signIn(staff("Dev"));
    const response = await call("Attachment/1");
    expect(response.status).toBe(400);
    expect(mocks.getAttachment).not.toHaveBeenCalled();
  });

  it("still answers 400 for an unknown download type", async () => {
    signIn(staff("Dev"));
    const response = await call("passwd/1");
    expect(response.status).toBe(400);
  });

  it("denies when the staff gate itself rejects", async () => {
    mocks.requireStaff.mockRejectedValue(new Response(null, { status: 302 }));
    const response = await call("attachment/1");
    expect(response.status).toBe(302);
    expect(mocks.getAttachment).not.toHaveBeenCalled();
  });
});
