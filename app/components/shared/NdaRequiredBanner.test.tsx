// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NdaRequiredBanner } from "./NdaRequiredBanner";

describe("NdaRequiredBanner", () => {
  it("is prominent when an NDA is required", () => {
    render(<NdaRequiredBanner required />);
    expect(screen.getByRole("alert")).toHaveTextContent("NDA required");
  });

  it("is absent when an NDA is not required", () => {
    render(<NdaRequiredBanner required={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
