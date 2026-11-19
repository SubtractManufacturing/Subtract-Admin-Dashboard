import { readFile } from "node:fs/promises";

import { client } from "../db/client.js";

/**
 * The ADR-0013 backfill, shared by the production migration (pasted in
 * verbatim) and dev/test databases that sync with `db:push`. The SQL is
 * idempotent and keyed on legacy ids, so re-running it changes nothing.
 */
export const ORGANIZATIONS_BACKFILL_SQL_URL = new URL(
  "../../../scripts/sql/organizations-backfill.sql",
  import.meta.url,
);

export async function readOrganizationsBackfillSql(): Promise<string> {
  return readFile(ORGANIZATIONS_BACKFILL_SQL_URL, "utf8");
}

/** Run the whole backfill in one transaction. */
export async function runOrganizationsBackfill(): Promise<void> {
  const statements = await readOrganizationsBackfillSql();
  await client.begin(async (tx) => {
    await tx.unsafe(statements);
  });
}
