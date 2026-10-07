// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MergePreviewView } from "~/lib/customer-merge-view";
import { CustomerMergeReview } from "./CustomerMergeReview";

const summary = (id: number, displayName: string) => ({
  id,
  displayName,
  companyName: null,
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
  counts: { quotes: 3, orders: 2, parts: 1, attachments: 4, communications: 5, notes: 6 },
  attachmentsAlreadyLinked: 0,
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
            },
          ],
        })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /\+15550001/ })).toBeChecked();
    fireEvent.click(screen.getByRole("radio", { name: /\+15550002/ }));
    fireEvent.click(screen.getByRole("button", { name: "Merge Customers" }));

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
            },
          ],
        })}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Merge Customers" });
    expect(screen.getByRole("radio", { name: /Net 30/ })).not.toBeChecked();
    expect(confirm).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Net 60/ }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(onConfirm).toHaveBeenCalledWith({ paymentTerms: "merged" });
  });
});
