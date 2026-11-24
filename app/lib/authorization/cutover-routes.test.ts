/**
 * The cutover status page and review list (ADR-0014) are Admin and Dev only,
 * through `authorize()`. A User-role or external actor is refused before any
 * cutover code runs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Actor } from "~/lib/authorization/authorize";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  runCheck: vi.fn(),
  runSync: vi.fn(),
  getLastSync: vi.fn(),
  getCutoverStage: vi.fn(),
  loadReviewRows: vi.fn(),
  saveReview: vi.fn(),
  clearReview: vi.fn(),
}));

vi.mock("~/lib/auth.server", () => ({
  requireAuth: mocks.requireAuth,
  withAuthHeaders: (response: Response) => response,
}));
vi.mock("~/lib/organizations/check.server", () => ({ runCheck: mocks.runCheck }));
vi.mock("~/lib/organizations/sync.server", () => ({
  runSync: mocks.runSync,
  getLastSync: mocks.getLastSync,
  SyncError: class SyncError extends Error {},
}));
vi.mock("~/lib/organizations/stage.server", () => ({
  getCutoverStage: mocks.getCutoverStage,
  STAGE_LABELS: { shadow: "Shadow", switch: "Switch", unlocked: "Unlocked" },
}));
vi.mock("~/lib/organizations/review.server", () => ({
  loadReviewRows: mocks.loadReviewRows,
  reviewProgress: () => ({ total: 0, reviewed: 0, flagged: 0, flaggedUnreviewed: 0 }),
  saveReview: mocks.saveReview,
  clearReview: mocks.clearReview,
  ReviewError: class ReviewError extends Error {},
}));

import * as status from "~/routes/_protected.cutover._index";
import * as review from "~/routes/_protected.cutover.review";

const staff = (role: "User" | "Admin" | "Dev"): Actor => ({
  kind: "staff",
  userId: `user-${role}`,
  email: `${role.toLowerCase()}@example.invalid`,
  name: null,
  role,
});
const external: Actor = { kind: "external", userId: "ext" };

function signIn(actor: Actor) {
  mocks.requireAuth.mockResolvedValue({ actor, headers: new Headers() });
}

type Handler = (args: { request: Request; params: object; context: object }) => Promise<Response>;

async function call(handler: unknown, request: Request): Promise<Response> {
  try {
    return await (handler as Handler)({ request, params: {}, context: {} });
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    throw thrown;
  }
}

function post(path: string, fields: Record<string, string>) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    body: new URLSearchParams(fields),
  });
}

const saveFields = {
  intent: "save",
  type: "customer",
  id: "1",
  seen: JSON.stringify({ displayName: "Pat", companyName: null, contactName: null }),
  changes: JSON.stringify({ companyName: "Example Co" }),
};

/** Every new loader and action, with a request that would do something if allowed. */
const HANDLERS: Array<[string, () => Promise<Response>]> = [
  ["status page loader", () => call(status.loader, new Request("http://localhost/cutover"))],
  ["Sync action", () => call(status.action, post("/cutover", { intent: "sync" }))],
  ["status page action with an unknown intent", () => call(status.action, post("/cutover", { intent: "other" }))],
  ["review list loader", () => call(review.loader, new Request("http://localhost/cutover/review"))],
  ["review save action", () => call(review.action, post("/cutover/review", saveFields))],
  ["review undo action", () => call(review.action, post("/cutover/review", { intent: "clear", type: "vendor", id: "2" }))],
  ["review action with an unknown intent", () => call(review.action, post("/cutover/review", { intent: "other", type: "customer", id: "1" }))],
];

const cutoverCode = () => [
  mocks.runCheck,
  mocks.runSync,
  mocks.getLastSync,
  mocks.getCutoverStage,
  mocks.loadReviewRows,
  mocks.saveReview,
  mocks.clearReview,
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.runCheck.mockResolvedValue({
    checkedAt: new Date(),
    total: 0,
    fixable: 0,
    notFixable: 0,
    byArea: [],
    differences: [],
    counts: {},
  });
  mocks.getLastSync.mockResolvedValue(null);
  mocks.getCutoverStage.mockResolvedValue({ stage: "shadow", changedAt: new Date(), changedBy: null });
  mocks.loadReviewRows.mockResolvedValue([]);
  mocks.runSync.mockResolvedValue({ applied: 0, appliedByArea: [], notFixable: 0 });
  mocks.saveReview.mockResolvedValue({ changedFields: ["companyName"], row: {} });
});

describe("cutover routes", () => {
  it.each(HANDLERS)("%s refuses the User role", async (_name, run) => {
    signIn(staff("User"));
    expect((await run()).status).toBe(403);
    for (const mock of cutoverCode()) expect(mock).not.toHaveBeenCalled();
  });

  it.each(HANDLERS)("%s refuses an external actor", async (_name, run) => {
    signIn(external);
    expect((await run()).status).toBe(403);
    for (const mock of cutoverCode()) expect(mock).not.toHaveBeenCalled();
  });

  it.each(["Admin", "Dev"] as const)("lets %s view, Sync and review", async (role) => {
    signIn(staff(role));
    expect((await call(status.loader, new Request("http://localhost/cutover"))).status).toBe(200);
    expect((await call(review.loader, new Request("http://localhost/cutover/review"))).status).toBe(200);

    expect((await call(status.action, post("/cutover", { intent: "sync" }))).status).toBe(200);
    expect(mocks.runSync).toHaveBeenCalledWith({
      userId: `user-${role}`,
      email: `${role.toLowerCase()}@example.invalid`,
    });

    expect((await call(review.action, post("/cutover/review", saveFields))).status).toBe(200);
    expect(mocks.saveReview).toHaveBeenCalledWith(
      {
        type: "customer",
        id: 1,
        seen: { displayName: "Pat", companyName: null, contactName: null },
        changes: { companyName: "Example Co" },
      },
      { userId: `user-${role}`, email: `${role.toLowerCase()}@example.invalid` },
    );
  });

  it("runs nothing for an unknown intent, even as Admin", async () => {
    signIn(staff("Admin"));
    expect((await call(status.action, post("/cutover", { intent: "other" }))).status).toBe(400);
    expect((await call(review.action, post("/cutover/review", { intent: "other", type: "customer", id: "1" }))).status).toBe(400);
    expect(mocks.runSync).not.toHaveBeenCalled();
    expect(mocks.saveReview).not.toHaveBeenCalled();
    expect(mocks.clearReview).not.toHaveBeenCalled();
  });

  it("refuses a review save it cannot read", async () => {
    signIn(staff("Admin"));
    for (const fields of [
      { ...saveFields, id: "abc" },
      { ...saveFields, type: "organization" },
      { ...saveFields, seen: "not json" },
      { ...saveFields, seen: JSON.stringify({ displayName: "Pat" }) },
      { ...saveFields, changes: JSON.stringify({ displayName: null }) },
      { ...saveFields, changes: JSON.stringify(["companyName"]) },
    ]) {
      expect((await call(review.action, post("/cutover/review", fields))).status).toBe(400);
    }
    expect(mocks.saveReview).not.toHaveBeenCalled();
  });
});
