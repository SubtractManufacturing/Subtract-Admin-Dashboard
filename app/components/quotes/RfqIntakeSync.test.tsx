// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import type { ComponentType, FormHTMLAttributes, PropsWithChildren } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RfqIntakeSync } from "./RfqIntakeSync";

const { revalidate, useFetcherMock, useRevalidatorMock } = vi.hoisted(() => ({
  revalidate: vi.fn(),
  useFetcherMock: vi.fn(),
  useRevalidatorMock: vi.fn(),
}));

vi.mock("@remix-run/react", () => ({
  useFetcher: useFetcherMock,
  useRevalidator: useRevalidatorMock,
}));

type SyncData =
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

type TestFetcher = {
  state: "idle" | "submitting" | "loading";
  data?: SyncData;
  Form: ComponentType<FormHTMLAttributes<HTMLFormElement>>;
};

function FetcherForm({
  children,
  ...props
}: PropsWithChildren<FormHTMLAttributes<HTMLFormElement>>) {
  return <form {...props}>{children}</form>;
}

let fetcher: TestFetcher;

beforeEach(() => {
  fetcher = {
    state: "idle",
    Form: FetcherForm,
  };
  useFetcherMock.mockReturnValue(fetcher);
  useRevalidatorMock.mockReturnValue({
    revalidate,
    state: "idle",
  });
  revalidate.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RfqIntakeSync", () => {
  it("is hidden when RFQ intake is disabled", () => {
    render(<RfqIntakeSync enabled={false} />);

    expect(
      screen.queryByRole("button", { name: "Sync RFQs" }),
    ).not.toBeInTheDocument();
  });

  it("posts the sync intent and disables the button in flight", () => {
    const { container, rerender } = render(<RfqIntakeSync enabled />);

    expect(
      container.querySelector('input[name="intent"]'),
    ).toHaveValue("syncRfqIntake");

    fetcher.state = "submitting";
    rerender(<RfqIntakeSync enabled />);

    expect(screen.getByRole("button", { name: "Syncing RFQs…" })).toBeDisabled();
  });

  it.each([
    [0, "No new RFQs"],
    [1, "Found 1 new RFQ"],
    [3, "Found 3 new RFQs"],
  ])("shows the exact success message for %i new imports", (newImports, text) => {
    fetcher.data = {
      intent: "syncRfqIntake",
      success: true,
      newImports,
      cooldown: false,
    };

    render(<RfqIntakeSync enabled />);

    expect(screen.getByRole("status")).toHaveTextContent(text);
  });

  it("shows the cooldown message with the last count", () => {
    fetcher.data = {
      intent: "syncRfqIntake",
      success: true,
      newImports: 2,
      cooldown: true,
    };

    render(<RfqIntakeSync enabled />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Synced just now — Found 2 new RFQs",
    );
  });

  it("shows server refusals as a clear error", () => {
    fetcher.data = {
      intent: "syncRfqIntake",
      success: false,
      error: "Unable to sync RFQs. Please try again later or report this issue.",
    };

    render(<RfqIntakeSync enabled />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to sync RFQs. Please try again later or report this issue.",
    );
  });

  it("revalidates while a success banner is visible and stops when dismissed", () => {
    vi.useFakeTimers();
    fetcher.data = {
      intent: "syncRfqIntake",
      success: true,
      newImports: 1,
      cooldown: false,
    };
    render(<RfqIntakeSync enabled />);

    act(() => vi.advanceTimersByTime(10_000));
    expect(revalidate).toHaveBeenCalledTimes(1);

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss RFQ sync result" }),
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    act(() => vi.advanceTimersByTime(30_000));
    expect(revalidate).toHaveBeenCalledTimes(1);
  });

  it("stops revalidating after about two minutes", () => {
    vi.useFakeTimers();
    fetcher.data = {
      intent: "syncRfqIntake",
      success: true,
      newImports: 0,
      cooldown: true,
    };
    render(<RfqIntakeSync enabled />);

    act(() => vi.advanceTimersByTime(119_999));
    expect(revalidate).toHaveBeenCalledTimes(11);

    act(() => vi.advanceTimersByTime(30_000));
    expect(revalidate).toHaveBeenCalledTimes(11);
  });
});
