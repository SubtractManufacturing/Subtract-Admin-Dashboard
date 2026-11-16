import { describe, expect, it, vi } from "vitest";
import { dispatchIntent } from "./core";
import { noteIntents, type NoteIntentContext, type NotesPort } from "./note-intents";

const actor = { userId: "u1", userEmail: "a@b.co" };

function setup(entity: NoteIntentContext["entityRef"] = { type: "quote", id: "9" }) {
  const notes: NotesPort = {
    list: vi.fn(async () => [{ id: "n1" }]),
    create: vi.fn(async () => ({ id: "n2" })),
    update: vi.fn(async () => ({ id: "n1", content: "edited" })),
    archive: vi.fn(async () => ({ id: "n1", archived: true })),
  };
  const ctx: NoteIntentContext = { entityRef: entity, actor, deps: { notes } };
  const run = (intent: string, fields: Record<string, string> = {}) => {
    const formData = new FormData();
    for (const [k, v] of Object.entries(fields)) formData.set(k, v);
    return dispatchIntent({
      table: noteIntents,
      intent,
      ctx,
      formData,
      messages: { unknownIntent: "x", failure: "y" },
    });
  };
  return { notes, run };
}

describe("note intents", () => {
  it("getNotes lists notes for the entity", async () => {
    const { notes, run } = setup({ type: "order", id: "5" });
    const res = await run("getNotes");
    expect(await res.json()).toEqual({ notes: [{ id: "n1" }] });
    expect(notes.list).toHaveBeenCalledWith("order", "5");
  });

  it("createNote requires content and author", async () => {
    const { notes, run } = setup();
    expect((await run("createNote", { content: "hi" })).status).toBe(400);
    expect((await run("createNote", { createdBy: "u" })).status).toBe(400);
    expect(notes.create).not.toHaveBeenCalled();
  });

  it("createNote stamps entity and actor", async () => {
    const { notes, run } = setup();
    const res = await run("createNote", { content: "hello", createdBy: "u1" });
    expect(await res.json()).toEqual({ note: { id: "n2" } });
    expect(notes.create).toHaveBeenCalledWith(
      { entityType: "quote", entityId: "9", content: "hello", createdBy: "u1" },
      actor,
    );
  });

  it("updateNote validates and forwards", async () => {
    const { notes, run } = setup();
    expect((await run("updateNote", { noteId: "n1" })).status).toBe(400);
    const res = await run("updateNote", { noteId: "n1", content: "edited" });
    expect(await res.json()).toEqual({ note: { id: "n1", content: "edited" } });
    expect(notes.update).toHaveBeenCalledWith("n1", "edited", actor);
  });

  it("deleteNote archives and answers with success plus the note", async () => {
    const { notes, run } = setup();
    expect((await run("deleteNote")).status).toBe(400);
    const res = await run("deleteNote", { noteId: "n1" });
    expect(await res.json()).toEqual({
      success: true,
      note: { id: "n1", archived: true },
    });
    expect(notes.archive).toHaveBeenCalledWith("n1", actor);
  });
});
