import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { Merge } from "lucide-react";
import { useState } from "react";

import { CustomerMergeReview } from "~/components/customers/CustomerMergeReview";
import { CustomMergeModal } from "~/components/customers/CustomMergeModal";
import { DuplicatePairCard } from "~/components/customers/DuplicatePairCard";
import { MatchFilterChips } from "~/components/customers/MatchFilterChips";
import SearchHeader from "~/components/SearchHeader";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import {
  findDuplicatePairs,
  getActiveCustomerSummaries,
  mergeCustomers,
  pairsAmong,
  previewMerge,
  type MergeActor,
} from "~/lib/customer-merge.server";
import { CustomerMergeError } from "~/lib/customer-merge-error";
import type { MergeChoices } from "~/lib/customer-merge-fields";
import { getCustomers } from "~/lib/customers";
import {
  parseMatchKinds,
  type DuplicatePairView,
  type DuplicateReasonKind,
  type MergeFieldChoice,
  type MergePreviewView,
} from "~/lib/customer-merge-view";

const PAGE_SIZE = 10;
const MAX_LIMIT = 200;

function parseIds(value: string | null): number[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((part) => Number.parseInt(part, 10))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  ];
}

function parseId(value: FormDataEntryValue | string | null): number | null {
  const id = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseLimit(value: string | null): number {
  const limit = Number.parseInt(value ?? "", 10);
  return Number.isInteger(limit) && limit > 0
    ? Math.min(Math.max(limit, PAGE_SIZE), MAX_LIMIT)
    : PAGE_SIZE;
}

function actorFrom(userDetails: {
  id: string;
  email?: string | null;
  role: MergeActor["role"];
}): MergeActor {
  return { userId: userDetails.id, email: userDetails.email, role: userDetails.role };
}

function requireElevatedRole(role: MergeActor["role"]) {
  if (role !== "Admin" && role !== "Dev") {
    throw new Response("Admin or Dev role required", { status: 403 });
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  requireElevatedRole(userDetails.role);
  const url = new URL(request.url);

  // Merge review dialog: only the preview is needed.
  if (url.searchParams.get("preview")) {
    const survivorId = parseId(url.searchParams.get("survivor"));
    const mergedId = parseId(url.searchParams.get("merged"));
    if (!survivorId || !mergedId) {
      return withAuthHeaders(json({ error: "Choose two Customers to merge" }, { status: 400 }), headers);
    }
    try {
      return withAuthHeaders(json({ preview: await previewMerge({ survivorId, mergedId }) }), headers);
    } catch (error) {
      if (!(error instanceof CustomerMergeError)) throw error;
      return withAuthHeaders(json({ error: error.message }, { status: error.status }), headers);
    }
  }

  const kinds = parseMatchKinds(url.searchParams.get("match"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const candidateIds = parseIds(url.searchParams.get("ids"));
  const [suggestions, candidates, allCustomers] = await Promise.all([
    findDuplicatePairs({ kinds, limit }),
    getActiveCustomerSummaries(candidateIds),
    getCustomers({ sortBy: "name" }),
  ]);

  return withAuthHeaders(
    json({
      suggestions,
      candidatePairs: pairsAmong(candidates),
      candidateIds,
      candidateCount: candidates.length,
      candidateName: candidates[0]?.displayName ?? null,
      kinds,
      limit,
      customerRecords: allCustomers.map((customer) => ({
        id: customer.id,
        displayName: customer.displayName,
        companyName: customer.companyName,
        contactName: customer.contactName,
        email: customer.email,
        phone: customer.phone,
      })),
    }),
    headers,
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  const actor = actorFrom(userDetails);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  try {
    if (intent !== "merge") {
      return withAuthHeaders(json({ error: "Unknown action" }, { status: 400 }), headers);
    }
    const survivorId = parseId(form.get("survivorId"));
    const mergedId = parseId(form.get("mergedId"));
    if (!survivorId || !mergedId) {
      return withAuthHeaders(json({ error: "Choose two Customers to merge" }, { status: 400 }), headers);
    }
    const choices: MergeChoices = {};
    for (const [key, value] of form.entries()) {
      if (key.startsWith("choice:") && (value === "survivor" || value === "merged")) {
        choices[key.slice("choice:".length) as keyof MergeChoices] = value;
      }
    }
    const survivorUpdatedAt = new Date(String(form.get("survivorUpdatedAt")));
    const mergedUpdatedAt = new Date(String(form.get("mergedUpdatedAt")));
    // Fail closed: a merge without the previewed timestamps could silently
    // overwrite edits made since the preview was shown.
    if (Number.isNaN(survivorUpdatedAt.getTime()) || Number.isNaN(mergedUpdatedAt.getTime())) {
      throw new CustomerMergeError("Preview is missing or invalid; review the merge again", 400);
    }
    await mergeCustomers(
      {
        survivorId,
        mergedId,
        choices,
        expected: { survivorUpdatedAt, mergedUpdatedAt },
      },
      actor,
    );
    return withAuthHeaders(redirect(`/customers/${survivorId}`), headers);
  } catch (error) {
    if (!(error instanceof CustomerMergeError)) throw error;
    return withAuthHeaders(json({ error: error.message }, { status: error.status }), headers);
  }
}

type PreviewResponse = { preview?: MergePreviewView; error?: string };

export default function CustomerMerge() {
  const {
    suggestions,
    candidatePairs,
    candidateIds,
    candidateCount,
    candidateName,
    kinds,
    limit,
    customerRecords,
  } = useLoaderData<typeof loader>();
  const previewFetcher = useFetcher<PreviewResponse>();
  const mergeFetcher = useFetcher<{ error?: string }>();
  const navigation = useNavigation();

  const [reviewing, setReviewing] = useState<{ survivorId: number; mergedId: number } | null>(null);
  const [customMergeOpen, setCustomMergeOpen] = useState(false);

  const openReview = (survivorId: number, mergedId: number) => {
    setReviewing({ survivorId, mergedId });
    previewFetcher.load(
      `/customers/merge?preview=1&survivor=${survivorId}&merged=${mergedId}`,
    );
  };
  const closeReview = () => setReviewing(null);
  const swapReview = () => {
    if (reviewing) openReview(reviewing.mergedId, reviewing.survivorId);
  };

  // A merge redirects to the survivor on success; only errors come back here.
  // The fetcher keeps its last response while a new preview loads, so only
  // trust it once it describes the pair on screen.
  const loaded = previewFetcher.data?.preview;
  const preview =
    loaded &&
    reviewing &&
    loaded.survivor.id === reviewing.survivorId &&
    loaded.merged.id === reviewing.mergedId
      ? loaded
      : undefined;
  const previewError = previewFetcher.state === "idle" ? previewFetcher.data?.error : undefined;

  const confirm = (choices: Record<string, MergeFieldChoice>) => {
    if (!reviewing || !preview) return;
    const payload: Record<string, string> = {
      intent: "merge",
      survivorId: String(reviewing.survivorId),
      mergedId: String(reviewing.mergedId),
      survivorUpdatedAt: new Date(preview.survivorUpdatedAt).toISOString(),
      mergedUpdatedAt: new Date(preview.mergedUpdatedAt).toISOString(),
    };
    for (const [field, choice] of Object.entries(choices)) {
      payload[`choice:${field}`] = choice;
    }
    mergeFetcher.submit(payload, { method: "post" });
  };

  // Filter and paging links keep the Action Item's candidates on screen.
  const hrefWith = (nextKinds: DuplicateReasonKind[], nextLimit?: number) => {
    const params = new URLSearchParams();
    if (candidateIds.length > 0) params.set("ids", candidateIds.join(","));
    if (nextKinds.length > 0) params.set("match", nextKinds.join(","));
    if (nextLimit) params.set("limit", String(nextLimit));
    const query = params.toString();
    return query ? `/customers/merge?${query}` : "/customers/merge";
  };
  const hrefFor = (nextKinds: DuplicateReasonKind[]) => hrefWith(nextKinds);
  const showMoreHref = hrefWith(kinds, limit + PAGE_SIZE);

  const pairs = suggestions.pairs as DuplicatePairView[];
  const candidates = candidatePairs as DuplicatePairView[];
  const shown = pairs.length;

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader
        hideSearch
        beforeSearch={
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {suggestions.total === 0
              ? "No matches"
              : `Showing ${shown} of ${suggestions.total}, best matches first`}
          </p>
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Customers", href: "/customers" },
          { label: "Merge duplicates" },
        ]}
      />

      <div className="px-4 pb-6 pt-1 sm:px-6 lg:px-10">
        <div>
          <div className="min-w-0 space-y-8">
            {candidateCount > 0 && (
              <section aria-labelledby="candidates-heading" className="space-y-3">
                <h3 id="candidates-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  From the Action Item
                </h3>
                {candidateCount === 1 && (
                  <p className="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
                    Those Customers have already been merged into {candidateName}.
                  </p>
                )}
                {candidates.map((pair) => (
                  <DuplicatePairCard
                    key={`candidate-${pair.a.id}-${pair.b.id}`}
                    pair={pair}
                    onReview={openReview}
                  />
                ))}
              </section>
            )}

            <section aria-label="Suggested duplicates" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <MatchFilterChips
                  selected={kinds}
                  counts={suggestions.kindCounts}
                  hrefFor={hrefFor}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="inline-flex items-center gap-2"
                  onClick={() => setCustomMergeOpen(true)}
                >
                  <Merge className="h-4 w-4" aria-hidden="true" />
                  Custom merge
                </Button>
              </div>
              {kinds.length > 1 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Only pairs that match on every selected type are shown.
                </p>
              )}

              {pairs.length === 0 ? (
                <p className="rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-600 dark:border-gray-600 dark:text-gray-400">
                  {kinds.length > 0
                    ? "No Customers match on every selected type."
                    : "No likely duplicates found."}
                </p>
              ) : (
                <div className="space-y-4">
                  {pairs.map((pair) => (
                    <DuplicatePairCard
                      key={`${pair.a.id}-${pair.b.id}`}
                      pair={pair}
                      onReview={openReview}
                    />
                  ))}
                </div>
              )}

              {shown < suggestions.total && (
                <div className="text-center">
                  <Link
                    to={showMoreHref}
                    preventScrollReset
                    replace
                    className="inline-block rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
                  >
                    {`Show ${Math.min(PAGE_SIZE, suggestions.total - shown)} more`}
                  </Link>
                </div>
              )}
            </section>
          </div>

        </div>
      </div>

      <CustomMergeModal
        isOpen={customMergeOpen}
        onClose={() => setCustomMergeOpen(false)}
        customers={customerRecords}
        onReview={openReview}
      />

      <Modal
        isOpen={reviewing !== null}
        onClose={closeReview}
        title="Review merge"
        size="xl"
        zIndex={60}
      >
        {!preview && !previewError && (
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        )}
        {previewError && !preview && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-800 dark:text-red-200">
              {previewError}
            </p>
            <Button type="button" variant="secondary" onClick={closeReview}>
              Close
            </Button>
          </div>
        )}
        {preview && reviewing && (
          <CustomerMergeReview
            // A new preview means new defaults, so remount the choices.
            key={`${preview.survivor.id}-${preview.merged.id}-${String(preview.mergedUpdatedAt)}`}
            preview={preview}
            onConfirm={confirm}
            onCancel={closeReview}
            onSwap={swapReview}
            isSubmitting={mergeFetcher.state !== "idle" || navigation.state !== "idle"}
            error={mergeFetcher.data?.error}
          />
        )}
      </Modal>
    </div>
  );
}
