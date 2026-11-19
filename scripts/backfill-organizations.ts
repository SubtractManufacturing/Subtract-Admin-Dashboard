/**
 * Dev/test counterpart of the ADR-0013 feature migration's backfill.
 * Databases that sync with `db:push` never run migrations, so run this after
 * pushing the schema:
 *
 *   npm run db:push && npm run backfill:organizations
 *
 * Safe to run repeatedly: it is keyed on legacy ids.
 */
import { client } from "../app/lib/db/client";
import { runOrganizationsBackfill } from "../app/lib/organizations/backfill.server";

async function main() {
  const before = await client`select count(*)::int as n from organizations`;
  await runOrganizationsBackfill();
  const after = await client`
    select
      (select count(*)::int from organizations) as organizations,
      (select count(*)::int from accounts where type = 'customer') as customer_accounts,
      (select count(*)::int from accounts where type = 'vendor') as vendor_accounts,
      (select count(*)::int from customers) as legacy_customers,
      (select count(*)::int from vendors) as legacy_vendors`;
  console.log(
    `Organizations backfill complete: ${after[0].organizations - before[0].n} new Organizations.`,
    after[0],
  );
}

main()
  .then(() => client.end())
  .catch(async (error) => {
    console.error("Organizations backfill failed:", error);
    await client.end();
    process.exit(1);
  });
