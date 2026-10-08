import { Link } from "@remix-run/react";

import {
  candidateIdsFromMetadata,
  customerMergeHref,
} from "~/lib/customer-merge-view";

/** Replaces the old "Resolve" button: go straight to the merge tool. */
export function CustomerMatchReviewLink({
  metadata,
  canMerge = true,
}: {
  metadata: Record<string, unknown> | null | undefined;
  /** Only Admin and Dev can use the merge tool. */
  canMerge?: boolean;
}) {
  if (!canMerge) {
    return (
      <span className="text-sm text-gray-500">Needs an Admin or Dev to review</span>
    );
  }
  return (
    <Link
      to={customerMergeHref(candidateIdsFromMetadata(metadata))}
      className="text-sm font-semibold text-green-700 dark:text-green-400"
    >
      Review &amp; merge
    </Link>
  );
}
