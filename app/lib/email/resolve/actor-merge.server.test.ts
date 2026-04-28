import { describe, it, expect } from "vitest";
import {
  buildActorMergeMap,
  resolveActorMergeTokens,
} from "~/lib/email/resolve/actor-merge.server";
import type { EmailEnqueueAuth } from "~/lib/email/handlers/quote-send-email.server";

describe("buildActorMergeMap", () => {
  it("uses profile name and email when set", () => {
    expect(
      buildActorMergeMap({
        email: "  pat@subtract.com ",
        name: " Pat Subtract ",
      }),
    ).toEqual({
      userName: "Pat Subtract",
      userEmail: "pat@subtract.com",
    });
  });

  it("derives display name from email local-part when name is missing", () => {
    expect(
      buildActorMergeMap({ email: "jane.doe@acme.io", name: null }),
    ).toEqual({
      userName: "jane doe",
      userEmail: "jane.doe@acme.io",
    });
  });

  it("falls back to User label when email is empty and no name", () => {
    expect(buildActorMergeMap({ email: "", name: undefined })).toEqual({
      userName: "User",
      userEmail: "-",
    });
  });
});

describe("resolveActorMergeTokens", () => {
  const mkAuth = (partial: {
    udEmail?: string;
    udName?: string | null;
    userEmail?: string;
  }): EmailEnqueueAuth => ({
    user: {
      email: partial.userEmail,
    } as EmailEnqueueAuth["user"],
    userDetails: {
      id: "id-1",
      email: partial.udEmail ?? "",
      name: partial.udName ?? null,
      role: "Admin",
    },
  });

  it("prefers userDetails email over user email", () => {
    const r = resolveActorMergeTokens(
      mkAuth({ udEmail: " primary@corp.com ", userEmail: "secondary@corp.com" }),
    );
    expect(r.userEmail).toBe("primary@corp.com");
  });

  it("uses user.email when userDetails email is blank", () => {
    const r = resolveActorMergeTokens(mkAuth({ udEmail: "", userEmail: "only@corp.com" }));
    expect(r.userEmail).toBe("only@corp.com");
  });
});
