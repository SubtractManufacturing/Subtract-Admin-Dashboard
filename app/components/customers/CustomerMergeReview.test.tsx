// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MergePreviewView } from "~/lib/customer-merge-view";
import { testUuid } from "~/test/ids";
import { CustomerMergeReview } from "./CustomerMergeReview";

const summary = (n: number, displayName: string) => ({
  id: testUuid(n),
  kind: "business" as const,
  displayName,
  companyName: null,
  customerAccountId: testUuid(100 + n),
  vendorAccountId: null,
  contacts: [],
  contactName: null,
  email: `${displayName.toLowerCase()}@example.com`,
  phone: null,
  emails: [`${displayName.toLowerCase()}@example.com`],
  quoteCount: 0,
  orderCount: 0,
  lastActivityAt: null,
});

const preview = (overrides: Partial<MergePreviewView> = {}): MergePreviewView => ({
  survivor: summary(1, "Survivor"),
  merged: summary(2, "Merged"),
  counts: {
    quotes: 3,
    orders: 2,
    parts: 1,
    vendorQuotes: 0,
    vendorOrders: 0,
    contacts: 2,
    addresses: 1,
    attachments: 4,
    communications: 5,
    notes: 6,
    events: 7,
  },
  contactsAlreadyLinked: 0,
  attachmentsAlreadyLinked: 0,
  accounts: [
    { type: "customer", mode: "fold" },
    { type: "vendor", mode: "none" },
  ],
  retainedEmails: ["merged@example.com", "survivor@example.com"],
  conflicts: [],
  autoFills: [],
  survivorUpdatedAt: "2026-01-01T00:00:00.000Z",
  mergedUpdatedAt: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

describe("CustomerMergeReview", () => {
  it("previews how many records will move before confirming", () => {
    render(
      <CustomerMergeReview preview={preview()} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    const moving = screen.getByRole("list", { name: "Records that will move" });
    expect(within(moving).getByText(/3 Quotes/)).toBeVisible();
    expect(within(moving).getByText(/2 Orders/)).toBeVisible();
    expect(within(moving).getByText(/1 Part\b/)).toBeVisible();
    expect(within(moving).getByText(/4 Attachments/)).toBeVisible();
    expect(within(moving).getByText(/5 communications/)).toBeVisible();
    expect(within(moving).getByText(/6 Notes/)).toBeVisible();
    expect(within(moving).getByText(/2 Contacts/)).toBeVisible();
    expect(within(moving).getByText(/1 address$/)).toBeVisible();
    expect(screen.getByText(/Customer account: folded into Survivor's Customer account/)).toBeVisible();
  });

  it("says when the merged Organization's account moves over as is", () => {
    render(
      <CustomerMergeReview
        preview={preview({ accounts: [{ type: "vendor", mode: "move" }] })}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/Vendor account: becomes Survivor's Vendor account/)).toBeVisible();
  });

  it("pre-selects the suggested side, such as the business when an individual joins it", () => {
    const onConfirm = vi.fn();
    render(
      <CustomerMergeReview
        preview={preview({
          conflicts: [
            {
              field: "name",
              label: "Name",
              survivorValue: "Jane Doe",
              mergedValue: "Acme",
              requiresExplicitChoice: false,
              defaultChoice: "merged",
            },
          ],
        })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: /Acme/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    expect(onConfirm).toHaveBeenCalledWith({ name: "merged" });
  });

  it("lets staff swap which Customer is kept", () => {
    const onSwap = vi.fn();
    render(
      <CustomerMergeReview
        preview={preview()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        onSwap={onSwap}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Swap which one is kept" }));

    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it("hides the swap button when swapping is not offered", () => {
    render(
      <CustomerMergeReview preview={preview()} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );

    expect(
      screen.queryByRole("button", { name: "Swap which one is kept" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the survivor's value by default and lets one click take the other value", () => {
    const onConfirm = vi.fn();
    render(
      <CustomerMergeReview
        preview={preview({
          conflicts: [
            {
              field: "phone",
              label: "Phone",
              survivorValue: "+15550001",
              mergedValue: "+15550002",
              requiresExplicitChoice: false,
              defaultChoice: "survivor",
            },
          ],
        })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /\+15550001/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /\+15550002/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge" }));

    expect(onConfirm).toHaveBeenCalledWith({ phone: "merged" });
  });

  it("makes staff explicitly choose payment terms before the merge can be confirmed", () => {
    const onConfirm = vi.fn();
    render(
      <CustomerMergeReview
        preview={preview({
          conflicts: [
            {
              field: "paymentTerms",
              label: "Payment terms",
              survivorValue: "Net 30",
              mergedValue: "Net 60",
              requiresExplicitChoice: true,
              defaultChoice: "survivor",
            },
          ],
        })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Merge" });
    expect(screen.getByRole("radio", { name: /Net 30/ })).not.toBeChecked();
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Net 60/ }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith({ paymentTerms: "merged" });
  });
});
