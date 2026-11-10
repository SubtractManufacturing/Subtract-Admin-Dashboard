import { describe, expect, it, vi } from "vitest";
import {
  actorFromAuth,
  dispatchIntent,
  mergeIntentTables,
  ok,
  parseIntegerField,
  type IntentTable,
} from "./core";

const messages = { unknownIntent: "Invalid action", failure: "An error occurred" };

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

describe("actorFromAuth", () => {
  it("prefers email, then display name", () => {
    expect(
      actorFromAuth({ user: { id: "u1", email: "a@b.co" }, userDetails: { name: "Ann" } }),
    ).toEqual({ userId: "u1", userEmail: "a@b.co" });
    expect(
      actorFromAuth({ user: { id: "u1", email: "" }, userDetails: { name: "Ann" } }),
    ).toEqual({ userId: "u1", userEmail: "Ann" });
  });

  it("leaves fields undefined when nothing is known", () => {
    expect(actorFromAuth({ user: null, userDetails: null })).toEqual({
      userId: undefined,
      userEmail: undefined,
    });
  });
});

describe("dispatchIntent", () => {
  const table: IntentTable<{ n: number }> = {
    ping: async (ctx) => ok({ pong: ctx.n }),
    boom: async () => {
      throw new Error("kaboom");
    },
  };

  it("routes to the handler named by the intent", async () => {
    const res = await dispatchIntent({
      table,
      intent: "ping",
      ctx: { n: 7 },
      formData: form({}),
      messages,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pong: 7 });
  });

  it("returns 400 for unknown, missing and prototype-key intents", async () => {
    for (const intent of ["nope", null, "constructor", "__proto__", "toString"]) {
      const res = await dispatchIntent({
        table,
        intent,
        ctx: { n: 0 },
        formData: form({}),
        messages,
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid action" });
    }
  });

  it("turns a thrown handler error into a logged 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await dispatchIntent({
      table,
      intent: "boom",
      ctx: { n: 0 },
      formData: form({}),
      messages,
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "An error occurred" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("mergeIntentTables", () => {
  it("merges disjoint tables", () => {
    const a: IntentTable<unknown> = { one: async () => ok() };
    const b: IntentTable<unknown> = { two: async () => ok() };
    expect(Object.keys(mergeIntentTables(a, b)).sort()).toEqual(["one", "two"]);
  });

  it("rejects an intent claimed twice", () => {
    const a: IntentTable<unknown> = { one: async () => ok() };
    expect(() => mergeIntentTables(a, a)).toThrow(/Duplicate handler.*"one"/);
  });
});

describe("parseIntegerField", () => {
  it("parses integers and rejects blanks and junk", () => {
    expect(parseIntegerField(form({ id: "42" }), "id")).toBe(42);
    expect(parseIntegerField(form({ id: "" }), "id")).toBeNull();
    expect(parseIntegerField(form({ id: "abc" }), "id")).toBeNull();
    expect(parseIntegerField(form({}), "id")).toBeNull();
  });
});
