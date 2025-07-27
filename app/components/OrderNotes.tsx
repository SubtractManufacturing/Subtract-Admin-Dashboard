import { useState, useEffect } from "react";
import { useFetcher } from "@remix-run/react";
import type { OrderNoteWithUser } from "~/lib/order-notes";
import Button from "./shared/Button";
import Modal from "./shared/Modal";

interface OrderNotesProps {
  notes: OrderNoteWithUser[];
  orderId: number;
  currentUserId: string;
  currentUserName: string;
}

export default function OrderNotes({ notes, orderId, currentUserId }: OrderNotesProps) {
  const fetcher = useFetcher();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingNote, setEditingNote] = useState<{ id: number; content: string } | null>(null);
  const [deletingNoteId, setDeletingNoteId] = useState<number | null>(null);
  const [noteContent, setNoteContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [tableError, setTableError] = useState(false);

  // Check for table error in fetcher data
  useEffect(() => {
    if (fetcher.data && typeof fetcher.data === 'object' && 'tableError' in fetcher.data) {
      setTableError(true);
    }
  }, [fetcher.data]);

  const handleAddNote = () => {
    if (!noteContent.trim()) return;
    
    fetcher.submit(
      {
        intent: "addNote",
        orderId: orderId.toString(),
        content: noteContent,
      },
      { method: "post" }
    );
    
    setNoteContent("");
    setShowAddModal(false);
  };

  const handleEditNote = () => {
    if (!editingNote || !editContent.trim()) return;
    
    fetcher.submit(
      {
        intent: "editNote",
        noteId: editingNote.id.toString(),
        content: editContent,
      },
      { method: "post" }
    );
    
    setEditingNote(null);
    setEditContent("");
  };

  const handleDeleteNote = (noteId: number) => {
    fetcher.submit(
      {
        intent: "deleteNote",
        noteId: noteId.toString(),
      },
      { method: "post" }
    );
    
    setDeletingNoteId(null);
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
      <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
        <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Notes</h3>
        <Button 
          size="sm" 
          className="bg-blue-600 hover:bg-blue-700"
          onClick={() => setShowAddModal(true)}
        >
          Add Note
        </Button>
      </div>
      <div className="p-6">
        {tableError ? (
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border-2 border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
            <p className="text-yellow-800 dark:text-yellow-200 font-semibold mb-2">
              Notes Feature Setup Required
            </p>
            <p className="text-yellow-700 dark:text-yellow-300 text-sm">
              The notes database table needs to be created. Please run the following SQL in your database:
            </p>
            <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded text-xs overflow-x-auto">
              {`CREATE TABLE "order_notes" (
  "id" serial PRIMARY KEY NOT NULL,
  "order_id" integer NOT NULL REFERENCES "orders"("id"),
  "user_id" text NOT NULL REFERENCES "users"("id"),
  "user_display_name" text NOT NULL,
  "content" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);`}
            </pre>
          </div>
        ) : notes.length === 0 ? (
          <p className="text-gray-500 dark:text-gray-400 text-center py-8">
            No notes available for this order
          </p>
        ) : (
          <div className="space-y-4">
            {notes.map((note) => (
              <div
                key={note.id}
                className="relative p-4 bg-yellow-50/80 dark:bg-yellow-900/20 border-2 border-yellow-200 dark:border-yellow-800 rounded-lg"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <p className="font-semibold text-gray-900 dark:text-gray-100">
                      {note.userName || note.userDisplayName}
                    </p>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {formatDateTime(note.createdAt.toString())}
                  </p>
                </div>
                <p className="text-gray-700 dark:text-gray-300 mb-3">{note.content}</p>
                
                {/* Edit and Delete buttons */}
                {note.userId === currentUserId && (
                  <div className="absolute bottom-3 right-3 flex gap-2">
                    <button
                      onClick={() => {
                        setEditingNote({ id: note.id, content: note.content });
                        setEditContent(note.content);
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200 font-medium"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => setDeletingNoteId(note.id)}
                      className="text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-200 font-medium"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Note Modal */}
      {showAddModal && (
        <Modal
          isOpen={showAddModal}
          onClose={() => {
            setShowAddModal(false);
            setNoteContent("");
          }}
          title="Add Note"
        >
          <fetcher.Form
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              handleAddNote();
            }}
          >
            <div className="mb-4">
              <label htmlFor="add-note-content" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Note <span className="text-red-500">*</span>
              </label>
              <textarea
                id="add-note-content"
                name="content"
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter your note here..."
                required
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowAddModal(false);
                  setNoteContent("");
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!noteContent.trim()}>
                Add Note
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Edit Note Modal */}
      {editingNote && (
        <Modal
          isOpen={!!editingNote}
          onClose={() => {
            setEditingNote(null);
            setEditContent("");
          }}
          title="Edit Note"
        >
          <fetcher.Form
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              handleEditNote();
            }}
          >
            <div className="mb-4">
              <label htmlFor="edit-note-content" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Note <span className="text-red-500">*</span>
              </label>
              <textarea
                id="edit-note-content"
                name="content"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditingNote(null);
                  setEditContent("");
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!editContent.trim()}>
                Save Changes
              </Button>
            </div>
          </fetcher.Form>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deletingNoteId && (
        <Modal
          isOpen={!!deletingNoteId}
          onClose={() => setDeletingNoteId(null)}
          title="Delete Note"
        >
          <p className="text-gray-700 dark:text-gray-300">
            Are you sure you want to delete this note? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3 mt-6">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDeletingNoteId(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              className="bg-red-600 hover:bg-red-700"
              onClick={() => handleDeleteNote(deletingNoteId)}
            >
              Delete
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}