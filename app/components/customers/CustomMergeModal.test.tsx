// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CustomerSearchRecord } from "~/lib/customer-search";
import { CustomMergeModal } from "./CustomMergeModal";

const record = (
  id: number,
  displayName: string,
  overrides: Partial<CustomerSearchRecord> = {},
): CustomerSearchRecord => ({
  id,
  displayName,
  companyName: null,
  contactName: null,
  email: null,
  phone: null,
  ...overrides,
});

const customers = [
  record(1, "Acme Widgets", { email: "orders@acme.com", phone: "(555) 123-4567" }),
  record(2, "Dana Rivera", { companyName: "Rivera Machining" }),
  record(3, "Bolt Brothers"),
];

function setup(props: Partial<React.ComponentProps<typeof CustomMergeModal>> = {}) {
  const onReview = vi.fn();
  render(
    <CustomMergeModal
      isOpen
      onClose={vi.fn()}
      customers={customers}
      onReview={onReview}
      {...props}
    />,
  );
  const first = screen.getByRole("region", { name: "First Customer" });
  const second = screen.getByRole("region", { name: "Second Customer" });
  return { onReview, first, second };
}

describe("CustomMergeModal", () => {
  it("finds Customers by name, email, phone or company on each side", () => {
    const { first, second } = setup();

    fireEvent.change(within(first).getByRole("searchbox"), { target: { value: "555 123" } });
    expect(within(first).getByRole("button", { name: /Acme Widgets/ })).toBeVisible();
    expect(within(first).queryByRole("button", { name: /Dana Rivera/ })).not.toBeInTheDocument();

    fireEvent.change(within(second).getByRole("searchbox"), { target: { value: "machining" } });
    expect(within(second).getByRole("button", { name: /Dana Rivera/ })).toBeVisible();
    expect(within(second).queryByRole("button", { name: /Acme Widgets/ })).not.toBeInTheDocument();
  });

  it("keeps the first Customer and reviews the second into it by default", () => {
    const { first, second, onReview } = setup();

    expect(screen.getByRole("button", { name: "Review merge" })).toBeDisabled();
    fireEvent.click(within(first).getByRole("button", { name: /Acme Widgets/ }));
    fireEvent.click(within(second).getByRole("button", { name: /Dana Rivera/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review merge" }));

    expect(onReview).toHaveBeenCalledWith(1, 2);
  });

  it("reverses which Customer is kept when the arrow is clicked", () => {
    const { first, second, onReview } = setup();

    fireEvent.click(within(first).getByRole("button", { name: /Acme Widgets/ }));
    fireEvent.click(within(second).getByRole("button", { name: /Dana Rivera/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reverse which Customer is kept" }));
    fireEvent.click(screen.getByRole("button", { name: "Review merge" }));

    expect(onReview).toHaveBeenCalledWith(2, 1);
  });

  it("does not let the same Customer be picked on both sides", () => {
    const { first, second } = setup();

    fireEvent.click(within(first).getByRole("button", { name: /Acme Widgets/ }));

    expect(within(second).getByRole("button", { name: /Acme Widgets/ })).toBeDisabled();
  });

  it("pins the selected Customer above the list, even when the search no longer matches it", () => {
    const { first } = setup();

    fireEvent.click(within(first).getByRole("button", { name: /Bolt Brothers/ }));
    fireEvent.change(within(first).getByRole("searchbox"), { target: { value: "rivera" } });

    const rows = within(first).getAllByRole("button");
    expect(rows[0]).toHaveAccessibleName(/Bolt Brothers/);
    expect(rows[0]).toHaveAttribute("aria-pressed", "true");
    expect(within(first).getByRole("button", { name: /Dana Rivera/ })).toBeVisible();
  });

  it("never lists the selected Customer twice and clears it when clicked again", () => {
    const { first } = setup();

    fireEvent.click(within(first).getByRole("button", { name: /Acme Widgets/ }));
    expect(within(first).getAllByRole("button", { name: /Acme Widgets/ })).toHaveLength(1);

    fireEvent.click(within(first).getByRole("button", { name: /Acme Widgets/ }));
    expect(within(first).getByRole("button", { name: /Acme Widgets/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
