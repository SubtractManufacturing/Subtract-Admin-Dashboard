// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CustomerSummaryView, DuplicateGroupView } from "~/lib/customer-merge-view";
import { DuplicateGroupCard } from "./DuplicateGroupCard";

const customer = (
  id: number,
  displayName: string,
  overrides: Partial<CustomerSummaryView> = {},
): CustomerSummaryView => ({
  id,
  displayName,
  companyName: null,
  contactName: null,
  email: `${displayName.toLowerCase()}@example.com`,
  phone: null,
  emails: [],
  quoteCount: 0,
  orderCount: 0,
  lastActivityAt: null,
  ...overrides,
});

const group = (overrides: Partial<DuplicateGroupView> = {}): DuplicateGroupView => ({
  customers: [
    customer(1, "Quiet"),
    customer(2, "Busy", { quoteCount: 4, orderCount: 2 }),
    customer(3, "Medium", { quoteCount: 1 }),
  ],
  reasons: [{ kind: "email", value: "shared@example.com" }],
  dismissedPairs: [],
  ...overrides,
});

describe("DuplicateGroupCard", () => {
  it("shows why the group was suggested and each Customer's history", () => {
    render(<DuplicateGroupCard group={group()} onReview={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText("Same email: shared@example.com")).toBeVisible();
    expect(screen.getByText("4 Quotes · 2 Orders")).toBeVisible();
  });

  it("pre-selects the Customer with the most history and reviews the others into it", () => {
    const onReview = vi.fn();
    render(<DuplicateGroupCard group={group()} onReview={onReview} onDismiss={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /Busy/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Merge Quiet into Busy" }));

    expect(onReview).toHaveBeenCalledWith(2, 1);
  });

  it("lets staff pick a different survivor before reviewing", () => {
    const onReview = vi.fn();
    render(<DuplicateGroupCard group={group()} onReview={onReview} onDismiss={vi.fn()} />);

    fireEvent.click(screen.getByRole("radio", { name: /Quiet/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge Busy into Quiet" }));

    expect(onReview).toHaveBeenCalledWith(1, 2);
  });

  it("keeps survivor radios independent across cards that share Customers", () => {
    const shared = group();
    render(
      <>
        <DuplicateGroupCard group={shared} onReview={vi.fn()} onDismiss={vi.fn()} />
        <DuplicateGroupCard group={shared} onReview={vi.fn()} onDismiss={vi.fn()} />
      </>,
    );

    const busy = screen.getAllByRole("radio", { name: /Busy/ });
    const quiet = screen.getAllByRole("radio", { name: /Quiet/ });
    expect(busy[0]).toBeChecked();
    expect(busy[1]).toBeChecked();

    fireEvent.click(quiet[1]);

    expect(busy[0]).toBeChecked();
    expect(quiet[1]).toBeChecked();
    expect(busy[1]).not.toBeChecked();
  });

  it("dismisses the whole group as not duplicates", () => {
    const onDismiss = vi.fn();
    render(<DuplicateGroupCard group={group()} onReview={vi.fn()} onDismiss={onDismiss} />);

    fireEvent.click(screen.getByRole("button", { name: "Not duplicates" }));

    expect(onDismiss).toHaveBeenCalledWith([1, 2, 3]);
  });

  it("shows who dismissed a pair and lets staff undo it", () => {
    const onUndismiss = vi.fn();
    render(
      <DuplicateGroupCard
        group={group({
          dismissedPairs: [
            {
              lowCustomerId: 1,
              highCustomerId: 2,
              dismissedBy: "user-1",
              dismissedByLabel: "Dana Admin",
              dismissedAt: "2026-05-01T12:00:00.000Z",
            },
          ],
        })}
        onReview={vi.fn()}
        onDismiss={vi.fn()}
        onUndismiss={onUndismiss}
      />,
    );

    expect(screen.getByText(/Quiet and Busy dismissed by Dana Admin/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Undo dismissal of Quiet and Busy" }));

    expect(onUndismiss).toHaveBeenCalledWith(1, 2);
  });
});
