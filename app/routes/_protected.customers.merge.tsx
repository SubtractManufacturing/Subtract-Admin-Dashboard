import { json, redirect } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { Link, useFetcher, useLoaderData, useNavigation } from "@remix-run/react";
import { useState } from "react";

import { CustomerMergeReview } from "~/components/customers/CustomerMergeReview";
import { DuplicateGroupCard } from "~/components/customers/DuplicateGroupCard";
import SearchHeader from "~/components/SearchHeader";
import Button from "~/components/shared/Button";
import Modal from "~/components/shared/Modal";
import SearchableSelect from "~/components/shared/SearchableSelect";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import {
  dismissCustomerGroup,
  findDuplicateGroups,
  getActiveCustomerSummaries,
  mergeCustomers,
  previewMerge,
  undismissPair,
  type MergeActor,
} from "~/lib/customer-merge.server";
import { CustomerMergeError } from "~/lib/customer-merge-error";
import type { MergeChoices } from "~/lib/customer-merge-fields";
import { getCustomers } from "~/lib/customers";
import type {
  DuplicateGroupView,
  MergeFieldChoice,
  MergePreviewView,
} from "~/lib/customer-merge-view";

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

  const includeDismissed = url.searchParams.get("showDismissed") === "1";
  const candidateIds = parseIds(url.searchParams.get("ids"));
  const [groups, candidates, allCustomers] = await Promise.all([
    findDuplicateGroups({ includeDismissed }),
    getActiveCustomerSummaries(candidateIds),
    getCustomers({ sortBy: "name" }),
  ]);

  return withAuthHeaders(
    json({
      groups,
      candidates,
      includeDismissed,
      initialSurvivorId: parseId(url.searchParams.get("survivor")),
      customerOptions: allCustomers.map((customer) => ({
        value: String(customer.id),
        label: customer.displayName,
        secondaryLabel: customer.email ?? customer.companyName ?? undefined,
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
    if (intent === "merge") {
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
    }

    if (intent === "dismiss") {
      await dismissCustomerGroup(parseIds(String(form.get("ids") ?? "")), actor);
    } else if (intent === "undismiss") {
      const a = parseId(form.get("a"));
      const b = parseId(form.get("b"));
      if (a && b) await undismissPair(a, b, actor);
    } else {
      return withAuthHeaders(json({ error: "Unknown action" }, { status: 400 }), headers);
    }
    return withAuthHeaders(json({ ok: true }), headers);
  } catch (error) {
    if (!(error instanceof CustomerMergeError)) throw error;
    return withAuthHeaders(json({ error: error.message }, { status: error.status }), headers);
  }
}

type PreviewResponse = { preview?: MergePreviewView; error?: string };

export default function CustomerMerge() {
  const { groups, candidates, includeDismissed, initialSurvivorId, customerOptions } =
    useLoaderData<typeof loader>();
  const previewFetcher = useFetcher<PreviewResponse>();
  const mergeFetcher = useFetcher<{ error?: string }>();
  const decisionFetcher = useFetcher<{ error?: string }>();
  const navigation = useNavigation();

  const [reviewing, setReviewing] = useState<{ survivorId: number; mergedId: number } | null>(null);
  const [survivorPick, setSurvivorPick] = useState(initialSurvivorId ? String(initialSurvivorId) : "");
  const [mergedPick, setMergedPick] = useState("");

  const openReview = (survivorId: number, mergedId: number) => {
    setReviewing({ survivorId, mergedId });
    previewFetcher.load(
      `/customers/merge?preview=1&survivor=${survivorId}&merged=${mergedId}`,
    );
  };
  const closeReview = () => setReviewing(null);

  // A merge redirects to the survivor on success; only errors come back here.
  const preview = previewFetcher.data?.preview;
  const dismiss = (ids: number[]) =>
    decisionFetcher.submit({ intent: "dismiss", ids: ids.join(",") }, { method: "post" });
  const undismiss = (a: number, b: number) =>
    decisionFetcher.submit({ intent: "undismiss", a: String(a), b: String(b) }, { method: "post" });

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

  const canPickPair = survivorPick && mergedPick && survivorPick !== mergedPick;
  const groupsView = groups as { sameEmail: DuplicateGroupView[]; possible: DuplicateGroupView[] };
  const candidateGroup: DuplicateGroupView | null =
    candidates.length > 1
      ? { customers: candidates, reasons: [], dismissedPairs: [] }
      : null;
  const decisionError = decisionFetcher.data?.error;

  const renderGroups = (list: DuplicateGroupView[], empty: string) =>
    list.length === 0 ? (
      <p className="text-sm text-gray-600 dark:text-gray-400">{empty}</p>
    ) : (
      <div className="space-y-4">
        {list.map((group) => (
          <DuplicateGroupCard
            key={group.customers.map((customer) => customer.id).join("-")}
            group={group}
            onReview={openReview}
            onDismiss={dismiss}
            onUndismiss={undismiss}
          />
        ))}
      </div>
    );

  return (
    <div className="max-w-[1920px] mx-auto">
      <SearchHeader
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Customers", href: "/customers" },
          { label: "Merge duplicates" },
        ]}
      />

      <div className="space-y-8 px-4 py-6 sm:px-6 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            Merge duplicate Customers
          </h2>
          <Link
            className="text-sm text-blue-600 underline dark:text-blue-400"
            to={includeDismissed ? "/customers/merge" : "/customers/merge?showDismissed=1"}
          >
            {includeDismissed ? "Hide dismissed" : "Show dismissed"}
          </Link>
        </div>

        {decisionError && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            {decisionError}
          </p>
        )}

        {candidateGroup && (
          <section aria-labelledby="candidates-heading" className="space-y-3">
            <h3 id="candidates-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              From the Action Item
            </h3>
            <DuplicateGroupCard group={candidateGroup} onReview={openReview} onDismiss={dismiss} />
          </section>
        )}
        {candidates.length === 1 && (
          <p className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200">
            Those Customers have already been merged into {candidates[0].displayName}.
          </p>
        )}

        <section aria-labelledby="same-email-heading" className="space-y-3">
          <h3 id="same-email-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Same email
          </h3>
          {renderGroups(groupsView.sameEmail, "No Customers share an email address.")}
        </section>

        <section aria-labelledby="possible-heading" className="space-y-3">
          <h3 id="possible-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Possible duplicates
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Lower confidence: same company name, phone number or contact name.
          </p>
          {renderGroups(groupsView.possible, "No possible duplicates found.")}
        </section>

        <section aria-labelledby="pair-heading" className="space-y-3">
          <h3 id="pair-heading" className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Merge any two Customers
          </h3>
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <SearchableSelect
              label="Keep this Customer"
              value={survivorPick}
              onChange={setSurvivorPick}
              options={customerOptions}
              placeholder="Search Customers"
            />
            <SearchableSelect
              label="Merge this Customer into it"
              value={mergedPick}
              onChange={setMergedPick}
              options={customerOptions}
              placeholder="Search Customers"
            />
          </div>
          <Button
            type="button"
            disabled={!canPickPair}
            onClick={() => openReview(Number(survivorPick), Number(mergedPick))}
          >
            Review merge
          </Button>
        </section>
      </div>

      <Modal isOpen={reviewing !== null} onClose={closeReview} title="Review merge" size="xl">
        {previewFetcher.state === "loading" && !preview && (
          <p className="text-sm text-gray-600 dark:text-gray-400">Loading…</p>
        )}
        {previewFetcher.data?.error && (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-800 dark:text-red-200">
              {previewFetcher.data.error}
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
            isSubmitting={mergeFetcher.state !== "idle" || navigation.state !== "idle"}
            error={mergeFetcher.data?.error}
          />
        )}
      </Modal>
    </div>
  );
}
