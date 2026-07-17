// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormEvent, ReactNode } from "react";

const fetcherState = vi.hoisted(() => ({
  data: null as { success?: boolean; error?: string } | null,
  state: "idle" as "idle" | "submitting" | "loading",
}));

vi.mock("@remix-run/react", () => ({
  useFetcher: () => ({
    get data() {
      return fetcherState.data;
    },
    get state() {
      return fetcherState.state;
    },
    Form: ({
      children,
      onSubmit,
      ...props
    }: {
      children: ReactNode;
      onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
    }) => (
      <form
        {...props}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit?.(event);
        }}
      >
        {children}
      </form>
    ),
  }),
}));

import LogCommunicationModal from "./LogCommunicationModal";

const customers = [
  { id: 1, displayName: "Acme", email: "a@example.com" },
];

describe("LogCommunicationModal", () => {
  beforeEach(() => {
    fetcherState.data = null;
    fetcherState.state = "idle";
  });

  afterEach(() => {
    cleanup();
  });

  it("does not auto-close when reopened after a prior successful submit (sticky fetcher.data)", () => {
    // Simulate Remix leaving the previous successful response on the fetcher.
    fetcherState.data = { success: true };

    const closedOnMount = vi.fn();
    const { rerender } = render(
      <LogCommunicationModal
        isOpen={false}
        onClose={closedOnMount}
        customers={customers}
      />,
    );

    // Parent re-render on open supplies a new inline onClose (unstable identity).
    const onCloseAfterOpen = vi.fn();
    rerender(
      <LogCommunicationModal
        isOpen={true}
        onClose={onCloseAfterOpen}
        customers={customers}
      />,
    );

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onCloseAfterOpen).not.toHaveBeenCalled();
  });

  it("closes once when a fresh submit succeeds while open", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <LogCommunicationModal
        isOpen={true}
        onClose={onClose}
        customers={customers}
      />,
    );

    expect(onClose).not.toHaveBeenCalled();

    fireEvent.submit(document.querySelector("form")!);

    fetcherState.data = { success: true };
    rerender(
      <LogCommunicationModal
        isOpen={true}
        onClose={onClose}
        customers={customers}
      />,
    );

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides customer select when lockCustomer is true", () => {
    render(
      <LogCommunicationModal
        isOpen={true}
        onClose={() => {}}
        customers={customers}
        defaultCustomerId={1}
        lockCustomer
      />,
    );

    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("Search for a customer...")).not.toBeInTheDocument();
  });
});
