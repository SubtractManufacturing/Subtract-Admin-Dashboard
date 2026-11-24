# Cutover Shadow part 1: browser run

A scripted Puppeteer run of the cutover status page and review list
(ADR-0014) against the production build. It is not part of `npm test` or CI;
run it by hand before a release that touches the cutover.

It **empties the database it is given**, so it accepts only a Postgres on
`127.0.0.1` or `localhost`, and refuses to start when the repository has a
`.env`. The app server runs behind `guard.mjs`, which blocks every network
connection that is not local. Sign-in is a small fake Supabase auth server in
the runner. All names and emails are made up.

```sh
# 1. A throwaway Postgres (pg-boss wants SSL, hence the snakeoil certificate).
MSYS_NO_PATHCONV=1 docker run -d --name cutover-e2e-pg -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15471:5432 \
  postgres:16 -c ssl=on -c ssl_cert_file=/etc/ssl/certs/ssl-cert-snakeoil.pem \
  -c ssl_key_file=/etc/ssl/private/ssl-cert-snakeoil.key
docker exec cutover-e2e-pg psql -U postgres -c "create database cutover_e2e"
export E2E_DATABASE_URL=postgres://postgres:e2e@127.0.0.1:15471/cutover_e2e

# 2. The schema and the build.
DATABASE_URL=$E2E_DATABASE_URL npx drizzle-kit push --force
npm run build

# 3. The run. Exit code 0 means every check passed.
node scripts/e2e-cutover/run.mjs
```

Screenshots go to `scripts/e2e-cutover/shots/` (ignored by git), or to
`E2E_SHOTS`. Ports: `E2E_WEB_PORT` (15480) and `E2E_AUTH_PORT` (15481).

What it covers:

1. Admin opens the status page from the Customers page, sees stage Shadow and
   the old tables as live, runs Sync, sees Check at 0.
2. A Customer is edited in today's Customer form, another archived from the
   list, two merged with today's merge tool. Check lists each difference with a
   working link; Sync clears them; no account, Organization or Contact id
   changes.
3. Review list: flags equal the precheck query's; a suggestion and the email
   hint fill fields and save nothing; the result follows the typing; a save
   changes only the edited fields and writes the Customer Event log; mark as
   right; clearing company and contact; filters, search and progress; order,
   focus and scroll position after a save; undo.
4. A reviewed mark stays after an unrelated edit in the Customer form and
   resets after a contact-name edit.
5. Vendors: flag, suggestion, save through the Vendor update, mark, reset.
6. A User-role login sees no link and no mention of the cutover on any page,
   and every cutover URL and action answers 403 and changes nothing.
7. Today's app as a User-role login: Customers and Vendors lists and pages, an
   edit, a new Quote, a Quote converted to an Order, with no console errors
   and no failed requests; Check then lists the new Quote and Order and Sync
   clears them.
