// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SidebarUnreadBadge } from "./SidebarUnreadBadge";

describe("SidebarUnreadBadge", () => {
  it("shows the supplied current-user unread count", () => {
    render(<SidebarUnreadBadge count={7} compact={false} />);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("stays hidden when the current user has no unread items", () => {
    const { container } = render(<SidebarUnreadBadge count={0} compact />);
    expect(container).toBeEmptyDOMElement();
  });
});
