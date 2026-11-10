/**
 * Read-only check of a live Twenty workspace before enabling the sync. Sends GET
 * requests only and prints field names and counts, never customer data.
 * Twenty's responses are untyped here, as this only inspects their shape.
 *
 *   TWENTY_URL=https://api.twenty.com TWENTY_API_KEY_FILE=/path/to/key \
 *     npx tsx scripts/twenty-preflight.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";

import { normalizeWorkspaceUrl } from "../app/lib/twenty/client.server";
import {
  businessDomainFromEmail,
  ERP_QUOTE_ID_FIELD,
  normalizeDomain,
} from "../app/lib/twenty/matching";

const REQUIRED_RFQ_STATUSES = ["NEW_RFQ", "QUOTING", "QUOTE_SENT", "WON", "LOST"];
const PAGE_SIZE = 60;
const PAGE_DELAY_MS = 700;

const keyFile = process.env.TWENTY_API_KEY_FILE;
const apiKey = (keyFile ? readFileSync(keyFile, "utf8") : process.env.TWENTY_API_KEY)?.trim();
const normalized = normalizeWorkspaceUrl(process.env.TWENTY_URL ?? "https://api.twenty.com");
if (!apiKey || !normalized.ok || !normalized.url) {
  console.error("Set TWENTY_URL and TWENTY_API_KEY_FILE (or TWENTY_API_KEY).");
  process.exit(1);
}
const baseUrl = normalized.url;

async function get(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON error page; the status is enough.
  }
  return { status: response.status, body };
}

async function listAll(objectName: string, fields: string): Promise<any[]> {
  const records: any[] = [];
  let cursor = "";
  for (;;) {
    const after = cursor ? `&starting_after=${encodeURIComponent(cursor)}` : "";
    const { status, body } = await get(
      `/rest/${objectName}?limit=${PAGE_SIZE}&fields=${fields}${after}`,
    );
    if (status !== 200) throw new Error(`${objectName} returned ${status}`);
    records.push(...(body?.data?.[objectName] ?? []));
    if (!body?.pageInfo?.hasNextPage || !body.pageInfo.endCursor) return records;
    cursor = body.pageInfo.endCursor;
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  }
}

async function checkOpportunityFields() {
  const { status, body } = await get("/rest/metadata/objects?limit=200");
  const objects: any[] = Array.isArray(body?.data) ? body.data : [];
  const summary = objects.find((item) => item.nameSingular === "opportunity");
  const detail = summary ? await get(`/rest/metadata/objects/${summary.id}`) : null;
  const opportunity = detail?.body?.data ?? detail?.body ?? null;
  if (status !== 200 || !opportunity?.fields) {
    console.log(`Metadata: not readable with this key (${status}). Checking fields directly.`);
    for (const field of ["rfqStatus", "quoteDueDate", "nextFollowUp", "nextAction"]) {
      const probe = await get(`/rest/opportunities?limit=1&fields=id,${field}`);
      console.log(`  ${field}: ${probe.status === 200 ? "readable" : `HTTP ${probe.status}`}`);
    }
    return;
  }

  const custom = (opportunity.fields ?? []).filter((field: any) => field.isCustom);
  console.log("Custom opportunity fields:");
  for (const field of custom) {
    console.log(`  ${field.name} (${field.type})`);
  }
  const rfqStatus = (opportunity.fields ?? []).find((field: any) => field.name === "rfqStatus");
  const options: string[] = (rfqStatus?.options ?? []).map((option: any) => option.value);
  console.log(`rfqStatus options: ${options.join(", ") || "none found"}`);
  const erpField = (opportunity.fields ?? []).find(
    (field: any) => field.name === ERP_QUOTE_ID_FIELD,
  );
  console.log(
    erpField
      ? `${ERP_QUOTE_ID_FIELD}: ${erpField.type}, unique: ${Boolean(erpField.isUnique)}`
      : `MISSING ${ERP_QUOTE_ID_FIELD}: add it as a unique text field on Opportunities`,
  );
  const missing = REQUIRED_RFQ_STATUSES.filter((value) => !options.includes(value));
  console.log(missing.length ? `MISSING rfqStatus values: ${missing.join(", ")}` : "rfqStatus values: OK");
}

async function main() {
  console.log(`API base: ${baseUrl}`);
  const auth = await get("/rest/companies?limit=1&fields=id");
  console.log(`Auth: HTTP ${auth.status}`);
  if (auth.status !== 200) process.exit(1);

  await checkOpportunityFields();
  const fieldCheck = await get(
    `/rest/opportunities?limit=1&fields=id,name,amount,company,pointOfContact,rfqStatus,${ERP_QUOTE_ID_FIELD}`,
  );
  console.log(`Opportunity write fields readable: HTTP ${fieldCheck.status}`);

  const companies = await listAll("companies", "id,name,domainName");
  const domains = companies
    .map((company) => normalizeDomain(company.domainName?.primaryLinkUrl))
    .filter(Boolean) as string[];
  const named = companies.filter((company) => /\.[a-z]{2,}$/i.test(company.name ?? ""));
  const free = domains.filter((domain) => !businessDomainFromEmail(`x@${domain}`));
  console.log(
    `Companies: ${companies.length}; with domain: ${domains.length}; named like a domain: ${named.length}; on a free-mail domain: ${free.length}`,
  );

  const people = await listAll("people", "id,emails,phones,company");
  const phones = people.map((person) => person.phones).filter((p) => p?.primaryPhoneNumber);
  console.log(
    `People: ${people.length}; with email: ${people.filter((p) => p.emails?.primaryEmail).length}; with company: ${people.filter((p) => p.companyId ?? p.company?.id).length}; with phone: ${phones.length}`,
  );
  console.log(
    `Phone format: with calling code ${phones.filter((p) => p.primaryPhoneCallingCode).length}; with country ${phones.filter((p) => p.primaryPhoneCountryCode).length}; stored with leading + ${phones.filter((p) => String(p.primaryPhoneNumber).startsWith("+")).length}`,
  );

  const opportunities = await listAll("opportunities", "id,name");
  const quoteNamed = opportunities.filter((item) => /^Q\d{4}-/.test(item.name ?? ""));
  console.log(
    `Opportunities: ${opportunities.length}; already named with a quote number: ${quoteNamed.length}`,
  );
}

main().catch((error) => {
  console.error(`Preflight failed: ${error instanceof Error ? error.name : "error"}`);
  process.exit(1);
});
