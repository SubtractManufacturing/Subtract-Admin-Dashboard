// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CustomerMatchReviewLink } from "./CustomerMatchReviewLink";

describe("CustomerMatchReviewLink", () => {
  it("links to the merge tool with the candidate Customers pre-loaded", () => {
    render(
      <MemoryRouter>
        <CustomerMatchReviewLink
          metadata={{ candidateCustomerIds: [12, 7, 12], quoteId: 3 }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Review & merge" })).toHaveAttribute(
      "href",
      "/customers/merge?ids=12,7",
    );
  });

  it("does not offer the merge tool to roles that cannot use it", () => {
    render(
      <MemoryRouter>
        <CustomerMatchReviewLink metadata={{ candidateCustomerIds: [1, 2] }} canMerge={false} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Needs an Admin or Dev to review")).toBeInTheDocument();
  });

  it("includes the Customer intake created on older review items", () => {
    render(
      <MemoryRouter>
        <CustomerMatchReviewLink
          metadata={{ candidateCustomerIds: [2, 4], createdCustomerId: 9 }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Review & merge" })).toHaveAttribute(
      "href",
      "/customers/merge?ids=2,4,9",
    );
  });

  it("still opens the merge tool for an older item without candidates", () => {
    render(
      <MemoryRouter>
        <CustomerMatchReviewLink metadata={{}} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Review & merge" })).toHaveAttribute(
      "href",
      "/customers/merge",
    );
  });
});
