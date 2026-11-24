/**
 * Cutover Shadow part 1, end to end in a real browser (see README.md).
 *
 *   E2E_DATABASE_URL=postgres://...@127.0.0.1:<port>/<throwaway> node scripts/e2e-cutover/run.mjs
 *
 * It EMPTIES the database it is given, so it only accepts a local one. All
 * names and emails below are made up.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  ROOT,
  clickButton,
  connect,
  databaseUrl,
  fill,
  goto,
  launchBrowser,
  openSession,
  resetDatabase,
  runStartupStep,
  shotsDir,
  startApp,
  startFakeAuth,
  text,
} from "./lib.mjs";

const ADMIN = { id: "e2e-admin", email: "admin@e2e.invalid", name: "Avery Admin", role: "Admin" };
const STAFF = { id: "e2e-staff", email: "staff@e2e.invalid", name: "Sky Staff", role: "User" };

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

let scenario = "";
const results = [];
function check(name, ok, detail = "") {
  results.push({ scenario, name, ok: Boolean(ok), detail });
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${ok || !detail ? "" : `\n         ${detail}`}`);
}
function equal(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(name, a === e, `expected ${e}\n         got      ${a}`);
}
function begin(name) {
  scenario = name;
  console.log(`\n${name}`);
}

const url = databaseUrl();
const sql = connect(url);
const shots = shotsDir();
const problems = [];
const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: true });

// ---------------------------------------------------------------------------
// Seed: made-up Customers and Vendors, in the shapes production has
// ---------------------------------------------------------------------------

async function seed() {
  await resetDatabase(sql);
  await sql`insert into users ${sql([ADMIN, STAFF].map((user) => ({ ...user, status: "active" })))}`;

  const customers = [
    { key: "combined", display_name: "Northwind Robotics - Dana Reed", email: "dana.reed@northwind-robotics.example" },
    { key: "businessy", display_name: "Harbor Machining", email: "harbor.shop@gmail.com" },
    { key: "person", display_name: "Lee Okafor", email: "lee.okafor@gmail.com" },
    { key: "unnamed", display_name: "Quill and Sons", company_name: "Quill and Sons", email: "orders@quill-sons.example" },
    { key: "fromDisplay", display_name: "Priya Raman", company_name: "Summit Fabrication", email: "priya@summit-fab.example" },
    { key: "hinted", display_name: "Kestrel Works", company_name: "Kestrel Works", email: "nora.lindqvist@kestrel-works.example" },
    {
      key: "edit", display_name: "Edit Target", company_name: "Edit Target Co", contact_name: "Morgan Hale",
      email: "morgan@edit-target.example", payment_terms: "Net 30",
      billing_address_line1: "1 Main St", billing_city: "Springfield", billing_state: "IL", billing_postal_code: "62701",
      shipping_address_line1: "2 Dock Rd", shipping_city: "Springfield", shipping_state: "IL", shipping_postal_code: "62702",
    },
    { key: "archive", display_name: "Archive Me", company_name: "Archive Me Supply", contact_name: "Robin Vale", email: "robin@archive-me.example" },
    { key: "mergeKeep", display_name: "Delta Tooling", company_name: "Delta Tooling", contact_name: "Sam Ito", email: "sam@delta-tooling.example" },
    { key: "mergeAway", display_name: "Delta Tooling (Sam)", contact_name: "Sam Ito", email: "sam@delta-tooling.example" },
    { key: "clear", display_name: "Jo Park", company_name: "Not A Company", contact_name: "Wrong Person", email: "jo.park@gmail.com" },
    { key: "marks", display_name: "Marked Row", company_name: "Marked Row Works", contact_name: "Casey Lund", email: "casey@marked-row.example" },
    { key: "buyer", display_name: "Quote Buyer", company_name: "Quote Buyer Labs", contact_name: "Rene Abara", email: "rene@quote-buyer.example" },
  ];
  const vendors = [
    { key: "vBusinessy", display_name: "Ridge Precision", email: "ridge.precision@gmail.com", discord_id: "1001", notes: "Five-axis work" },
    { key: "vComplete", display_name: "Ana Flores", company_name: "Flores Anodizing", contact_name: "Ana Flores", email: "ana@flores-anodizing.example" },
    { key: "vPerson", display_name: "Tomas Berg", email: "tomas.berg@gmail.com" },
  ];

  const ids = {};
  for (const { key, ...row } of customers) {
    const [inserted] = await sql`insert into customers ${sql(row)} returning id`;
    ids[key] = inserted.id;
  }
  for (const { key, ...row } of vendors) {
    const [inserted] = await sql`insert into vendors ${sql(row)} returning id`;
    ids[key] = inserted.id;
  }
  await sql`insert into customer_email_aliases ${sql([
    { customer_id: ids.mergeKeep, email: "sam@delta-tooling.example" },
    { customer_id: ids.mergeAway, email: "sam@delta-tooling.example" },
    { customer_id: ids.mergeAway, email: "s.ito@delta-tooling.example" },
  ])}`;
  const [quote] = await sql`
    insert into quotes ${sql({ quote_number: "Q-E2E-0001", customer_id: ids.mergeAway, vendor_id: ids.vComplete, status: "Draft" })}
    returning id`;
  const [order] = await sql`
    insert into orders ${sql({ order_number: "26A00001", customer_id: ids.mergeAway, vendor_id: ids.vComplete })} returning id`;
  await sql`insert into parts ${sql({ part_name: "Bracket", customer_id: ids.mergeAway })}`;
  await sql`insert into quotes ${sql({ quote_number: "Q-E2E-0002", customer_id: ids.edit, status: "Draft" })}`;
  await sql`insert into customer_communications ${sql({ customer_id: ids.mergeAway, method: "call", note: "Asked about lead time", created_by: ADMIN.id })}`;
  ids.mergeQuote = quote.id;
  ids.mergeOrder = order.id;
  return ids;
}

// ---------------------------------------------------------------------------
// Database reads the assertions use
// ---------------------------------------------------------------------------

const one = async (query) => (await query)[0];
const count = async (query) => (await query)[0].n;
const customerRow = (id) => one(sql`select to_jsonb(c) as row from customers c where id = ${id}`).then((r) => r.row);
const vendorRow = (id) => one(sql`select to_jsonb(v) as row from vendors v where id = ${id}`).then((r) => r.row);
const accountIds = async () =>
  Object.fromEntries(
    (await sql`
      select coalesce('customer:' || a.legacy_customer_id, 'vendor:' || a.legacy_vendor_id) as key,
             a.id as account, a.organization_id as organization,
             (select contact_id from organization_contacts oc where oc.organization_id = a.organization_id) as contact
      from accounts a order by 1`).map((r) => [r.key, `${r.account}/${r.organization}/${r.contact}`]),
  );
const copyOf = (type, id) =>
  one(sql`
    select o.id, o.kind, o.name, o.is_archived, o.merged_into_organization_id, a.id as account_id, a.payment_terms,
           c.name as contact_name
    from accounts a
    join organizations o on o.id = a.organization_id
    left join organization_contacts oc on oc.organization_id = o.id
    left join contacts c on c.id = oc.contact_id
    where ${type === "customer" ? sql`a.legacy_customer_id = ${id}` : sql`a.legacy_vendor_id = ${id}`}`);
const eventsOf = (entityType, id) =>
  sql`select event_type, user_id, metadata from event_logs where entity_type = ${entityType} and entity_id = ${String(id)} order by created_at`;
const markOf = (type, id) =>
  one(sql`select * from cutover_review_marks where legacy_type = ${type} and legacy_id = ${id}`);
const precheck = async () => sql.unsafe(await readFile(path.join(ROOT, "scripts/sql/organizations-precheck.sql"), "utf8"));

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

const hasButton = (name, enabledOnly = false) => [
  (label, enabled) =>
    [...document.querySelectorAll("button")].some(
      (button) => button.textContent.replace(/\s+/g, " ").trim() === label && (!enabled || !button.disabled),
    ),
  {},
  name,
  enabledOnly,
];
const bodyText = (page) => page.evaluate(() => document.body.textContent);

async function runSync(page) {
  await clickButton(page, "Run Sync", '[data-testid="cutover-sync"]');
  await page.waitForSelector('[data-testid="sync-result"], [data-testid="cutover-sync"] [role="alert"]');
  await page.waitForNetworkIdle();
  return text(page, '[data-testid="cutover-sync"]');
}
const headline = (page) => text(page, '[data-testid="check-headline"]');
const differenceRows = (page) =>
  page.$$eval('[data-testid="differences"] li', (items) =>
    items.map((item) => ({
      text: item.textContent.replace(/\s+/g, " ").trim(),
      href: item.querySelector("a")?.getAttribute("href") ?? null,
    })),
  );

const row = (type, id) => `[data-review-row="${type}:${id}"]`;
const rowState = (page, type, id) => page.$eval(row(type, id), (element) => element.dataset.state);
const rowResult = (page, type, id) =>
  page.$eval(row(type, id), (element) => ({
    kind: element.querySelector('[data-testid="result-kind"]').textContent.trim(),
    organization: element.querySelector('[data-testid="result-organization"]').textContent.trim(),
    contact: element.querySelector('[data-testid="result-contact"]').textContent.trim(),
  }));
const rowFlags = (page, type, id) =>
  page.$$eval(`${row(type, id)} [data-testid="flag"]`, (chips) => chips.map((chip) => chip.dataset.flag));
const rowInputs = (page, type, id) =>
  page.$eval(row(type, id), (element) =>
    Object.fromEntries([...element.querySelectorAll("input")].map((input) => [input.name, input.value])),
  );
const visibleRowKeys = (page) =>
  page.$$eval('[data-testid="review-row"]', (rows) => rows.map((element) => element.dataset.reviewRow));
async function saveRow(page, type, id) {
  await page.click(`${row(type, id)} [data-testid="save"]`);
  await page.waitForSelector(`${row(type, id)}[data-state="reviewed"]`);
  await page.waitForNetworkIdle();
}

/** Open a card's Edit form on a Customer or Vendor page, fill it and save. */
async function editCard(page, heading, formSelector, fields) {
  await page.evaluate((title) => {
    const h3 = [...document.querySelectorAll("h3")].find((element) => element.textContent.trim() === title);
    [...h3.parentElement.querySelectorAll("button")].find((button) => button.textContent.trim() === "Edit").click();
  }, heading);
  await page.waitForSelector(formSelector);
  for (const [name, value] of Object.entries(fields)) {
    await fill(page, `${formSelector} input[name="${name}"]`, value);
  }
  await page.click(`${formSelector} button[type="submit"]`);
  await page.waitForSelector(formSelector, { hidden: true });
  await page.waitForNetworkIdle();
}

// ---------------------------------------------------------------------------
// The scenarios
// ---------------------------------------------------------------------------

async function scenarios(browser, ids) {
  const admin = await openSession(browser, ADMIN, "admin", problems);
  const page = admin.page;
  page.on("dialog", (dialog) => dialog.accept());

  // -------------------------------------------------------------------------
  begin("1. Admin: status page, Sync, Check at 0");
  await goto(page, "/customers");
  const link = await page.$('a[href="/cutover"]');
  check("the Customers page shows Admin a link to the status page", link !== null);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), link.click()]);
  equal("the link opens /cutover", new URL(page.url()).pathname, "/cutover");
  equal("the stage is Shadow", await text(page, '[data-testid="stage-value"]'), "Shadow");
  check("the old tables are the live ones", /old tables \(customers, vendors\)/.test(await text(page, '[data-testid="live-tables"]')));
  check("no Sync has run yet", /Last Sync: never/.test(await text(page, '[data-testid="last-sync"]')));
  check("Check reports differences before the first Sync", /^\d+ differences\./.test(await headline(page)), await headline(page));
  check("the groups list is announced, not built", /Not in this release/.test(await text(page, '[data-testid="cutover-groups"]')));
  await shot(page, "01-status-before-first-sync");

  const old = await one(sql`select (select count(*)::int from customers) + (select count(*)::int from vendors) as n`);
  const syncText = await runSync(page);
  check("Sync reports what it removed", /Sync finished: \d+ differences removed/.test(syncText), syncText);
  equal("Check is at 0 differences", await headline(page), "0 differences. Old and new are equal.");
  check("the page shows who ran the last Sync", new RegExp(`Last Sync: .* by ${ADMIN.email}`).test(await text(page, '[data-testid="last-sync"]')));
  equal(
    "one Organization, Contact and account per old row",
    await one(sql`
      select (select count(*)::int from organizations) as organizations, (select count(*)::int from contacts) as contacts,
             (select count(*)::int from accounts) as accounts`),
    { organizations: old.n, contacts: old.n, accounts: old.n },
  );
  equal(
    "the Sync is in the Event log with who ran it",
    (await sql`select user_id from event_logs where event_type = 'cutover_sync_ran'`).map((r) => r.user_id),
    [ADMIN.id],
  );
  const firstIds = await accountIds();
  await shot(page, "02-status-check-at-zero");

  async function syncToZero(label) {
    await goto(page, "/cutover");
    await runSync(page);
    equal(`${label}: Check is back at 0 differences`, await headline(page), "0 differences. Old and new are equal.");
    const now = await accountIds();
    equal(
      `${label}: every account, Organization and Contact id is unchanged`,
      Object.keys(firstIds).filter((key) => now[key] !== firstIds[key]),
      [],
    );
  }

  // -------------------------------------------------------------------------
  begin("2. Edit, archive and merge in today's app; Check lists each; Sync follows");
  await goto(page, `/customers/${ids.edit}`);
  await editCard(page, "Company Information", 'form[data-editing="info"]', {
    companyName: "Edit Target Industries",
    paymentTerms: "Net 45",
  });
  await editCard(page, "Contact Information", 'form[data-editing="contact"]', { contactName: "Morgan Hale-Ruiz" });
  const edited = await customerRow(ids.edit);
  equal(
    "today's Customer form saved the edit",
    [edited.company_name, edited.payment_terms, edited.contact_name],
    ["Edit Target Industries", "Net 45", "Morgan Hale-Ruiz"],
  );

  await goto(page, "/customers");
  await page.evaluate(() => {
    const tr = [...document.querySelectorAll("tr")].find((element) => element.textContent.includes("Archive Me"));
    tr.querySelector('button[aria-label="Archive"]').click();
  });
  await page.waitForNetworkIdle();
  equal("today's Customers list archived a Customer", (await customerRow(ids.archive)).is_archived, true);

  await goto(page, "/customers/merge");
  const mergeLabel = "Review merging Delta Tooling (Sam) into Delta Tooling";
  if (!(await page.$(`button[aria-label="${mergeLabel}"]`))) {
    await page.click('button[aria-label="Keep Delta Tooling instead"]');
  }
  await page.click(`button[aria-label="${mergeLabel}"]`);
  await page.waitForFunction(...hasButton("Merge Customers", true));
  await shot(page, "03-old-merge-tool-review");
  await clickButton(page, "Merge Customers");
  await page.waitForFunction((label) => ![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === label), {}, "Merge Customers");
  await page.waitForNetworkIdle();
  const mergedAway = await customerRow(ids.mergeAway);
  equal(
    "today's merge tool merged the two Customers",
    [mergedAway.is_archived, mergedAway.merged_into_customer_id],
    [true, ids.mergeKeep],
  );

  await goto(page, "/cutover");
  const listed = await differenceRows(page);
  check("Check reports differences again", /^\d+ differences\./.test(await headline(page)), await headline(page));
  const has = (pattern, href) => listed.some((item) => pattern.test(item.text) && item.href === href);
  check("the edit: Organization name, linked to the Customer",
    has(/Organization name is "Edit Target Co"; the old row gives "Edit Target Industries"/, `/customers/${ids.edit}`));
  check("the edit: payment terms", has(/Account payment terms is "Net 30"; the old row gives "Net 45"/, `/customers/${ids.edit}`));
  check("the edit: Contact name", has(/Contact name is "Morgan Hale"; the old row gives "Morgan Hale-Ruiz"/, `/customers/${ids.edit}`));
  equal("the archive: Organization, Contact and account",
    listed.filter((item) => item.href === `/customers/${ids.archive}` && /archived is no; the old row gives yes/.test(item.text)).length, 3);
  check("the merge: the pointer", has(/Merged into Customer \d+, but the Organization does not point/, `/customers/${ids.mergeAway}`));
  check("the merge: the Quote that moved", has(/Quote Q-E2E-0001 is linked to another account/, `/quotes/${ids.mergeQuote}`));
  check("the merge: the Order that moved", has(/Order 26A00001 is linked to another account/, "/orders/26A00001"));
  check("the merge: the Part that moved", has(/Part Bracket is linked to another account/, `/customers/${ids.mergeKeep}`));
  check("the merge: the alias that moved", listed.some((item) => /alias s\.ito@delta-tooling\.example/.test(item.text)));
  check("the merge: the communication that moved", listed.some((item) => /communication .* is on another Organization/.test(item.text)));
  equal("every difference links to a record", listed.filter((item) => !item.href), []);
  await shot(page, "04-check-lists-old-app-changes");

  const hrefs = [...new Set(listed.map((item) => item.href))];
  const statuses = await page.evaluate(
    (links) => Promise.all(links.map((href) => fetch(href).then((response) => [href, response.status]))),
    hrefs,
  );
  equal("every link in the list opens", statuses.filter(([, status]) => status !== 200), []);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle0" }),
    page.click(`[data-testid="differences"] a[href="/customers/${ids.edit}"]`),
  ]);
  check("a link opens that Customer in today's app",
    new URL(page.url()).pathname === `/customers/${ids.edit}` && (await bodyText(page)).includes("Edit Target Industries"));

  await syncToZero("after the old-app changes");
  const editedCopy = await copyOf("customer", ids.edit);
  equal("the copy has the edit", [editedCopy.name, editedCopy.payment_terms, editedCopy.contact_name],
    ["Edit Target Industries", "Net 45", "Morgan Hale-Ruiz"]);
  equal("the copy is archived", (await copyOf("customer", ids.archive)).is_archived, true);
  const keptCopy = await copyOf("customer", ids.mergeKeep);
  const awayCopy = await copyOf("customer", ids.mergeAway);
  equal("the merged Organization points at the survivor", awayCopy.merged_into_organization_id, keptCopy.id);
  equal(
    "the Quote, Order and Part follow the survivor's account",
    await one(sql`
      select (select customer_account_id from quotes where id = ${ids.mergeQuote}) as quote,
             (select customer_account_id from orders where id = ${ids.mergeOrder}) as "order",
             (select customer_account_id from parts where part_name = 'Bracket') as part`),
    { quote: keptCopy.account_id, order: keptCopy.account_id, part: keptCopy.account_id },
  );

  // -------------------------------------------------------------------------
  begin("3. Review list");
  await goto(page, "/cutover/review");
  const expected = (await precheck()).map((item) => ({ key: `${item.kind}:${item.id}`, flags: item.flags }));
  const total = expected.length;
  const flaggedAtStart = expected.filter((item) => item.flags.length > 0).length;
  equal("one row per active Customer and Vendor, the rows of the precheck query",
    (await visibleRowKeys(page)).sort(), expected.map((item) => item.key).sort());
  const shownFlags = await page.$$eval('[data-testid="review-row"]', (rows) =>
    Object.fromEntries(rows.map((element) => [
      element.dataset.reviewRow,
      [...element.querySelectorAll('[data-testid="flag"]')].map((chip) => chip.textContent.trim()),
    ])),
  );
  equal("every row shows the flags the precheck query gives it",
    expected.filter((item) => JSON.stringify(shownFlags[item.key]) !== JSON.stringify(item.flags)), []);
  equal("a combined name is flagged", await rowFlags(page, "customer", ids.combined), ["combinedName", "businessWord", "businessDomain"]);
  equal("a plain person is not flagged", await rowFlags(page, "customer", ids.person), []);
  equal("progress starts at none reviewed", await text(page, '[data-testid="progress"]'),
    `0 of ${total} reviewed. ${flaggedAtStart} of ${flaggedAtStart} flagged rows still to review.`);
  equal("the row shows what it becomes", await rowResult(page, "customer", ids.combined),
    { kind: "Individual", organization: "Northwind Robotics - Dana Reed", contact: "Northwind Robotics - Dana Reed" });
  await shot(page, "05-review-list");

  // A suggestion fills the fields and saves nothing.
  const combinedBefore = await customerRow(ids.combined);
  await page.click(`${row("customer", ids.combined)} [data-suggestion="split"]`);
  equal("a suggestion fills company and contact", await rowInputs(page, "customer", ids.combined),
    { displayName: "Northwind Robotics - Dana Reed", companyName: "Northwind Robotics", contactName: "Dana Reed" });
  equal("the result shows the suggestion", await rowResult(page, "customer", ids.combined),
    { kind: "Business", organization: "Northwind Robotics", contact: "Dana Reed" });
  equal("the row is marked as edited, not saved", await rowState(page, "customer", ids.combined), "edited");
  equal("nothing was saved by the suggestion", await customerRow(ids.combined), combinedBefore);
  equal("no mark was written by the suggestion", await markOf("customer", ids.combined), undefined);

  // The result follows the typing.
  const company = `${row("customer", ids.businessy)} input[name="companyName"]`;
  await page.type(company, "Harbor");
  equal("the result updates while typing", await rowResult(page, "customer", ids.businessy),
    { kind: "Business", organization: "Harbor", contact: "Harbor Machining" });
  await page.type(company, " Machining LLC");
  equal("and keeps updating", (await rowResult(page, "customer", ids.businessy)).organization, "Harbor Machining LLC");
  await page.keyboard.press("Escape");
  equal("Escape undoes what was typed", await rowInputs(page, "customer", ids.businessy),
    { displayName: "Harbor Machining", companyName: "", contactName: "" });
  equal("nothing was saved by typing", (await customerRow(ids.businessy)).company_name, null);

  // An email hint fills the contact, and saves nothing.
  equal("an unnamed Contact gets a first name from the email as a hint",
    await text(page, `${row("customer", ids.hinted)} [data-testid="name-hint"]`), "Hint from the email: Nora");
  await page.click(`${row("customer", ids.hinted)} [data-testid="name-hint"]`);
  equal("the hint fills the contact name when clicked", (await rowInputs(page, "customer", ids.hinted)).contactName, "Nora");
  equal("nothing was saved by the hint", (await customerRow(ids.hinted)).contact_name, null);
  await clickButton(page, "Reset", row("customer", ids.hinted));
  check("a role mailbox gives no name hint", (await page.$(`${row("customer", ids.unnamed)} [data-testid="name-hint"]`)) === null);
  check("a Contact that already has a name gets no hint", (await page.$(`${row("customer", ids.fromDisplay)} [data-testid="name-hint"]`)) === null);

  // Save: only the edited fields, through the Customer update, with its Event log.
  const orderBefore = await visibleRowKeys(page);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const eventsBefore = (await eventsOf("customer", ids.combined)).length;
  await saveRow(page, "customer", ids.combined);
  const combinedAfter = await customerRow(ids.combined);
  equal("the save changed only the edited fields on the old row", combinedAfter,
    { ...combinedBefore, company_name: "Northwind Robotics", contact_name: "Dana Reed", updated_at: combinedAfter.updated_at });
  equal("the save wrote the Customer form's Event log, with only those fields",
    (await eventsOf("customer", ids.combined)).slice(eventsBefore).map((event) => [event.event_type, event.user_id, event.metadata]),
    [["customer_updated", ADMIN.id, { companyName: "Northwind Robotics", contactName: "Dana Reed" }]]);
  equal("the row is reviewed", await rowState(page, "customer", ids.combined), "reviewed");
  equal("the reviewed mark records who", (await markOf("customer", ids.combined))?.reviewed_by, ADMIN.id);
  equal("the list keeps its order after a save", await visibleRowKeys(page), orderBefore);
  const nextKey = orderBefore[orderBefore.indexOf(`customer:${ids.combined}`) + 1];
  equal("focus moves to the next row",
    await page.evaluate(() => `${document.activeElement?.closest("form")?.dataset.reviewRow}|${document.activeElement?.getAttribute("name")}`),
    `${nextKey}|companyName`);
  check("the page did not jump", Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore) < 200);
  equal("the row's flags are gone", await rowFlags(page, "customer", ids.combined), []);
  equal("the copy is untouched until the next Sync", (await copyOf("customer", ids.combined)).name, "Northwind Robotics - Dana Reed");

  // Mark as right.
  const personBefore = await customerRow(ids.person);
  const personEvents = (await eventsOf("customer", ids.person)).length;
  await saveRow(page, "customer", ids.person);
  equal("marking a row as right changes nothing on the old row", await customerRow(ids.person), personBefore);
  equal("and writes no Event log", (await eventsOf("customer", ids.person)).length, personEvents);
  check("and the row is reviewed", (await markOf("customer", ids.person)) !== undefined);

  // Clear company and contact, saved with Enter.
  await fill(page, `${row("customer", ids.clear)} input[name="companyName"]`, "");
  await fill(page, `${row("customer", ids.clear)} input[name="contactName"]`, "");
  equal("the result shows the cleared row", await rowResult(page, "customer", ids.clear),
    { kind: "Individual", organization: "Jo Park", contact: "Jo Park" });
  await page.keyboard.press("Enter");
  await page.waitForSelector(`${row("customer", ids.clear)}[data-state="reviewed"]`);
  await page.waitForNetworkIdle();
  const cleared = await customerRow(ids.clear);
  equal("company and contact can be cleared, saved with Enter",
    [cleared.company_name, cleared.contact_name, cleared.display_name], [null, null, "Jo Park"]);

  // Progress and filters.
  const flaggedNow = (await precheck()).filter((item) => item.flags.length > 0).map((item) => `${item.kind}:${item.id}`);
  const reviewedKeys = [`customer:${ids.combined}`, `customer:${ids.person}`, `customer:${ids.clear}`];
  const flaggedLeft = flaggedNow.filter((key) => !reviewedKeys.includes(key));
  equal("progress counts the reviewed rows", await text(page, '[data-testid="progress"]'),
    `3 of ${total} reviewed. ${flaggedLeft.length} of ${flaggedNow.length} flagged rows still to review.`);
  await page.click('[data-testid="filter-flagged"]');
  equal("Flagged only shows the flagged rows", (await visibleRowKeys(page)).sort(), [...flaggedNow].sort());
  await page.click('[data-testid="filter-unreviewed"]');
  equal("with Unreviewed only, the flagged rows still to review", (await visibleRowKeys(page)).sort(), [...flaggedLeft].sort());
  await page.click('[data-testid="filter-flagged"]');
  equal("Unreviewed only hides the reviewed rows", (await visibleRowKeys(page)).length, total - 3);
  await page.select('[data-testid="filter-type"]', "vendor");
  equal("the type filter shows Vendors", (await visibleRowKeys(page)).sort(),
    [`vendor:${ids.vBusinessy}`, `vendor:${ids.vComplete}`, `vendor:${ids.vPerson}`].sort());
  await page.select('[data-testid="filter-type"]', "all");
  await page.type('[data-testid="filter-search"]', "harbor");
  equal("search narrows the list", await visibleRowKeys(page), [`customer:${ids.businessy}`]);
  await fill(page, '[data-testid="filter-search"]', "");

  // With Unreviewed only on, a saved row stays where it is.
  const unreviewedOrder = await visibleRowKeys(page);
  await page.click(`${row("customer", ids.businessy)} [data-suggestion="display-as-company"]`);
  await saveRow(page, "customer", ids.businessy);
  equal("a saved row keeps its place under the Unreviewed filter", await visibleRowKeys(page), unreviewedOrder);
  equal("the suggestion was saved as the company", (await customerRow(ids.businessy)).company_name, "Harbor Machining");
  await shot(page, "06-review-list-after-saves");
  await page.click('[data-testid="filter-unreviewed"]');
  await page.click('[data-testid="filter-unreviewed"]');
  check("it leaves the list when the filter is applied again", !(await visibleRowKeys(page)).includes(`customer:${ids.businessy}`));
  await page.click('[data-testid="filter-unreviewed"]');

  // Undo.
  await page.click(`${row("customer", ids.person)} [data-testid="undo-review"]`);
  await page.waitForSelector(`${row("customer", ids.person)}[data-state="to-review"]`);
  await page.waitForNetworkIdle();
  equal("Undo takes the mark back and leaves the old row alone",
    [(await markOf("customer", ids.person)) ?? null, await customerRow(ids.person)], [null, personBefore]);
  await saveRow(page, "customer", ids.person);

  // -------------------------------------------------------------------------
  begin("4. A reviewed mark follows the old row");
  await saveRow(page, "customer", ids.marks);
  await goto(page, `/customers/${ids.marks}`);
  // The Contact card is used for the unrelated edit: on master, saving the
  // Company Information card clears the contact name (it does not post it),
  // which changes the result and correctly resets the mark.
  await editCard(page, "Contact Information", 'form[data-editing="contact"]', {
    title: "Purchasing Lead",
    email: "casey.lund@marked-row.example",
  });
  const unrelated = await customerRow(ids.marks);
  equal("an unrelated edit in the Customer form was saved", [unrelated.title, unrelated.email], ["Purchasing Lead", "casey.lund@marked-row.example"]);
  await goto(page, "/cutover/review");
  equal("the row stays reviewed after an unrelated field changes", await rowState(page, "customer", ids.marks), "reviewed");
  await goto(page, `/customers/${ids.marks}`);
  await editCard(page, "Contact Information", 'form[data-editing="contact"]', { contactName: "Casey Lund-Okoro" });
  await goto(page, "/cutover/review");
  equal("the row goes back to unreviewed after its contact name changes", await rowState(page, "customer", ids.marks), "to-review");
  equal("and shows the new result", (await rowResult(page, "customer", ids.marks)).contact, "Casey Lund-Okoro");

  // -------------------------------------------------------------------------
  begin("5. Vendors go through the same list");
  equal("a Vendor that reads like a business is flagged", await rowFlags(page, "vendor", ids.vBusinessy), ["businessWord"]);
  const vendorBefore = await vendorRow(ids.vBusinessy);
  await page.click(`${row("vendor", ids.vBusinessy)} [data-suggestion="display-as-company"]`);
  equal("the suggestion fills the Vendor's company", (await rowInputs(page, "vendor", ids.vBusinessy)).companyName, "Ridge Precision");
  equal("and saves nothing", await vendorRow(ids.vBusinessy), vendorBefore);
  await saveRow(page, "vendor", ids.vBusinessy);
  const vendorAfter = await vendorRow(ids.vBusinessy);
  equal("the save changed only the company on the old Vendor row", vendorAfter,
    { ...vendorBefore, company_name: "Ridge Precision", updated_at: vendorAfter.updated_at });
  equal("through the Vendor update, with its Event log",
    (await eventsOf("vendor", ids.vBusinessy)).map((event) => [event.event_type, event.user_id, event.metadata]),
    [["vendor_updated", ADMIN.id, { companyName: "Ridge Precision" }]]);
  const completeBefore = await vendorRow(ids.vComplete);
  await saveRow(page, "vendor", ids.vComplete);
  equal("a Vendor can be marked as right without a change", await vendorRow(ids.vComplete), completeBefore);
  await goto(page, `/vendors/${ids.vComplete}`);
  await editCard(page, "Contact Information", 'form[data-editing="contact-info"]', { contactName: "Ana Flores-Ruiz" });
  await goto(page, "/cutover/review");
  equal("a Vendor's mark resets when today's Vendor form changes its contact", await rowState(page, "vendor", ids.vComplete), "to-review");

  await goto(page, "/cutover");
  check("the review saves show up in Check", /^\d+ differences\./.test(await headline(page)), await headline(page));
  check("the status page counts the reviewed rows", new RegExp(`^5 of ${total} reviewed`).test(await text(page, '[data-testid="review-progress"]')),
    await text(page, '[data-testid="review-progress"]'));
  await syncToZero("after the review saves");
  equal("the copy follows the reviewed names",
    await copyOf("customer", ids.combined).then((copy) => [copy.kind, copy.name, copy.contact_name]),
    ["business", "Northwind Robotics", "Dana Reed"]);
  equal("the Vendor copy follows too", await copyOf("vendor", ids.vBusinessy).then((copy) => [copy.kind, copy.name]), ["business", "Ridge Precision"]);
  await shot(page, "07-status-after-review");

  // -------------------------------------------------------------------------
  begin("6. A User-role login reaches nothing");
  const staffProblems = [];
  const staff = await openSession(browser, STAFF, "staff", staffProblems);
  staff.page.on("dialog", (dialog) => dialog.accept());
  const state = async () => ({
    marks: await count(sql`select count(*)::int as n from cutover_review_marks`),
    syncs: await count(sql`select count(*)::int as n from event_logs where event_type = 'cutover_sync_ran'`),
    row: await customerRow(ids.unnamed),
  });
  const before = await state();
  const leaks = [];
  for (const pathname of ["/", "/customers", "/vendors", "/quotes", "/orders", "/ActionItems", "/crm", `/customers/${ids.edit}`, `/vendors/${ids.vComplete}`]) {
    const response = await goto(staff.page, pathname);
    if (response.status() !== 200) leaks.push(`${pathname} answered ${response.status()}`);
    // The whole document, inline page data included, not only what is visible.
    const found = await staff.page.evaluate(() => ({
      links: document.querySelectorAll('a[href*="cutover"]').length,
      word: /cutover/i.test(document.documentElement.outerHTML),
    }));
    if (found.links > 0 || found.word) leaks.push(`${pathname} mentions the cutover`);
  }
  equal("no page shows a User-role login a link to the cutover, or the word", leaks, []);
  equal("today's pages work for that login with no errors", staffProblems, []);

  const refused = [];
  for (const pathname of ["/cutover", "/cutover/review"]) {
    refused.push([`GET ${pathname}`, (await goto(staff.page, pathname)).status()]);
  }
  const seen = JSON.stringify({ displayName: before.row.display_name, companyName: before.row.company_name, contactName: before.row.contact_name });
  const save = { intent: "save", type: "customer", id: String(ids.unnamed), seen, changes: JSON.stringify({ contactName: "Injected" }) };
  const attempts = [
    ["/cutover?_data=routes%2F_protected.cutover._index", "GET", null],
    ["/cutover/review?_data=routes%2F_protected.cutover.review", "GET", null],
    ["/cutover", "POST", { intent: "sync" }],
    ["/cutover?_data=routes%2F_protected.cutover._index", "POST", { intent: "sync" }],
    ["/cutover/review", "POST", save],
    ["/cutover/review?_data=routes%2F_protected.cutover.review", "POST", { ...save, changes: "{}" }],
    ["/cutover/review", "POST", { intent: "clear", type: "customer", id: String(ids.combined) }],
  ];
  await goto(staff.page, "/customers");
  for (const [pathname, method, body] of attempts) {
    const status = await staff.page.evaluate(
      (target, verb, fields) =>
        fetch(target, { method: verb, body: fields ? new URLSearchParams(fields) : undefined }).then((response) => response.status),
      pathname, method, body,
    );
    refused.push([`${method} ${pathname}`, status]);
  }
  equal("every cutover URL and action answers 403", refused.filter(([, status]) => status !== 403), []);
  equal("nine requests were refused", refused.length, 9);
  equal("and nothing changed", await state(), before);
  equal(
    "the only failures that login saw are those refusals",
    staffProblems.filter((problem) => !(/403/.test(problem.detail) && (problem.kind === "console" || /\/cutover/.test(problem.detail)))),
    [],
  );

  const anonymous = await openSession(browser, null, "anonymous", []);
  await goto(anonymous.page, "/cutover");
  equal("without a login the status page goes to the login page", new URL(anonymous.page.url()).pathname, "/login");
  await anonymous.context.close();
  await staff.context.close();

  // -------------------------------------------------------------------------
  begin("7. Today's app is unchanged (as a User-role login)");
  const appProblems = [];
  const worker = await openSession(browser, STAFF, "staff-app", appProblems);
  const app = worker.page;
  app.on("dialog", (dialog) => dialog.accept());
  await goto(app, "/customers");
  const customerList = await bodyText(app);
  check("the Customers list shows the Customers", ["Edit Target", "Delta Tooling", "Quote Buyer", "Lee Okafor"].every((name) => customerList.includes(name)));
  check("and not the archived or merged ones", !customerList.includes("Archive Me") && !customerList.includes("Delta Tooling (Sam)"));
  await goto(app, `/customers/${ids.mergeKeep}`);
  const detail = await bodyText(app);
  check("a Customer page shows the Customer with the merged Quote and Order",
    detail.includes("Delta Tooling") && detail.includes("Q-E2E-0001") && detail.includes("26A00001"));
  await goto(app, "/vendors");
  const vendorList = await bodyText(app);
  check("the Vendors list shows the Vendors", ["Ridge Precision", "Ana Flores", "Tomas Berg"].every((name) => vendorList.includes(name)));
  await goto(app, `/vendors/${ids.vComplete}`);
  check("a Vendor page shows the Vendor", (await bodyText(app)).includes("Flores Anodizing"));
  await editCard(app, "Company Information", 'form[data-editing="company-info"]', { paymentTerms: "Net 15" });
  equal("a User-role login can still edit a Vendor in today's form", (await vendorRow(ids.vComplete)).payment_terms, "Net 15");

  // Create a Quote for a Customer.
  await goto(app, "/quotes/new");
  await clickButton(app, "Skip - Create Empty Quote");
  await app.waitForSelector('input[placeholder="Search for a customer..."]');
  await app.type('input[placeholder="Search for a customer..."]', "Quote Buyer");
  await app.keyboard.press("Enter");
  await app.waitForFunction(...hasButton("Review Quote", true));
  await clickButton(app, "Review Quote");
  await app.waitForFunction(...hasButton("Create RFQ", true));
  await new Promise((resolve) => setTimeout(resolve, 700));
  await Promise.all([app.waitForNavigation({ waitUntil: "networkidle0" }), clickButton(app, "Create RFQ")]);
  const created = await one(sql`select * from quotes where customer_id = ${ids.buyer}`);
  check("a Quote was created for the Customer through the New Quote form",
    created !== undefined && (await bodyText(app)).includes(created.quote_number), app.url());
  equal("the new Quote has its Customer, and no account until the next Sync",
    [created?.customer_id, created?.customer_account_id], [ids.buyer, null]);

  // Convert it to an Order. The priced line item is inserted directly: the
  // line-item editor is not something this release touches.
  await sql`insert into quote_line_items ${sql({ quote_id: created.id, name: "Bracket run", quantity: 2, unit_price: "50.00", total_price: "100.00" })}`;
  await sql`update quotes set subtotal = '100.00', total = '100.00' where id = ${created.id}`;
  await goto(app, `/quotes/${created.id}`);
  await clickButton(app, "Mark as Sent");
  await app.waitForFunction(...hasButton("Mark as Accepted", true));
  await app.waitForNetworkIdle();
  await clickButton(app, "Mark as Accepted");
  await app.waitForFunction(() => /\/orders\//.test(location.pathname) || document.body.textContent.includes("Converted to Order"));
  await app.waitForNetworkIdle();
  const converted = await one(sql`
    select q.status, q.converted_to_order_id, o.order_number, o.customer_id
    from quotes q left join orders o on o.id = q.converted_to_order_id where q.id = ${created.id}`);
  equal("the Quote converted to an Order for the same Customer",
    [converted.status, converted.customer_id, converted.converted_to_order_id !== null], ["Accepted", ids.buyer, true]);
  check("the app shows the new Order", (await bodyText(app)).includes(converted.order_number ?? "(no order)"), app.url());
  await shot(app, "08-order-converted-from-quote");
  equal("no console errors and no failed requests in today's app", appProblems, []);
  await worker.context.close();

  // The cutover follows what today's app just did.
  await goto(page, "/cutover");
  const fresh = await differenceRows(page);
  check("Check lists the new Quote and the new Order",
    fresh.some((item) => item.href === `/quotes/${created.id}`) && fresh.some((item) => item.href === `/orders/${converted.order_number}`),
    JSON.stringify(fresh));
  await syncToZero("after the new Quote and Order");
  equal("the stage is still Shadow", (await one(sql`select stage from cutover_state`)).stage, "shadow");
  equal("the admin session saw no console errors and no failed requests", problems, []);
}

async function main() {
  const ids = await seed();
  const auth = await startFakeAuth([ADMIN, STAFF]);

  begin("Startup: this release records the stage as Shadow before it serves");
  const startup = await runStartupStep(url);
  equal("the startup step exits 0", startup.code, 0);
  check("it reports recording Shadow", /Stage recorded as Shadow/.test(startup.output), startup.output);
  equal("the stage row says shadow", (await one(sql`select stage from cutover_state`))?.stage, "shadow");

  // Past Unlock there is no way back but a restore: the same step refuses.
  await sql`update cutover_state set stage = 'unlocked'`;
  const refused = await runStartupStep(url);
  equal("past Unlock the startup step exits 1", refused.code, 1);
  check("and says why", /The cutover stage is Unlocked/.test(refused.output), refused.output);
  equal("and leaves the stage Unlocked", (await one(sql`select stage from cutover_state`))?.stage, "unlocked");
  await sql`update cutover_state set stage = 'shadow'`;

  const app = await startApp(url);
  const browser = await launchBrowser();
  let crashed = null;
  try {
    await scenarios(browser, ids);
  } catch (error) {
    crashed = error;
    const pages = await browser.pages();
    await Promise.all(pages.map((page, index) => shot(page, `crash-${index}`).catch(() => {})));
  } finally {
    await browser.close().catch(() => {});
    app.child.kill();
    auth.close();
    await sql.end();
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} checks passed.`);
  for (const result of failed) console.log(`  FAILED: ${result.scenario} > ${result.name}`);
  if (crashed) console.log(`\nThe run stopped early:\n${crashed.stack ?? crashed}\n\nApp output:\n${app.output().slice(-3000)}`);
  console.log(`Screenshots: ${shots}`);
  process.exit(failed.length === 0 && !crashed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
