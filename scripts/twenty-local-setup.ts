/**
 * Adds the opportunity fields the ERP sync needs to a local Twenty workspace, so
 * development can run without touching the live CRM. Safe to run repeatedly, and
 * it refuses anything but a localhost URL.
 *
 *   TWENTY_API_KEY_FILE=/path/to/local/key npx tsx scripts/twenty-local-setup.ts
 *
 * Create the key in the local workspace under Settings > Developers > API.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";

const baseUrl = (process.env.TWENTY_URL ?? "http://localhost:3000").replace(/\/$/, "");
const { hostname } = new URL(baseUrl);
if (hostname !== "localhost" && hostname !== "127.0.0.1") {
  console.error(`Refusing to change ${hostname}: this script is for local Twenty only.`);
  process.exit(1);
}

const keyFile = process.env.TWENTY_API_KEY_FILE;
const apiKey = (keyFile ? readFileSync(keyFile, "utf8") : process.env.TWENTY_API_KEY)?.trim();
if (!apiKey) {
  console.error("Set TWENTY_API_KEY_FILE or TWENTY_API_KEY to a local workspace key.");
  process.exit(1);
}

const RFQ_STATUSES: Array<[string, string, string]> = [
  ["NEW_RFQ", "New RFQ", "blue"],
  ["REVIEWING", "Reviewing", "sky"],
  ["QUOTING", "Quoting", "purple"],
  ["QUOTE_SENT", "Quote Sent", "turquoise"],
  ["FOLLOW_UP", "Follow Up", "orange"],
  ["WON", "Won", "green"],
  ["LOST", "Lost", "red"],
];

const REQUIRED_FIELDS = [
  { name: "erpQuoteId", label: "ERP Quote ID", type: "TEXT", isUnique: true },
  {
    name: "rfqStatus",
    label: "RFQ Status",
    type: "SELECT",
    options: RFQ_STATUSES.map(([value, label, color], position) => ({
      value,
      label,
      color,
      position,
    })),
  },
  { name: "quoteDueDate", label: "Quote Due Date", type: "DATE" },
  { name: "nextFollowUp", label: "Next Follow Up", type: "DATE" },
  { name: "nextAction", label: "Next Action", type: "TEXT" },
];

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed: any = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(parsed?.messages ?? parsed)}`);
  }
  return parsed;
}

async function main() {
  const objects = await call("GET", "/rest/metadata/objects?limit=200");
  const opportunity = objects.data.find((item: any) => item.nameSingular === "opportunity");
  const detail = await call("GET", `/rest/metadata/objects/${opportunity.id}`);
  const existing: any[] = detail.data?.fields ?? detail.fields ?? [];

  for (const field of REQUIRED_FIELDS) {
    const found = existing.find((item) => item.name === field.name);
    if (found) {
      console.log(`${field.name}: already present`);
      continue;
    }
    await call("POST", "/rest/metadata/fields", {
      ...field,
      objectMetadataId: opportunity.id,
    });
    console.log(`${field.name}: created`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
