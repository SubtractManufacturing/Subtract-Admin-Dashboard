import { describe, expect, it, vi } from "vitest";

import { createTwentyClient, normalizeWorkspaceUrl, TwentyApiError } from "./client.server";

const API_KEY = "secret-key-value";

function clientReturning(response: Response | Error) {
  const fetcher = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const client = createTwentyClient({
    baseUrl: "https://api.twenty.com",
    apiKey: API_KEY,
    fetcher: fetcher as unknown as typeof fetch,
    minIntervalMs: 0,
  });
  return { client, fetcher };
}

const failure = (client: ReturnType<typeof clientReturning>["client"]) =>
  client.findPersonByEmail("a@b.com").catch((error: TwentyApiError) => error);

describe("normalizeWorkspaceUrl", () => {
  it("sends cloud workspace URLs to the API host", () => {
    expect(normalizeWorkspaceUrl("https://subtract.twenty.com/objects/people")).toEqual({
      ok: true,
      url: "https://api.twenty.com",
    });
  });

  it("allows plain http only for a local instance", () => {
    expect(normalizeWorkspaceUrl("http://localhost:3000/settings")).toEqual({
      ok: true,
      url: "http://localhost:3000",
    });
    expect(normalizeWorkspaceUrl("ftp://localhost:9090").ok).toBe(false);
  });

  it("keeps self-hosted origins and refuses plain http", () => {
    expect(normalizeWorkspaceUrl("https://crm.example.com/settings")).toEqual({
      ok: true,
      url: "https://crm.example.com",
    });
    expect(normalizeWorkspaceUrl("http://crm.example.com").ok).toBe(false);
    expect(normalizeWorkspaceUrl("not a url").ok).toBe(false);
  });
});

describe("createTwentyClient", () => {
  it("authenticates, refuses redirects and quotes filter values", async () => {
    const { client, fetcher } = clientReturning(
      Response.json({ data: { people: [{ id: "p1" }] } }),
    );

    await expect(client.findPersonByEmail('a"b@c.com')).resolves.toEqual({ id: "p1" });

    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/rest/people");
    expect(url.searchParams.get("filter")).toBe(
      'emails.primaryEmail[eq]:"a\\"b@c.com"',
    );
    expect(init.redirect).toBe("manual");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${API_KEY}`,
    );
  });

  it("removes the key from error text", async () => {
    const { client } = clientReturning(
      new Response(`bad token ${API_KEY}`, { status: 401 }),
    );
    const error = await failure(client);
    expect(error).toBeInstanceOf(TwentyApiError);
    expect((error as TwentyApiError).message).not.toContain(API_KEY);
    expect((error as TwentyApiError).transient).toBe(false);
  });

  it("treats outages and rate limits as transient", async () => {
    for (const response of [
      new Response("", { status: 503 }),
      new Response("", { status: 429 }),
      new TypeError("fetch failed"),
    ]) {
      const error = await failure(clientReturning(response).client);
      expect((error as TwentyApiError).transient).toBe(true);
    }
  });

  it("checks relations by name, as Twenty refuses their join columns", async () => {
    const urls: string[] = [];
    const client = createTwentyClient({
      baseUrl: "https://api.twenty.com",
      apiKey: API_KEY,
      minIntervalMs: 0,
      fetcher: (async (url: URL) => {
        urls.push(url.searchParams.get("fields") ?? "");
        return Response.json({ data: {} });
      }) as unknown as typeof fetch,
    });

    await client.checkConnection();

    expect(urls.join(",")).not.toMatch(/companyId|pointOfContactId/);
    expect(urls.join(",")).toContain("rfqStatus");
  });

  it.each([
    [{ isUnique: true }, true],
    [{ isUnique: false }, false],
  ])("reads whether erpQuoteId is unique: %j", async (flags, expected) => {
    const client = createTwentyClient({
      baseUrl: "https://api.twenty.com",
      apiKey: API_KEY,
      minIntervalMs: 0,
      fetcher: (async (url: URL) =>
        Response.json(
          url.pathname === "/rest/metadata/objects"
            ? { data: [{ id: "opp", nameSingular: "opportunity" }] }
            : { fields: [{ name: "erpQuoteId", ...flags }] },
        )) as unknown as typeof fetch,
    });

    await expect(client.isErpQuoteFieldUnique()).resolves.toBe(expected);
  });

  it("reports unknown uniqueness when metadata is not readable", async () => {
    const { client } = clientReturning(new Response("", { status: 403 }));
    await expect(client.isErpQuoteFieldUnique()).resolves.toBeNull();
  });

  it("reports when an update landed on a record in the trash", async () => {
    const { client } = clientReturning(
      Response.json({
        data: { updateOpportunity: { id: "o", deletedAt: "2026-11-03T00:00:00.000Z" } },
      }),
    );

    await expect(client.updateOpportunity("o", { name: "x" })).resolves.toEqual({
      deletedAt: "2026-11-03T00:00:00.000Z",
    });
  });

  it("restores through the GraphQL mutation Twenty's UI uses", async () => {
    const { client, fetcher } = clientReturning(Response.json({ data: {} }));

    await client.restoreOpportunity("o");

    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe("/graphql");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).variables).toEqual({ id: "o" });
  });

  it("treats a GraphQL error as a failed restore, with the key removed", async () => {
    const { client } = clientReturning(
      Response.json({ errors: [{ message: `denied ${API_KEY}` }] }),
    );

    const error = await client.restoreOpportunity("o").catch((caught: TwentyApiError) => caught);

    expect(error).toBeInstanceOf(TwentyApiError);
    expect((error as TwentyApiError).message).not.toContain(API_KEY);
  });

  it("follows pagination across all companies", async () => {
    const pages = [
      {
        data: {
          companies: [
            {
              id: "1",
              name: "One",
              domainName: { primaryLinkUrl: "https://www.one.com/about" },
            },
          ],
        },
        pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
      },
      {
        data: { companies: [{ id: "2", name: "Two", domainName: null }] },
        pageInfo: { hasNextPage: false },
      },
    ];
    const urls: URL[] = [];
    const client = createTwentyClient({
      baseUrl: "https://api.twenty.com",
      apiKey: API_KEY,
      minIntervalMs: 0,
      fetcher: (async (url: URL) => {
        urls.push(url);
        return Response.json(pages[urls.length - 1]);
      }) as unknown as typeof fetch,
    });

    await expect(client.listCompanies()).resolves.toEqual([
      { id: "1", name: "One", domain: "one.com" },
      { id: "2", name: "Two", domain: null },
    ]);
    expect(urls[1].searchParams.get("starting_after")).toBe("cursor-1");
  });
});
