import { useEffect, useRef } from "react";

export type UsePollingOptions = {
  /** Poll while true; turning it off stops immediately and resets the tick count. */
  active: boolean;
  intervalMs: number;
  /** Give up after this many ticks so a stuck job cannot poll forever. */
  maxTicks: number;
  onTick: () => void;
  /** Called once when `maxTicks` is reached. Polling stays stopped until `active` toggles. */
  onTimeout?: () => void;
};

/**
 * Call `onTick` on an interval while `active`, with a hard cap.
 *
 * The callbacks are read through refs, so passing fresh closures every render
 * (for example `revalidator.revalidate`) does not restart the interval.
 */
export function usePolling({
  active,
  intervalMs,
  maxTicks,
  onTick,
  onTimeout,
}: UsePollingOptions): void {
  const onTickRef = useRef(onTick);
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onTickRef.current = onTick;
    onTimeoutRef.current = onTimeout;
  });

  useEffect(() => {
    if (!active || maxTicks <= 0) return;

    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
      onTickRef.current();
      if (ticks >= maxTicks) {
        clearInterval(interval);
        onTimeoutRef.current?.();
      }
    }, intervalMs);

    return () => clearInterval(interval);
  }, [active, intervalMs, maxTicks]);
}
