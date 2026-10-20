import { useEffect, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";

import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import {
  buildDefaultJobBoardPostText,
  isPostTextOverLimit,
} from "~/lib/job-board/post-builder";
import { DISCORD_MAX_POST_CHARS } from "~/lib/job-board/types";
import type { JobBoardOrderInput, JobBoardSentMessageRecord } from "~/lib/job-board/types";

type JobBoardPartPreview = {
  partId: string;
  partName: string | null;
  quantity: number;
  thumbnailUrl: string | null;
  hasThumbnail: boolean;
  hasCad: boolean;
  cadFileName: string | null;
  drawings: { id: string; fileName: string }[];
};

type JobBoardAttachmentPreview = {
  id: string;
  fileName: string;
};

export type JobBoardActionData =
  | {
      intent: "postJobBoard";
      ok: true;
      sentMessages: JobBoardSentMessageRecord[];
    }
  | {
      intent: "postJobBoard";
      ok: false;
      error: string;
      failedGroup: string;
      failedMessageIndex: number;
      sentMessages: JobBoardSentMessageRecord[];
    }
  | {
      intent: "markJobBoardAsSent";
      ok: true;
    }
  | {
      intent: "markJobBoardAsSent";
      ok: false;
      error: string;
    };

type JobBoardModalProps = {
  isOpen: boolean;
  onClose: () => void;
  orderNumber: string;
  orderInput: JobBoardOrderInput;
  partPreviews: JobBoardPartPreview[];
  attachments: JobBoardAttachmentPreview[];
  webhookConfigured: boolean;
  notifyRoleId: string | null;
  onOpenPartViewer: (partId: string) => void;
};

const GROUP_LABELS: Record<string, string> = {
  text: "Post text",
  thumbnails: "Thumbnails",
  cad: "CAD files",
  drawings: "Drawings",
  attachments: "Order attachments",
};

export default function JobBoardModal({
  isOpen,
  onClose,
  orderNumber,
  orderInput,
  partPreviews,
  attachments,
  webhookConfigured,
  notifyRoleId,
  onOpenPartViewer,
}: JobBoardModalProps) {
  const fetcher = useFetcher<JobBoardActionData>();
  const revalidator = useRevalidator();
  const [postText, setPostText] = useState(() =>
    buildDefaultJobBoardPostText(orderInput, { notifyRoleId }),
  );
  const [selectedAttachmentIds, setSelectedAttachmentIds] = useState<
    Set<string>
  >(() => new Set());
  const [sendState, setSendState] = useState<{
    phase: "idle" | "sending" | "failed" | "done";
    failedGroup?: string;
    failedMessageIndex?: number;
    sentMessages: JobBoardSentMessageRecord[];
    error?: string;
  }>({ phase: "idle", sentMessages: [] });

  const wasOpen = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      wasOpen.current = false;
      return;
    }
    if (wasOpen.current) return;
    wasOpen.current = true;
    setPostText(buildDefaultJobBoardPostText(orderInput, { notifyRoleId }));
    setSelectedAttachmentIds(new Set());
    setSendState({ phase: "idle", sentMessages: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open, not on loader revalidation
  }, [isOpen]);

  const lastHandledData = useRef<JobBoardActionData | undefined>(undefined);
  const { revalidate } = revalidator;
  useEffect(() => {
    const data = fetcher.data;
    if (!data || fetcher.state !== "idle" || data === lastHandledData.current) {
      return;
    }
    lastHandledData.current = data;

    if (data.intent === "postJobBoard" && data.ok) {
      setSendState({ phase: "done", sentMessages: data.sentMessages });
      revalidate();
      return;
    }

    if (data.intent === "postJobBoard" && !data.ok) {
      setSendState({
        phase: "failed",
        failedGroup: data.failedGroup,
        failedMessageIndex: data.failedMessageIndex,
        sentMessages: data.sentMessages,
        error: data.error,
      });
      return;
    }

    if (data.intent === "markJobBoardAsSent" && data.ok) {
      revalidate();
      onClose();
      return;
    }

    const genericError = data as { error?: string; intent?: string };
    if (
      typeof genericError.error === "string" &&
      genericError.intent == null
    ) {
      setSendState({
        phase: "failed",
        error: genericError.error,
        sentMessages: [],
        failedGroup: "text",
        failedMessageIndex: 0,
      });
    }
  }, [fetcher.data, fetcher.state, onClose, revalidate]);

  const textOverLimit = isPostTextOverLimit(postText);
  const isSubmitting = fetcher.state !== "idle";

  const toggleAttachment = (attachmentId: string) => {
    setSelectedAttachmentIds((current) => {
      const next = new Set(current);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  };

  const submitPost = (startAtMessageIndex: number) => {
    const formData = new FormData();
    formData.append("intent", "postJobBoard");
    formData.append("postText", postText);
    formData.append(
      "selectedAttachmentIds",
      JSON.stringify([...selectedAttachmentIds]),
    );
    formData.append("startAtMessageIndex", String(startAtMessageIndex));
    if (sendState.sentMessages.length > 0) {
      formData.append(
        "priorSentMessages",
        JSON.stringify(sendState.sentMessages),
      );
    }
    setSendState((current) => ({ ...current, phase: "sending" }));
    fetcher.submit(formData, { method: "post" });
  };

  const submitMarkAsSent = () => {
    const formData = new FormData();
    formData.append("intent", "markJobBoardAsSent");
    fetcher.submit(formData, { method: "post" });
  };

  if (!isOpen) return null;

  if (sendState.phase === "done") {
    return (
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Job Board - Order ${orderNumber}`}
        size="md"
        zIndex={55}
      >
        <div className="space-y-6 py-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40">
            <svg
              className="h-6 w-6 text-emerald-600 dark:text-emerald-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900 dark:text-white">
              Posted to Job Board
            </p>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              The order was sent to Discord and moved to Waiting for Shop
              Selection.
            </p>
          </div>
          <div className="flex justify-center pt-2">
            <Button variant="primary" onClick={onClose} className="min-w-[8rem]">
              Close
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Job Board - Order ${orderNumber}`}
      size="xl"
      zIndex={55}
    >
      <div className="space-y-6">
        <div>
          <label
            htmlFor="job-board-post-text"
            className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            Post text
          </label>
          <textarea
            id="job-board-post-text"
            rows={10}
            value={postText}
            onChange={(event) => setPostText(event.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white p-3 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
          />
          <p
            className={`mt-1 text-xs ${
              textOverLimit
                ? "text-red-600 dark:text-red-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {postText.length} / {DISCORD_MAX_POST_CHARS} characters
            {textOverLimit ? " — over Discord limit; sending is disabled." : ""}
          </p>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
            Parts
          </h3>
          <div className="space-y-3">
            {partPreviews.map((part) => (
              <div
                key={part.partId}
                className="rounded-lg border border-gray-200 p-3 dark:border-slate-700"
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => onOpenPartViewer(part.partId)}
                    className="h-16 w-16 flex-shrink-0 overflow-hidden rounded border border-gray-200 bg-gray-50 dark:border-slate-600 dark:bg-slate-800"
                    title="Open 3D viewer to capture thumbnail"
                  >
                    {part.thumbnailUrl ? (
                      <img
                        src={part.thumbnailUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center text-xs text-gray-400">
                        No thumb
                      </span>
                    )}
                  </button>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-medium text-gray-900 dark:text-white">
                      {part.partName || "Unnamed part"} × {part.quantity}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">
                      CAD:{" "}
                      {part.hasCad
                        ? part.cadFileName
                        : "Missing current revision"}
                    </p>
                    <p className="text-gray-600 dark:text-gray-400">
                      Drawings:{" "}
                      {part.drawings.length > 0
                        ? part.drawings.map((d) => d.fileName).join(", ")
                        : "None linked"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {attachments.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-900 dark:text-white">
              Order attachments
            </h3>
            <ul className="space-y-2">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={selectedAttachmentIds.has(attachment.id)}
                      onChange={() => toggleAttachment(attachment.id)}
                    />
                    {attachment.fileName}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {sendState.phase === "failed" && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200">
            <p className="font-medium">Send failed</p>
            <p>{sendState.error}</p>
            {sendState.failedGroup && (
              <p className="mt-1">
                Failed at: {GROUP_LABELS[sendState.failedGroup] ?? sendState.failedGroup}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-4 dark:border-slate-700">
          <Button
            variant="secondary"
            onClick={() => {
              if (
                sendState.phase === "failed" &&
                !confirm(
                  "Some messages may already be on Discord. Closing clears retry progress and the next send starts from the beginning. Close anyway?",
                )
              ) {
                return;
              }
              onClose();
            }}
            disabled={isSubmitting}
          >
            Close
          </Button>
          <Button
            variant="secondary"
            onClick={submitMarkAsSent}
            disabled={isSubmitting}
          >
            Mark as sent
          </Button>
          {sendState.phase === "failed" ? (
            <Button
              variant="primary"
              onClick={() =>
                submitPost(sendState.failedMessageIndex ?? 0)
              }
              disabled={isSubmitting || textOverLimit || !webhookConfigured}
            >
              Retry from failed group
            </Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => submitPost(0)}
              disabled={isSubmitting || textOverLimit || !webhookConfigured}
              title={
                !webhookConfigured
                  ? "Configure the Job Board webhook in Admin Console first"
                  : undefined
              }
            >
              {isSubmitting ? "Sending…" : "Send to Board"}
            </Button>
          )}
        </div>
        {!webhookConfigured && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Job Board webhook URL is not configured. Sending is disabled; Mark as
            sent still works.
          </p>
        )}
      </div>
    </Modal>
  );
}
