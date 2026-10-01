// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DeleteActionItemButton } from "./DeleteActionItemButton";

describe("DeleteActionItemButton", () => {
  it("requires a second confirmation and explains the team-wide impact", () => {
    render(<DeleteActionItemButton id="item-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(screen.getByText(/every user's active view/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeVisible();
  });
});
