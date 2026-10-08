// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { DuplicateReasonKind } from "~/lib/customer-merge-view";
import { MatchFilterChips } from "./MatchFilterChips";

const counts = { email: 5, phone: 3, company: 8, name: 2 };
const hrefFor = (kinds: DuplicateReasonKind[]) =>
  kinds.length ? `/customers/merge?match=${kinds.join(",")}` : "/customers/merge";

const renderChips = (selected: DuplicateReasonKind[]) =>
  render(
    <MemoryRouter>
      <MatchFilterChips selected={selected} counts={counts} hrefFor={hrefFor} />
    </MemoryRouter>,
  );

describe("MatchFilterChips", () => {
  it("shows how many pairs share each signal", () => {
    renderChips([]);

    expect(screen.getByRole("link", { name: "Email 5" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Phone 3" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Company 8" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Contact name 2" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Clear" })).not.toBeInTheDocument();
  });

  it("adds a kind to the selection in display order", () => {
    renderChips(["company"]);

    expect(screen.getByRole("link", { name: "Email 5" })).toHaveAttribute(
      "href",
      "/customers/merge?match=email,company",
    );
  });

  it("removes a selected kind and can clear every filter", () => {
    renderChips(["email", "phone"]);

    const email = screen.getByRole("link", { name: "Email 5" });
    expect(email).toHaveAttribute("aria-current", "true");
    expect(email).toHaveAttribute("href", "/customers/merge?match=phone");
    expect(screen.getByRole("link", { name: "Company 8" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Clear" })).toHaveAttribute(
      "href",
      "/customers/merge",
    );
  });
});
