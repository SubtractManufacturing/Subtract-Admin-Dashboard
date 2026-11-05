import type { ActionFunctionArgs } from "@remix-run/node";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildTwentyClient: vi.fn(),
  getTwentyCompanyChoice: vi.fn(),
  getCustomer: vi.fn(),
  getTwentySettings: vi.fn(),
  notifyTwentySync: vi.fn(),
  saveTwentyCompanyChoice: vi.fn(),
  withTwentySyncLock: vi.fn(),
}));

vi.mock("~/components/admin/TwentySettingsPanel", () => ({ default: () => null }));
vi.mock("~/lib/auth.server", () => ({
  requireAuth: async () => ({
    userDetails: { role: "Admin", email: "admin@example.com", id: "admin" },
    headers: new Headers(),
  }),
  withAuthHeaders: (response: Response) => response,
}));
vi.mock("~/lib/queue/producer.server", () => ({ sendTwentySyncJob: vi.fn() }));
vi.mock("~/lib/twenty/notify.server", () => ({ notifyTwentySync: mocks.notifyTwentySync }));
vi.mock("~/lib/twenty/settings.server", () => ({
  buildTwentyClient: mocks.buildTwentyClient,
  disableTwentySync: vi.fn(),
  enableTwentySync: vi.fn(),
  getTwentySettings: mocks.getTwentySettings,
  isTwentyApiKeyConfigured: vi.fn(),
  saveTwentyWorkspaceUrl: vi.fn(),
  testTwentyConnection: vi.fn(),
}));
vi.mock("~/lib/twenty/store.server", () => ({
  clearTwentyRetryDelay: vi.fn(),
  getTwentyCompanyChoice: mocks.getTwentyCompanyChoice,
  getTwentySyncOverview: vi.fn(),
  postgresTwentySyncStore: { getCustomer: mocks.getCustomer },
  saveTwentyCompanyChoice: mocks.saveTwentyCompanyChoice,
  withTwentySyncLock: mocks.withTwentySyncLock,
}));
vi.mock("~/lib/twenty/sync.server", () => ({ syncOneQuote: vi.fn() }));

import { action } from "~/routes/_protected.admin.twenty";

const customer = {
  id: 7,
  displayName: "Acme",
  companyName: "Acme",
  contactName: null,
  email: null,
};

async function chooseCompany(companyId: string) {
  const body = new FormData();
  body.set("intent", "chooseCompany");
  body.set("customerId", "7");
  body.set("companyId", companyId);
  const request = new Request("http://localhost/admin/twenty", { method: "POST", body });
  const response = (await action({ request } as ActionFunctionArgs)) as Response;
  return { status: response.status, data: await response.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCustomer.mockResolvedValue(customer);
  mocks.getTwentyCompanyChoice.mockResolvedValue(null);
  mocks.getTwentySettings.mockResolvedValue({
    enabled: true,
    workspaceUrl: "http://localhost:3000",
  });
  mocks.buildTwentyClient.mockReturnValue({
    listCompanies: async () => [{ id: "listed", name: "Acme", domain: null }],
  });
  mocks.withTwentySyncLock.mockImplementation(async (run: () => Promise<unknown>) => ({
    ran: true,
    value: await run(),
  }));
});

describe("chooseCompany", () => {
  it("saves a listed company and queues a sync", async () => {
    const { status, data } = await chooseCompany("listed");

    expect(status).toBe(200);
    expect(data.ok).toBe(true);
    expect(mocks.saveTwentyCompanyChoice).toHaveBeenCalledWith(7, "listed", expect.any(String));
    expect(mocks.notifyTwentySync).toHaveBeenCalled();
  });

  it("creates exactly one company when settling a match with Create new", async () => {
    const createCompany = vi.fn(async () => ({ id: "fresh" }));
    mocks.buildTwentyClient.mockReturnValue({ createCompany });
    mocks.getTwentyCompanyChoice.mockResolvedValue({
      kind: "company_choice",
      customerId: 7,
      companyName: "Acme",
      candidates: [],
    });

    const { data } = await chooseCompany("new");

    expect(data.ok).toBe(true);
    expect(createCompany).toHaveBeenCalledTimes(1);
    expect(createCompany).toHaveBeenCalledWith({ name: "Acme" });
    expect(mocks.saveTwentyCompanyChoice).toHaveBeenCalledWith(7, "fresh", expect.any(String));
  });

  it("refuses Create new when no match is being settled", async () => {
    const { status, data } = await chooseCompany("new");

    expect(status).toBe(400);
    expect(data.message).toBe("Choose one of the listed companies.");
  });

  it("returns a message instead of crashing when Twenty is down", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.buildTwentyClient.mockReturnValue({
      listCompanies: async () => {
        throw new Error("Could not reach Twenty");
      },
    });

    const { status, data } = await chooseCompany("listed");

    expect(status).toBe(400);
    expect(data).toEqual({
      ok: false,
      message: "Could not save the company. Check that Twenty is reachable, then try again.",
    });
    expect(mocks.saveTwentyCompanyChoice).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("rejects a company that is not listed", async () => {
    const { status, data } = await chooseCompany("someone-elses");

    expect(status).toBe(400);
    expect(data.message).toBe("Choose one of the listed companies.");
  });

  it("tells staff to wait while a sync is running", async () => {
    mocks.withTwentySyncLock.mockResolvedValue({ ran: false });

    const { data } = await chooseCompany("listed");

    expect(data.message).toContain("A sync is running");
  });
});
