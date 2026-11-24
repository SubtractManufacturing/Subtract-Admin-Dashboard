/**
 * Check (ADR-0014): every place where a Sync would change something. Runs in
 * a read-only transaction, so it cannot write even by mistake.
 */
import { db } from "../db";
import {
  AREA_LABELS,
  computeChanges,
  toDifference,
  type ChangeSet,
  type Difference,
  type DifferenceArea,
} from "./differences";
import { loadSnapshot } from "./snapshot.server";

export type CheckReport = {
  checkedAt: Date;
  /** The headline: 0 is the precondition for Switch and for Unlock. */
  total: number;
  /** Differences the next Sync removes. */
  fixable: number;
  /** Differences Sync will not touch; a developer has to look. */
  notFixable: number;
  byArea: Array<{ area: DifferenceArea; label: string; count: number }>;
  differences: Difference[];
  counts: ChangeSet["counts"];
};

export function summarize(changeSet: ChangeSet, checkedAt = new Date()): CheckReport {
  const differences = changeSet.changes.map(toDifference);
  const byArea = new Map<DifferenceArea, number>();
  for (const difference of differences) {
    byArea.set(difference.area, (byArea.get(difference.area) ?? 0) + 1);
  }
  const fixable = differences.filter((difference) => difference.fixable).length;
  return {
    checkedAt,
    total: differences.length,
    fixable,
    notFixable: differences.length - fixable,
    byArea: (Object.keys(AREA_LABELS) as DifferenceArea[])
      .filter((area) => byArea.has(area))
      .map((area) => ({ area, label: AREA_LABELS[area], count: byArea.get(area)! })),
    differences,
    counts: changeSet.counts,
  };
}

export async function runCheck(): Promise<CheckReport> {
  const changeSet = await db.transaction(
    async (tx) => computeChanges(await loadSnapshot(tx)),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
  return summarize(changeSet);
}
