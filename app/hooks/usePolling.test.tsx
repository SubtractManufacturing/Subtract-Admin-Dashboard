// @vitest-environment happy-dom
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePolling, type UsePollingOptions } from "./usePolling";

const base = { intervalMs: 5000, maxTicks: 3 };

describe("usePolling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks on the interval while active", () => {
    const onTick = vi.fn();
    renderHook(() => usePolling({ ...base, active: true, onTick }));

    expect(onTick).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("does nothing while inactive", () => {
    const onTick = vi.fn();
    renderHook(() => usePolling({ ...base, active: false, onTick }));
    vi.advanceTimersByTime(60_000);
    expect(onTick).not.toHaveBeenCalled();
  });

  it("stops at the cap and reports the timeout once", () => {
    const onTick = vi.fn();
    const onTimeout = vi.fn();
    renderHook(() => usePolling({ ...base, active: true, onTick, onTimeout }));

    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(3);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("stops when it becomes inactive and starts a fresh count when reactivated", () => {
    const onTick = vi.fn();
    const onTimeout = vi.fn();
    const { rerender } = renderHook(
      (props: UsePollingOptions) => usePolling(props),
      { initialProps: { ...base, active: true, onTick, onTimeout } },
    );

    vi.advanceTimersByTime(10_000);
    expect(onTick).toHaveBeenCalledTimes(2);

    rerender({ ...base, active: false, onTick, onTimeout });
    vi.advanceTimersByTime(30_000);
    expect(onTick).toHaveBeenCalledTimes(2);

    rerender({ ...base, active: true, onTick, onTimeout });
    vi.advanceTimersByTime(10_000);
    expect(onTick).toHaveBeenCalledTimes(4);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("keeps its cadence when the callbacks change between renders", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      (props: UsePollingOptions) => usePolling(props),
      { initialProps: { ...base, active: true, onTick: first } },
    );

    vi.advanceTimersByTime(4000);
    rerender({ ...base, active: true, onTick: second });
    vi.advanceTimersByTime(1000);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh count when resetKey changes while staying active", () => {
    const onTick = vi.fn();
    const onTimeout = vi.fn();
    const { rerender } = renderHook(
      (props: UsePollingOptions) => usePolling(props),
      { initialProps: { ...base, active: true, resetKey: 1, onTick, onTimeout } },
    );

    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(3);
    expect(onTimeout).toHaveBeenCalledTimes(1);

    rerender({ ...base, active: true, resetKey: 2, onTick, onTimeout });
    vi.advanceTimersByTime(60_000);
    expect(onTick).toHaveBeenCalledTimes(6);
    expect(onTimeout).toHaveBeenCalledTimes(2);
  });

  it("clears the interval on unmount", () => {
    const onTick = vi.fn();
    const { unmount } = renderHook(() => usePolling({ ...base, active: true, onTick }));
    unmount();
    vi.advanceTimersByTime(60_000);
    expect(onTick).not.toHaveBeenCalled();
  });
});
