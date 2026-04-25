import type { ReactNode } from "react";

type Props = {
  /** e.g. "Quote PDF" or "Invoice" from ATTACHMENT_DOCUMENT_KIND_LABELS */
  kindLabel: string;
  /** Optional trailing control — typically a secondary "Generate …" `Button` (SendQuote / Send order confirmation) */
  trailingAction?: ReactNode;
};

/**
 * Dashed "no file selected" row shared by `SendQuoteEmailModal` and
 * `SendOrderConfirmationModal` for required per-kind attachments.
 */
export function RequiredAttachmentKindEmptyDashedBox({
  kindLabel,
  trailingAction,
}: Props) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 rounded-md border-2 border-dashed border-gray-300 dark:border-gray-600">
      <svg
        className="h-4 w-4 text-gray-400 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No {kindLabel} selected
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Required for this email template
        </p>
      </div>
      {trailingAction}
    </div>
  );
}
