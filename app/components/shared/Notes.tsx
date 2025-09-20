import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import type { Note } from "~/lib/db/schema";
import { NoteComponent } from "./Note";
import Button from "./Button";

interface NotesProps {
  entityType: string;
  entityId: string;
  initialNotes?: Note[];
  currentUserId: string;
  currentUserName: string;
  showHeader?: boolean;
  onAddNoteClick?: () => void;
  isAddingNote?: boolean;
  externalControl?: boolean;
}

export function Notes({
  entityType,
  entityId,
  initialNotes = [],
  currentUserId,
  currentUserName,
  showHeader = true,
  onAddNoteClick,
  isAddingNote: externalIsAddingNote,
  externalControl = false
}: NotesProps) {
  const [notes, setNotes] = useState<Note[]>(initialNotes);
  const [internalIsAddingNote, setInternalIsAddingNote] = useState(false);

  const isAddingNote = externalControl ? externalIsAddingNote || false : internalIsAddingNote;
  const [newNoteContent, setNewNoteContent] = useState("");
  const fetcher = useFetcher<{ notes?: Note[] }>();

  useEffect(() => {
    if (fetcher.data?.notes) {
      // Convert date strings back to Date objects for proper typing
      const notesWithDates = fetcher.data.notes.map(note => ({
        ...note,
        createdAt: new Date(note.createdAt),
        updatedAt: new Date(note.updatedAt)
      }));
      setNotes(notesWithDates);
    }
  }, [fetcher.data]);

  const loadNotes = () => {
    fetcher.submit(
      {
        intent: "getNotes",
        entityType,
        entityId,
      },
      { method: "post" }
    );
  };

  const handleAddNote = () => {
    if (!newNoteContent.trim()) return;

    fetcher.submit(
      {
        intent: "createNote",
        entityType,
        entityId,
        content: newNoteContent,
        createdBy: currentUserId, // Store ID, not name
      },
      { method: "post" }
    );

    setNewNoteContent("");
    setIsAddingNote(false);
    
    setTimeout(() => {
      loadNotes();
    }, 100);
  };

  const handleCancel = () => {
    if (externalControl && onAddNoteClick) {
      onAddNoteClick();
    } else {
      setInternalIsAddingNote(false);
    }
    setNewNoteContent("");
  };

  return (
    <div className="space-y-4">
      {showHeader && (
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Notes</h3>
          {!isAddingNote && (
            <Button
              size="sm"
              onClick={() => {
                if (externalControl && onAddNoteClick) {
                  onAddNoteClick();
                } else {
                  setInternalIsAddingNote(true);
                }
              }}
            >
              Add Note
            </Button>
          )}
        </div>
      )}

      {isAddingNote && (
        <div className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 space-y-2">
          <textarea
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && newNoteContent.trim()) {
                e.preventDefault();
                handleAddNote();
              } else if (e.key === "Escape") {
                e.preventDefault();
                handleCancel();
              }
            }}
            placeholder="Enter your note..."
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
          />
          <div className="flex gap-2">
            <Button 
              size="sm" 
              onClick={handleAddNote} 
              disabled={!newNoteContent.trim() || fetcher.state !== "idle"}
            >
              {fetcher.state !== "idle" ? "Saving..." : "Save Note"}
            </Button>
            <Button size="sm" variant="secondary" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {notes.length > 0 ? (
          notes.map((note) => (
            <NoteComponent
              key={note.id}
              note={note}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              onUpdate={loadNotes}
            />
          ))
        ) : (
          <p className="text-gray-500 dark:text-gray-400 text-center py-4">
            No notes yet. Add one to get started.
          </p>
        )}
      </div>
    </div>
  );
}