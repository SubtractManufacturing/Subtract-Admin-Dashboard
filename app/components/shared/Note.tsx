import { useState } from "react";
import { useFetcher } from "@remix-run/react";
import type { Note } from "~/lib/db/schema";
import Button from "./Button";

interface NoteProps {
  note: Note;
  currentUserId: string;
  currentUserName: string;
  onUpdate?: () => void;
}

export function NoteComponent({ note, currentUserId, currentUserName, onUpdate }: NoteProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content);
  const fetcher = useFetcher();
  // Check ownership by ID only
  const isOwner = note.createdBy === currentUserId;
  // For display: if createdBy is a UUID, show the current user's name, otherwise show what's stored
  const displayName = note.createdBy === currentUserId ? currentUserName : note.createdBy;

  const handleSave = () => {
    fetcher.submit(
      {
        intent: "updateNote",
        noteId: note.id,
        content: editContent,
      },
      { method: "post" }
    );
    setIsEditing(false);
    onUpdate?.();
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this note?")) {
      fetcher.submit(
        {
          intent: "deleteNote",
          noteId: note.id,
        },
        { method: "post" }
      );
      onUpdate?.();
    }
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 space-y-2">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
            <span className="font-medium">{displayName}</span>
            <span>•</span>
            <span>{formatDate(note.createdAt)}</span>
          </div>
        </div>
        {isOwner && !isEditing && (
          <div className="flex gap-2">
            <button
              onClick={() => setIsEditing(true)}
              className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Edit
            </button>
            <button
              onClick={handleDelete}
              className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSave();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setIsEditing(false);
                setEditContent(note.content);
              }
            }}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={3}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={fetcher.state !== "idle"}>
              {fetcher.state !== "idle" ? "Saving..." : "Save"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setIsEditing(false);
                setEditContent(note.content);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap">{note.content}</p>
      )}
    </div>
  );
}