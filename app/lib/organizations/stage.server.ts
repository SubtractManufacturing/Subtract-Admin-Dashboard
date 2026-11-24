/**
 * The stage of the staged cutover (ADR-0014): one row in `cutover_state`.
 * Every change of stage goes through {@link setCutoverStage}, which writes an
 * Event log with who made it.
 */
import { desc, eq, and } from "drizzle-orm";

import { db } from "../db";
import { cutoverState, eventLogs, type CutoverStage } from "../db/schema";
import { createEvent } from "../events";

export type { CutoverStage };

/** Cutover events (stage changes, Sync runs) hang off this pseudo-entity. */
export const CUTOVER_EVENT_ENTITY = {
  entityType: "system",
  entityId: "cutover",
} as const;

export const STAGE_CHANGED_EVENT = "cutover_stage_changed";

export const STAGE_LABELS: Record<CutoverStage, string> = {
  shadow: "Shadow",
  switch: "Switch",
  unlocked: "Unlocked",
};

export type StageActor = { userId: string; email?: string | null };

/** How the stage came to change: a person, or a release recording it at start. */
export type StageChangeSource = "user" | "release_start";

export type StageRecord = {
  stage: CutoverStage;
  changedAt: Date;
  changedBy: string | null;
};

/** The recorded stage, or null when no release has recorded one yet. */
export async function getCutoverStage(): Promise<StageRecord | null> {
  const [row] = await db
    .select()
    .from(cutoverState)
    .where(eq(cutoverState.id, 1))
    .limit(1);
  return row
    ? { stage: row.stage, changedAt: row.changedAt, changedBy: row.changedBy }
    : null;
}

export type StageChange = {
  changed: boolean;
  from: CutoverStage | null;
  to: CutoverStage;
};

/**
 * This release was started against a database that is past Unlock. The old
 * tables stopped being written at Unlock, so this release would serve stale
 * data, and recording Shadow would let a Sync overwrite the live tables. The
 * only way back from Unlock is a restore (ADR-0014).
 */
export class CutoverUnlockedError extends Error {
  constructor() {
    super(
      "The cutover stage is Unlocked. This release only works on the old Customer and Vendor tables, which are no longer current. It will not start; restore the database from before Unlock to go back.",
    );
    this.name = "CutoverUnlockedError";
  }
}

/**
 * Set the stage. Writes the row and an Event log in one transaction, and only
 * when the value actually changes, so calling it with the current stage is a
 * no-op.
 */
export async function setCutoverStage(
  stage: CutoverStage,
  options: {
    actor: StageActor | null;
    source: StageChangeSource;
    /** Stages this change must not leave. */
    refuseFrom?: readonly CutoverStage[];
  },
): Promise<StageChange> {
  return db.transaction(async (tx) => {
    // Insert first so two processes starting together cannot both see "no row".
    const inserted = await tx
      .insert(cutoverState)
      .values({ id: 1, stage, changedBy: options.actor?.userId ?? null })
      .onConflictDoNothing()
      .returning({ id: cutoverState.id });

    let from: CutoverStage | null = null;
    if (inserted.length === 0) {
      const [current] = await tx
        .select()
        .from(cutoverState)
        .where(eq(cutoverState.id, 1))
        .for("update");
      from = current.stage;
      if (from === stage) return { changed: false, from, to: stage };
      if (options.refuseFrom?.includes(from)) throw new CutoverUnlockedError();
      await tx
        .update(cutoverState)
        .set({
          stage,
          changedAt: new Date(),
          changedBy: options.actor?.userId ?? null,
        })
        .where(eq(cutoverState.id, 1));
    }

    await createEvent(
      {
        ...CUTOVER_EVENT_ENTITY,
        eventType: STAGE_CHANGED_EVENT,
        eventCategory: "system",
        title: `Cutover stage set to ${STAGE_LABELS[stage]}`,
        description:
          options.source === "release_start"
            ? `This release recorded the stage as ${STAGE_LABELS[stage]} when it started${from ? ` (it was ${STAGE_LABELS[from]})` : ""}.`
            : `The stage changed${from ? ` from ${STAGE_LABELS[from]}` : ""} to ${STAGE_LABELS[stage]}.`,
        metadata: { from, to: stage, source: options.source },
        userId: options.actor?.userId,
        userEmail: options.actor?.email ?? undefined,
      },
      tx,
    );
    return { changed: true, from, to: stage };
  });
}

/**
 * This release serves the old tables only, so every start of it records the
 * stage as Shadow (ADR-0014 "The status page"). That is what turns a redeploy
 * of this release into a complete rollback from Switch.
 *
 * Unlock is the one stage there is no way back from: it throws
 * {@link CutoverUnlockedError} and leaves the stage alone.
 */
export function recordShadowStage(): Promise<StageChange> {
  return setCutoverStage("shadow", {
    actor: null,
    source: "release_start",
    refuseFrom: ["unlocked"],
  });
}

/** The most recent stage change, for the status page. */
export async function getLastStageChange() {
  const [event] = await db
    .select()
    .from(eventLogs)
    .where(
      and(
        eq(eventLogs.entityType, CUTOVER_EVENT_ENTITY.entityType),
        eq(eventLogs.entityId, CUTOVER_EVENT_ENTITY.entityId),
        eq(eventLogs.eventType, STAGE_CHANGED_EVENT),
      ),
    )
    .orderBy(desc(eventLogs.createdAt))
    .limit(1);
  return event ?? null;
}
