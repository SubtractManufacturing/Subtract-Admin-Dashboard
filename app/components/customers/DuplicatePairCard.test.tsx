// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CustomerSummaryView, DuplicatePairView } from "~/lib/customer-merge-view";
import { DuplicatePairCard } from "./DuplicatePairCard";

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

const pair = (overrides: Partial<DuplicatePairView> = {}): DuplicatePairView => ({
  a: customer(1, "Quiet"),
  b: customer(2, "Busy", { quoteCount: 4, orderCount: 2 }),
  reasons: [{ kind: "email", value: "shared@example.com" }],
  score: 100,
  ...overrides,
});

describe("DuplicatePairCard", () => {
  it("shows why the pair was suggested and each Customer's history", () => {
    render(<DuplicatePairCard pair={pair()} onReview={vi.fn()} />);

    expect(screen.getByText("Same email: shared@example.com")).toBeVisible();
    expect(screen.getByText("4 Quotes · 2 Orders")).toBeVisible();
  });

  it("keeps the Customer with the most history and reviews the other into it", () => {
    const onReview = vi.fn();
    render(<DuplicatePairCard pair={pair()} onReview={onReview} />);

    fireEvent.click(screen.getByRole("button", { name: "Review merging Quiet into Busy" }));

    expect(onReview).toHaveBeenCalledWith(2, 1);
  });

  it("lets staff swap which Customer is kept before reviewing", () => {
    const onReview = vi.fn();
    render(<DuplicatePairCard pair={pair()} onReview={onReview} />);

    fireEvent.click(screen.getByRole("button", { name: "Keep Quiet instead" }));
    fireEvent.click(screen.getByRole("button", { name: "Review merging Busy into Quiet" }));

    expect(onReview).toHaveBeenCalledWith(1, 2);
  });

  it("lists every signal the pair shares", () => {
    render(
      <DuplicatePairCard
        pair={pair({
          reasons: [
            { kind: "company", value: "acme" },
            { kind: "phone", value: "5551234" },
          ],
        })}
        onReview={vi.fn()}
      />,
    );

    expect(screen.getByText("Same company: acme")).toBeVisible();
    expect(screen.getByText("Same phone: 5551234")).toBeVisible();
  });
});
