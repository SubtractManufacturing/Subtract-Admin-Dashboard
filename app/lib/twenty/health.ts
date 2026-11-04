/**
 * Plain-language status for the admin page. "Enabled" only describes a switch, so
 * health comes from what the sync has actually done.
 */

/** Runs every 2 minutes. This allows for a slow run and a worker restart. */
export const OVERDUE_AFTER_MINUTES = 10;

export type TwentyHealthState =
  | "setup"
  | "off"
  | "stopped"
  | "attention"
  | "catching_up"
  | "healthy";

export interface TwentyHealthInput {
  enabled: boolean;
  workspaceUrl: string;
  apiKeyConfigured: boolean;
  lastRunAt: string | null;
  /** When the sync was last turned on, so a fresh enable is not read as a stall. */
  enabledAt: string | null;
  failureCount: number;
  warningCount: number;
  pendingCount: number;
}

export interface TwentyHealth {
  state: TwentyHealthState;
  title: string;
  detail: string;
}

/** "5 hours ago", from a fixed clock so server and browser agree. */
export function formatTimeAgo(iso: string | null, now: Date): string {
  if (!iso) return "Never";
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function latest(...times: Array<string | null>): string | null {
  const known = times.filter((time): time is string => Boolean(time));
  return known.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function twentySyncHealth(input: TwentyHealthInput, now: Date): TwentyHealth {
  if (!input.apiKeyConfigured || !input.workspaceUrl) {
    return {
      state: "setup",
      title: "Setup needed",
      detail: "Twenty isn't connected yet. Finish the steps below, then turn on automatic sync.",
    };
  }
  if (!input.enabled) {
    return {
      state: "off",
      title: "Automatic sync is off",
      detail: "Nothing is sent to Twenty. Quotes created while it's off go across once it's back on.",
    };
  }

  const lastActivity = latest(input.lastRunAt, input.enabledAt);
  const idleMinutes = lastActivity
    ? (now.getTime() - Date.parse(lastActivity)) / 60_000
    : Number.POSITIVE_INFINITY;
  if (idleMinutes > OVERDUE_AFTER_MINUTES) {
    return {
      state: "stopped",
      title: "Sync has stopped",
      detail: `Last run was ${formatTimeAgo(input.lastRunAt, now).toLowerCase()}, but it should run every 2 minutes. Your quotes are safe and will catch up once it restarts. Ask whoever maintains the server to check the background worker.`,
    };
  }

  if (input.failureCount > 0 || input.warningCount > 0) {
    const parts = [
      input.failureCount > 0 ? `${plural(input.failureCount, "record")} blocked` : null,
      input.warningCount > 0
        ? `${plural(input.warningCount, "customer")} with missing details`
        : null,
    ].filter(Boolean);
    return {
      state: "attention",
      title: "Needs attention",
      detail: `${parts.join(" and ")}. Everything else is syncing normally.`,
    };
  }
  if (input.pendingCount > 0) {
    return {
      state: "catching_up",
      title: "Catching up",
      detail: `${plural(input.pendingCount, "record")} waiting for the next run.`,
    };
  }
  return {
    state: "healthy",
    title: "Syncing normally",
    detail: "New quotes and customers reach Twenty within a few minutes.",
  };
}

export interface FailureExplanation {
  summary: string;
  /** False when waiting will not fix it and someone has to act. */
  retriesItself: boolean;
}

/** Turns a stored error into what happened and what to do. The original stays available. */
export function explainTwentyFailure(lastError: string | null): FailureExplanation {
  const error = lastError ?? "";
  if (/could not reach twenty|returned (429|5\d\d)/i.test(error)) {
    return {
      summary: "Twenty couldn't be reached. This retries on its own.",
      retriesItself: true,
    };
  }
  if (/returned (401|403)/i.test(error)) {
    return {
      summary: "Twenty refused the API key. Ask whoever maintains the server to check it.",
      retriesItself: false,
    };
  }
  if (/several twenty opportunities/i.test(error)) {
    return {
      summary: "This quote has more than one opportunity in Twenty. Delete the extra one, then retry.",
      retriesItself: false,
    };
  }
  if (/no longer exists/i.test(error)) {
    return { summary: "This record was removed from the ERP.", retriesItself: false };
  }
  if (/returned 4\d\d/i.test(error)) {
    return {
      summary: "Twenty rejected this record. Retrying probably won't help, so check the details or ask for help.",
      retriesItself: false,
    };
  }
  return {
    summary: "Something unexpected went wrong. Check the details or ask for help.",
    retriesItself: false,
  };
}
