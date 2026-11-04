/** Minimal Twenty REST client. The API key never leaves this file. */
import {
  ERP_QUOTE_ID_FIELD,
  normalizeDomain,
  type TwentyCompanySummary,
} from "./matching";

const REQUEST_TIMEOUT_MS = 15_000;
/** Twenty allows 100 requests a minute; this keeps a sweep comfortably under it. */
const DEFAULT_MIN_INTERVAL_MS = 700;
const PAGE_SIZE = 60;
const MAX_ERROR_LENGTH = 500;

/**
 * Accepts what people copy from the browser. Cloud workspaces live on
 * <name>.twenty.com, but their API is served from api.twenty.com.
 */
export function normalizeWorkspaceUrl(
  raw: string,
): { ok: true; url: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: true, url: "" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: "Enter a full URL, such as https://api.twenty.com" };
  }
  const isLocalHttp =
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !isLocalHttp) {
    return { ok: false, error: "The Twenty URL must use https://" };
  }
  if (url.hostname.endsWith(".twenty.com")) {
    return { ok: true, url: "https://api.twenty.com" };
  }
  return { ok: true, url: url.origin };
}

export class TwentyApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    /** Worth retrying as-is: an outage or rate limit rather than bad data. */
    readonly transient: boolean,
  ) {
    super(message);
    this.name = "TwentyApiError";
  }
}

export interface TwentyPerson {
  id: string;
  name?: { firstName?: string | null; lastName?: string | null } | null;
  emails?: { primaryEmail?: string | null; additionalEmails?: string[] | null } | null;
  phones?: {
    primaryPhoneNumber?: string | null;
    primaryPhoneCountryCode?: string | null;
    primaryPhoneCallingCode?: string | null;
    additionalPhones?: unknown;
  } | null;
  jobTitle?: string | null;
  companyId?: string | null;
}

export interface TwentyOpportunity {
  id: string;
  name?: string | null;
  amount?: { amountMicros?: number | string | null; currencyCode?: string | null } | null;
  rfqStatus?: string | null;
  company?: { id?: string; name?: string | null } | null;
  pointOfContact?: TwentyPerson | null;
}

export type TwentyFields = Record<string, unknown>;

/** The Twenty operations the sync needs; tests substitute an in-memory workspace. */
export interface TwentyApi {
  listCompanies(): Promise<TwentyCompanySummary[]>;
  createCompany(fields: TwentyFields): Promise<{ id: string }>;
  getPerson(id: string): Promise<TwentyPerson | null>;
  findPersonByEmail(email: string): Promise<TwentyPerson | null>;
  findPeopleByName(name: {
    firstName: string;
    lastName: string;
  }): Promise<TwentyPerson[]>;
  createPerson(fields: TwentyFields): Promise<{ id: string }>;
  updatePerson(id: string, fields: TwentyFields): Promise<void>;
  findOpportunitiesByErpQuoteId(erpQuoteId: string): Promise<Array<{ id: string }>>;
  createOpportunity(fields: TwentyFields): Promise<{ id: string }>;
  updateOpportunity(id: string, fields: TwentyFields): Promise<void>;
  readOpportunity(id: string): Promise<TwentyOpportunity | null>;
}

interface TwentyClientOptions {
  baseUrl: string;
  apiKey: string;
  fetcher?: typeof fetch;
  minIntervalMs?: number;
}

type Query = Record<string, string | number | undefined>;

function filterValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function createTwentyClient(options: TwentyClientOptions) {
  const { baseUrl, apiKey, fetcher = fetch } = options;
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  let nextRequestAt = 0;

  const safeError = (text: string) =>
    text.split(apiKey).join("[redacted]").slice(0, MAX_ERROR_LENGTH);

  async function request<T>(
    method: "GET" | "POST" | "PATCH",
    path: string,
    { query, body }: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const waitMs = nextRequestAt - Date.now();
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    nextRequestAt = Date.now() + minIntervalMs;

    const url = new URL(path, baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        // A redirect must not carry the bearer token to another host.
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.name : "network error";
      throw new TwentyApiError(`Could not reach Twenty (${reason})`, null, true);
    }

    if (response.ok) return (await response.json()) as T;

    if (response.status >= 300 && response.status < 400) {
      throw new TwentyApiError(
        `Twenty redirected the request (${response.status}); check the workspace URL`,
        response.status,
        false,
      );
    }
    const detail = safeError(await response.text().catch(() => ""));
    throw new TwentyApiError(
      `Twenty returned ${response.status}${detail ? `: ${detail}` : ""}`,
      response.status,
      response.status === 429 || response.status >= 500,
    );
  }

  async function list<T>(objectName: string, query: Query): Promise<T[]> {
    const result = await request<{ data?: Record<string, T[]> }>(
      "GET",
      `/rest/${objectName}`,
      { query },
    );
    return result.data?.[objectName] ?? [];
  }

  async function create(objectName: string, singular: string, fields: TwentyFields) {
    const result = await request<{ data?: Record<string, { id: string }> }>(
      "POST",
      `/rest/${objectName}`,
      { body: fields },
    );
    const record = result.data?.[`create${singular}`];
    if (!record?.id) {
      throw new TwentyApiError(`Twenty did not return the new ${singular}`, null, false);
    }
    return { id: record.id };
  }

  const api: TwentyApi = {
    async listCompanies() {
      const companies: TwentyCompanySummary[] = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await request<{
          data?: {
            companies?: Array<{
              id: string;
              name?: string | null;
              domainName?: { primaryLinkUrl?: string | null } | null;
            }>;
          };
          pageInfo?: { hasNextPage?: boolean; endCursor?: string };
        }>("GET", "/rest/companies", {
          query: {
            limit: PAGE_SIZE,
            starting_after: cursor,
            fields: "id,name,domainName",
          },
        });
        for (const company of page.data?.companies ?? []) {
          companies.push({
            id: company.id,
            name: company.name ?? "",
            domain: normalizeDomain(company.domainName?.primaryLinkUrl),
          });
        }
        if (!page.pageInfo?.hasNextPage || !page.pageInfo.endCursor) {
          return companies;
        }
        cursor = page.pageInfo.endCursor;
      }
    },

    createCompany: (fields) => create("companies", "Company", fields),

    async getPerson(id) {
      try {
        const result = await request<{ data?: { person?: TwentyPerson } }>(
          "GET",
          `/rest/people/${id}`,
          { query: { depth: 0 } },
        );
        return result.data?.person ?? null;
      } catch (error) {
        if (error instanceof TwentyApiError && error.status === 404) return null;
        throw error;
      }
    },

    async findPersonByEmail(email) {
      const people = await list<TwentyPerson>("people", {
        filter: `emails.primaryEmail[eq]:${filterValue(email)}`,
        limit: 1,
        depth: 0,
      });
      return people[0] ?? null;
    },

    findPeopleByName: ({ firstName, lastName }) =>
      list<TwentyPerson>("people", {
        filter: `and(name.firstName[eq]:${filterValue(firstName)},name.lastName[eq]:${filterValue(lastName)})`,
        limit: 10,
        depth: 0,
      }),

    createPerson: (fields) => create("people", "Person", fields),

    async updatePerson(id, fields) {
      await request("PATCH", `/rest/people/${id}`, { body: fields });
    },

    findOpportunitiesByErpQuoteId: (erpQuoteId) =>
      list<{ id: string }>("opportunities", {
        filter: `${ERP_QUOTE_ID_FIELD}[eq]:${filterValue(erpQuoteId)}`,
        limit: 2,
        fields: "id",
      }),

    createOpportunity: (fields) => create("opportunities", "Opportunity", fields),

    async updateOpportunity(id, fields) {
      await request("PATCH", `/rest/opportunities/${id}`, { body: fields });
    },

    async readOpportunity(id) {
      const result = await request<{ data?: { opportunity?: TwentyOpportunity } }>(
        "GET",
        `/rest/opportunities/${id}`,
        { query: { depth: 1 } },
      );
      return result.data?.opportunity ?? null;
    },
  };

  /** Null when this key cannot read field metadata. */
  async function isErpQuoteFieldUnique(): Promise<boolean | null> {
    type ObjectSummary = { id: string; nameSingular: string };
    type FieldList = { fields?: Array<{ name: string; isUnique?: boolean | null }> };
    try {
      const objects = await request<{ data?: ObjectSummary[] }>(
        "GET",
        "/rest/metadata/objects",
        { query: { limit: 200 } },
      );
      const summary = objects.data?.find((item) => item.nameSingular === "opportunity");
      if (!summary) return null;
      const detail = await request<FieldList & { data?: FieldList }>(
        "GET",
        `/rest/metadata/objects/${summary.id}`,
      );
      const fields = detail.data?.fields ?? detail.fields ?? [];
      const field = fields.find((item) => item.name === ERP_QUOTE_ID_FIELD);
      return field ? Boolean(field.isUnique) : null;
    } catch (error) {
      if (error instanceof TwentyApiError && !error.transient) return null;
      throw error;
    }
  }

  /**
   * Read-only check that the key works and every field the sync writes exists.
   * The `fields` parameter takes relation names: asking for companyId is a 400.
   */
  async function checkConnection(): Promise<void> {
    await list("companies", { limit: 1, fields: "id,name,domainName" });
    await list("people", {
      limit: 1,
      fields: "id,name,emails,phones,jobTitle,company",
    });
    await list("opportunities", {
      limit: 1,
      fields: `id,name,amount,company,pointOfContact,rfqStatus,${ERP_QUOTE_ID_FIELD}`,
    });
  }

  return { ...api, checkConnection, isErpQuoteFieldUnique };
}

export type TwentyClient = ReturnType<typeof createTwentyClient>;
