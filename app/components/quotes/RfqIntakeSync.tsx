import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";

import Button from "~/components/shared/Button";

const REVALIDATION_INTERVAL_MS = 10_000;
const REVALIDATION_WINDOW_MS = 120_000;

type SyncActionData =
  | {
      intent: "syncRfqIntake";
      success: true;
      newImports: number;
      cooldown: boolean;
    }
  | {
      intent: "syncRfqIntake";
      success: false;
      error: string;
    };

type SyncBanner =
  | {
      kind: "success";
      newImports: number;
      cooldown: boolean;
    }
  | {
      kind: "error";
      message: string;
    };

function countMessage(newImports: number) {
  if (newImports === 0) return "No new RFQs";
  if (newImports === 1) return "Found 1 new RFQ";
  return `Found ${newImports} new RFQs`;
}

export function RfqIntakeSync({ enabled }: { enabled: boolean }) {
  const fetcher = useFetcher<SyncActionData>();
  const revalidator = useRevalidator();
  const revalidateRef = useRef(revalidator.revalidate);
  const [banner, setBanner] = useState<SyncBanner | null>(null);
  revalidateRef.current = revalidator.revalidate;

  useEffect(() => {
    const data = fetcher.data;
    if (!data || data.intent !== "syncRfqIntake") return;

    if (data.success) {
      setBanner({
        kind: "success",
        newImports: data.newImports,
        cooldown: data.cooldown,
      });
    } else {
      setBanner({ kind: "error", message: data.error });
    }
  }, [fetcher.data]);

  useEffect(() => {
    if (banner?.kind !== "success") return;

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      if (Date.now() - startedAt >= REVALIDATION_WINDOW_MS) {
        window.clearInterval(intervalId);
        return;
      }
      revalidateRef.current();
    }, REVALIDATION_INTERVAL_MS);
    const timeoutId = window.setTimeout(
      () => window.clearInterval(intervalId),
      REVALIDATION_WINDOW_MS,
    );

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [banner]);

  if (!enabled) return null;

  const isSyncing = fetcher.state !== "idle";
  const message =
    banner?.kind === "success"
      ? `${banner.cooldown ? "Synced just now — " : ""}${countMessage(
          banner.newImports,
        )}`
      : banner?.message;

  return (
    <div className="flex flex-col items-end">
      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="syncRfqIntake" />
        <Button type="submit" variant="secondary" disabled={isSyncing}>
          {isSyncing ? "Syncing RFQs…" : "Sync RFQs"}
        </Button>
      </fetcher.Form>

      {banner ? (
        <div
          role={banner.kind === "error" ? "alert" : "status"}
          className={`mt-4 flex items-center justify-between gap-4 rounded border px-4 py-3 text-sm ${
            banner.kind === "error"
              ? "border-red-300 bg-red-50 text-red-800 dark:border-red-700 dark:bg-red-950/40 dark:text-red-200"
              : "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-200"
          }`}
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Dismiss RFQ sync result"
            className="shrink-0 rounded px-2 py-1 font-medium hover:bg-black/5 dark:hover:bg-white/10"
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
