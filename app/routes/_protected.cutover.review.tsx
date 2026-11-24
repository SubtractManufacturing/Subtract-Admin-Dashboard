import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Breadcrumbs from "~/components/Breadcrumbs";
import Button from "~/components/shared/Button";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { assertAuthorized } from "~/lib/authorization/authorize";
import {
  REVIEW_FLAGS,
  blankToNull,
  firstNameFromEmail,
  mapLegacyNames,
  reviewFlags,
  reviewSuggestions,
  type LegacyType,
  type ReviewSuggestionFields,
} from "~/lib/organizations/mapping";
import {
  clearReview,
  loadReviewRows,
  ReviewError,
  saveReview,
  type ReviewRow,
} from "~/lib/organizations/review.server";

/**
 * Staged cutover (ADR-0014): the review list. Admin and Dev only. A save
 * corrects the old Customer or Vendor through today's update functions.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  const { actor, headers } = await requireAuth(request);
  assertAuthorized(actor, "cutover.view");
  return withAuthHeaders(json({ rows: await loadReviewRows() }), headers);
}

type NameValues = { displayName: string; companyName: string | null; contactName: string | null };

function parseNames(value: FormDataEntryValue | null, partial: boolean): Partial<NameValues> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(value ?? ""));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const source = parsed as Record<string, unknown>;
  const names: Partial<NameValues> = {};
  for (const field of ["displayName", "companyName", "contactName"] as const) {
    const fieldValue = source[field];
    if (fieldValue === undefined) {
      if (partial) continue;
      return null;
    }
    if (typeof fieldValue === "string") names[field] = fieldValue;
    else if (fieldValue === null && field !== "displayName") names[field] = null;
    else return null;
  }
  return names;
}

export async function action({ request }: ActionFunctionArgs) {
  const { actor, headers } = await requireAuth(request);
  assertAuthorized(actor, "cutover.review");

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const type = form.get("type");
  const id = Number.parseInt(String(form.get("id") ?? ""), 10);
  const fail = (status: number, error: string) =>
    withAuthHeaders(json({ ok: false as const, error }, { status }), headers);

  if ((type !== "customer" && type !== "vendor") || !Number.isInteger(id) || id <= 0) {
    return fail(400, "Unknown record");
  }
  const legacyType: LegacyType = type;

  if (intent === "clear") {
    await clearReview(legacyType, id);
    return withAuthHeaders(json({ ok: true as const, changedFields: [] as string[] }), headers);
  }
  if (intent !== "save") return fail(400, "Unknown action");

  const seen = parseNames(form.get("seen"), false) as NameValues | null;
  const changes = parseNames(form.get("changes"), true);
  if (!seen || !changes) return fail(400, "The form was not understood. Reload the list.");

  try {
    const saved = await saveReview(
      { type: legacyType, id, seen, changes },
      { userId: actor.userId, email: actor.email },
    );
    return withAuthHeaders(
      json({ ok: true as const, changedFields: saved.changedFields as string[] }),
      headers,
    );
  } catch (error) {
    if (!(error instanceof ReviewError)) throw error;
    return fail(error.status, error.message);
  }
}

type RowView = Omit<ReviewRow, "reviewedAt"> & { reviewedAt: string | null };

const rowKey = (row: { type: LegacyType; id: number }) => `${row.type}:${row.id}`;

const input =
  "h-9 w-full rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
const chip = "rounded px-1.5 py-0.5 text-xs font-medium";

type FormValues = { displayName: string; companyName: string; contactName: string };

const valuesOf = (row: RowView): FormValues => ({
  displayName: row.displayName,
  companyName: row.companyName ?? "",
  contactName: row.contactName ?? "",
});

function ReviewRowForm({
  row,
  onReviewed,
  onTouched,
}: {
  row: RowView;
  onReviewed: (key: string) => void;
  onTouched: (key: string) => void;
}) {
  const key = rowKey(row);
  const fetcher = useFetcher<typeof action>();
  const [values, setValues] = useState<FormValues>(() => valuesOf(row));

  // The old row changed underneath (a save here, or someone in the app):
  // show what is stored now.
  useEffect(() => {
    setValues(valuesOf(row));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.displayName, row.companyName, row.contactName]);

  const stored = valuesOf(row);
  const dirty = (Object.keys(stored) as Array<keyof FormValues>).filter(
    (field) => values[field] !== stored[field],
  );
  const preview = mapLegacyNames(values);
  const storedPreview = mapLegacyNames(row);
  const previewChanged =
    preview.kind !== storedPreview.kind ||
    preview.organizationName !== storedPreview.organizationName ||
    preview.contactName !== storedPreview.contactName;
  const flags = reviewFlags({ ...values, email: row.email });
  const suggestions = reviewSuggestions({ ...values, email: row.email });
  const nameHint =
    blankToNull(values.contactName) === null ? firstNameFromEmail(row.email) : null;

  const busy = fetcher.state !== "idle";
  const handled = useRef<unknown>(null);
  const lastIntent = useRef<"save" | "clear" | null>(null);
  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || handled.current === fetcher.data) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok && lastIntent.current === "save") onReviewed(key);
  }, [fetcher.state, fetcher.data, key, onReviewed]);

  const set = (field: keyof FormValues, value: string) =>
    setValues((current) => ({ ...current, [field]: value }));
  const apply = (fields: ReviewSuggestionFields) =>
    setValues((current) => ({
      ...current,
      ...(fields.companyName !== undefined ? { companyName: fields.companyName ?? "" } : {}),
      ...(fields.contactName !== undefined ? { contactName: fields.contactName ?? "" } : {}),
    }));

  const save = () => {
    onTouched(key);
    lastIntent.current = "save";
    const changes: Partial<FormValues> = {};
    for (const field of dirty) changes[field] = values[field];
    fetcher.submit(
      {
        intent: "save",
        type: row.type,
        id: String(row.id),
        seen: JSON.stringify({
          displayName: row.displayName,
          companyName: row.companyName,
          contactName: row.contactName,
        }),
        changes: JSON.stringify(changes),
      },
      { method: "post" },
    );
  };
  const clear = () => {
    onTouched(key);
    lastIntent.current = "clear";
    fetcher.submit({ intent: "clear", type: row.type, id: String(row.id) }, { method: "post" });
  };

  const label = row.type === "customer" ? "Customer" : "Vendor";
  const state = dirty.length > 0 ? "edited" : row.reviewed ? "reviewed" : "to-review";

  return (
    <form
      data-testid="review-row"
      data-review-row={key}
      data-state={state}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && (dirty.length > 0 || !row.reviewed)) save();
      }}
      className={`grid gap-x-3 gap-y-2 border-b border-gray-200 px-4 py-3 text-sm dark:border-gray-700 lg:grid-cols-[9rem_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_9.5rem] ${
        row.reviewed && dirty.length === 0 ? "bg-green-50/50 dark:bg-green-950/20" : ""
      }`}
    >
      <div className="min-w-0">
        <Link
          to={row.type === "customer" ? `/customers/${row.id}` : `/vendors/${row.id}`}
          className="font-semibold text-blue-600 hover:underline dark:text-blue-400"
          tabIndex={-1}
        >
          {label} #{row.id}
        </Link>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400" title={row.email ?? ""}>
          {row.email ?? "no email"}
        </p>
      </div>

      {(
        [
          ["displayName", "Display name"],
          ["companyName", "Company"],
          ["contactName", "Contact"],
        ] as const
      ).map(([field, fieldLabel]) => (
        <label key={field} className="min-w-0">
          <span className="sr-only lg:hidden">{fieldLabel}</span>
          <span className="mb-0.5 block text-xs text-gray-500 dark:text-gray-400 lg:hidden" aria-hidden="true">
            {fieldLabel}
          </span>
          <input
            name={field}
            aria-label={`${fieldLabel} of ${label} ${row.id}`}
            value={values[field]}
            onChange={(event) => set(field, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && dirty.length > 0) setValues(stored);
            }}
            required={field === "displayName"}
            autoComplete="off"
            className={`${input} ${dirty.includes(field) ? "border-blue-500 ring-1 ring-blue-500" : ""}`}
          />
        </label>
      ))}

      <div className="min-w-0" data-testid="result" aria-live="polite">
        <p className="flex flex-wrap items-center gap-1.5">
          <span
            data-testid="result-kind"
            className={`${chip} ${
              preview.kind === "business"
                ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                : "bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100"
            }`}
          >
            {preview.kind === "business" ? "Business" : "Individual"}
          </span>
          <span data-testid="result-organization" className="break-words font-semibold text-gray-900 dark:text-gray-100">
            {preview.organizationName || "(no name)"}
          </span>
          {previewChanged && (
            <span className={`${chip} bg-blue-600 text-white`}>after save</span>
          )}
        </p>
        <p className="text-gray-700 dark:text-gray-300">
          Contact:{" "}
          <span data-testid="result-contact" className="font-medium">
            {preview.contactName ?? "(unnamed)"}
          </span>
        </p>
      </div>

      <div className="flex flex-col items-stretch gap-1">
        {dirty.length > 0 || !row.reviewed ? (
          <Button type="submit" size="sm" disabled={busy} data-testid="save">
            {busy ? "Saving…" : dirty.length > 0 ? "Save" : "Looks right"}
          </Button>
        ) : (
          <p data-testid="reviewed-mark" className="py-1 text-center text-sm font-semibold text-green-700 dark:text-green-400" title={row.reviewedBy ? `by ${row.reviewedBy}` : undefined}>
            Reviewed
          </p>
        )}
        {dirty.length > 0 ? (
          <button type="button" onClick={() => setValues(stored)} className="text-xs text-gray-600 hover:underline dark:text-gray-400">
            Reset
          </button>
        ) : row.reviewed ? (
          <button type="button" onClick={clear} disabled={busy} data-testid="undo-review" className="text-xs text-gray-600 hover:underline dark:text-gray-400">
            Undo
          </button>
        ) : null}
      </div>

      {(flags.length > 0 || suggestions.length > 0 || nameHint || (fetcher.data && !fetcher.data.ok)) && (
        <div className="flex flex-wrap items-center gap-1.5 lg:col-span-5 lg:col-start-2">
          {flags.map((flag) => (
            <span key={flag} data-testid="flag" data-flag={flag} className={`${chip} bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100`}>
              {REVIEW_FLAGS[flag]}
            </span>
          ))}
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              data-testid="suggestion"
              data-suggestion={suggestion.id}
              onClick={() => apply(suggestion.fields)}
              className={`${chip} border border-blue-600 text-blue-700 hover:bg-blue-50 dark:border-blue-400 dark:text-blue-300 dark:hover:bg-blue-950`}
            >
              Fill in: {suggestion.label}
            </button>
          ))}
          {nameHint && (
            <button
              type="button"
              data-testid="name-hint"
              onClick={() => apply({ contactName: nameHint })}
              className={`${chip} border border-gray-400 text-gray-700 hover:bg-gray-100 dark:border-gray-500 dark:text-gray-300 dark:hover:bg-gray-700`}
              title="Read from the email address. Fills in the contact name; nothing is saved until you save."
            >
              Hint from the email: {nameHint}
            </button>
          )}
          {fetcher.data && !fetcher.data.ok && (
            <span role="alert" data-testid="row-error" className="text-sm font-medium text-red-700 dark:text-red-300">
              {fetcher.data.error}
            </span>
          )}
        </div>
      )}
    </form>
  );
}

export default function CutoverReview() {
  const rows = useLoaderData<typeof loader>().rows as RowView[];

  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [unreviewedOnly, setUnreviewedOnly] = useState(false);
  const [type, setType] = useState<"all" | LegacyType>("all");
  const [query, setQuery] = useState("");
  // Rows the reviewer acted on stay in view under the current filters, so
  // saving a row never makes the list jump.
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const resetTouched = () => setTouched(new Set());

  // The order of the first load is kept for the whole sitting, even when a
  // save changes a display name.
  const order = useRef<Map<string, number> | null>(null);
  if (order.current === null) order.current = new Map(rows.map((row, index) => [rowKey(row), index]));
  for (const row of rows) {
    if (!order.current.has(rowKey(row))) order.current.set(rowKey(row), order.current.size);
  }

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (touched.has(rowKey(row))) return true;
        if (type !== "all" && row.type !== type) return false;
        if (unreviewedOnly && row.reviewed) return false;
        if (flaggedOnly && reviewFlags(row).length === 0) return false;
        if (!needle) return true;
        return [row.displayName, row.companyName, row.contactName, row.email]
          .some((value) => (value ?? "").toLowerCase().includes(needle));
      })
      .sort((a, b) => order.current!.get(rowKey(a))! - order.current!.get(rowKey(b))!);
  }, [rows, touched, type, unreviewedOnly, flaggedOnly, query]);

  const reviewed = rows.filter((row) => row.reviewed).length;
  const flagged = rows.filter((row) => reviewFlags(row).length > 0);
  const flaggedLeft = flagged.filter((row) => !row.reviewed).length;

  const visibleKeys = useRef<string[]>([]);
  visibleKeys.current = visible.map(rowKey);

  const onTouched = useCallback((key: string) => {
    setTouched((current) => (current.has(key) ? current : new Set(current).add(key)));
  }, []);
  // After a save, move on to the next row in the list.
  const onReviewed = useCallback((key: string) => {
    const keys = visibleKeys.current;
    const next = keys[keys.indexOf(key) + 1];
    if (!next) return;
    document
      .querySelector<HTMLInputElement>(`[data-review-row="${next}"] input[name="companyName"]`)
      ?.focus();
  }, []);

  const toggle = "flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200";

  return (
    <div className="mx-auto max-w-[1920px]">
      <div className="px-10 py-2.5">
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/" },
            { label: "Cutover", href: "/cutover" },
            { label: "Review list" },
          ]}
        />
      </div>
      <div className="space-y-4 px-4 pb-16 sm:px-6 lg:px-10">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Review list</h1>
          <p className="max-w-4xl text-sm text-gray-600 dark:text-gray-400">
            Each active Customer and Vendor, beside the Organization, type and Contact it becomes.
            Correct the display name, company and contact, or confirm the row as it is. A save
            changes the Customer or Vendor itself, exactly as the Customer form does, and staff see
            it straight away. Press Enter in a row to save it and move to the next; Escape undoes
            what you typed.
          </p>
        </header>

        <div className="sticky top-0 z-10 space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100" data-testid="progress">
              {reviewed} of {rows.length} reviewed
              <span className="ml-2 font-normal text-gray-600 dark:text-gray-400" data-testid="progress-flagged">
                {flaggedLeft} of {flagged.length} flagged rows still to review
              </span>
            </p>
            <div
              role="progressbar"
              aria-label="Rows reviewed"
              aria-valuemin={0}
              aria-valuemax={rows.length}
              aria-valuenow={reviewed}
              className="mt-2 h-2 overflow-hidden rounded bg-gray-200 dark:bg-gray-700"
            >
              <div
                className="h-full bg-green-600"
                style={{ width: `${rows.length === 0 ? 0 : (reviewed / rows.length) * 100}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className={toggle}>
              <input
                type="checkbox"
                data-testid="filter-flagged"
                checked={flaggedOnly}
                onChange={(event) => {
                  setFlaggedOnly(event.target.checked);
                  resetTouched();
                }}
              />
              Flagged only
            </label>
            <label className={toggle}>
              <input
                type="checkbox"
                data-testid="filter-unreviewed"
                checked={unreviewedOnly}
                onChange={(event) => {
                  setUnreviewedOnly(event.target.checked);
                  resetTouched();
                }}
              />
              Unreviewed only
            </label>
            <label className={toggle}>
              Show
              <select
                data-testid="filter-type"
                value={type}
                onChange={(event) => {
                  setType(event.target.value as "all" | LegacyType);
                  resetTouched();
                }}
                className="h-9 rounded border border-gray-300 bg-white px-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="all">Customers and Vendors</option>
                <option value="customer">Customers</option>
                <option value="vendor">Vendors</option>
              </select>
            </label>
            <label className={`${toggle} min-w-[14rem] flex-1`}>
              <span className="sr-only">Search</span>
              <input
                type="search"
                data-testid="filter-search"
                placeholder="Search name, company, contact or email"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetTouched();
                }}
                className={input}
              />
            </label>
            <span className="text-sm text-gray-600 dark:text-gray-400" data-testid="showing">
              Showing {visible.length} of {rows.length}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="hidden gap-x-3 border-b border-gray-200 bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300 lg:grid lg:grid-cols-[9rem_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_9.5rem]">
            <span>Record</span>
            <span>Display name</span>
            <span>Company</span>
            <span>Contact</span>
            <span>Becomes</span>
            <span />
          </div>
          {visible.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-gray-600 dark:text-gray-400">
              No rows match these filters.
            </p>
          ) : (
            visible.map((row) => (
              <ReviewRowForm
                key={rowKey(row)}
                row={row}
                onReviewed={onReviewed}
                onTouched={onTouched}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
