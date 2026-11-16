/**
 * Note intents (getNotes / createNote / updateNote / deleteNote), identical for
 * every entity that shows the Notes panel. Previously duplicated per route.
 */
import { json } from "@remix-run/node";
import { badRequest, type Actor, type IntentTable } from "./core";

export type NotesPort = {
  list(entityType: string, entityId: string): Promise<unknown[]>;
  create(
    data: {
      entityType: string;
      entityId: string;
      content: string;
      createdBy: string;
    },
    actor: Actor,
  ): Promise<unknown>;
  update(id: string, content: string, actor: Actor): Promise<unknown>;
  archive(id: string, actor: Actor): Promise<unknown>;
};

export type NoteIntentContext = {
  /** The entity whose notes are being edited. */
  entityRef: { type: "quote" | "order"; id: string };
  actor: Actor;
  deps: { notes: NotesPort };
};

const text = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
};

export const noteIntents: IntentTable<NoteIntentContext> = {
  async getNotes({ entityRef, deps }) {
    const notes = await deps.notes.list(entityRef.type, entityRef.id);
    return json({ notes });
  },

  async createNote({ entityRef, actor, deps }, formData) {
    const content = text(formData, "content");
    const createdBy = text(formData, "createdBy");
    if (!content || !createdBy) return badRequest("Missing required fields");

    const note = await deps.notes.create(
      {
        entityType: entityRef.type,
        entityId: entityRef.id,
        content,
        createdBy,
      },
      actor,
    );
    return json({ note });
  },

  async updateNote({ actor, deps }, formData) {
    const noteId = text(formData, "noteId");
    const content = text(formData, "content");
    if (!noteId || !content) return badRequest("Missing required fields");

    const note = await deps.notes.update(noteId, content, actor);
    return json({ note });
  },

  async deleteNote({ actor, deps }, formData) {
    const noteId = text(formData, "noteId");
    if (!noteId) return badRequest("Missing note ID");

    const note = await deps.notes.archive(noteId, actor);
    // `success` for callers that only check it, `note` for those that read it back.
    return json({ success: true, note });
  },
};
