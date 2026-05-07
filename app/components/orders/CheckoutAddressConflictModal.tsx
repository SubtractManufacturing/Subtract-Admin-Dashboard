import { useState, useEffect } from "react";
import type { CheckoutAddressConflictPreview } from "~/lib/stripe/checkout-address-conflict.types";

type Choice = "checkout" | "on_file";

export type CheckoutAddressImportPhase =
  | "working"
  | "conflict"
  | "submitting_choices"
  | "success"
  | "noop"
  | "error";

export type CheckoutAddressImportProgressStep =
  | "connecting"
  | "fetching"
  | "comparing"
  | "applying";

export type CheckoutAddressConflictModalProps = {
  open: boolean;
  phase: CheckoutAddressImportPhase;
  /** Active progress step while phase is "working" or "submitting_choices". */
  progressStep?: CheckoutAddressImportProgressStep;
  preview: CheckoutAddressConflictPreview | null;
  /** Optional summary used in success/noop screens. */
  summary?: {
    billingUpdated?: boolean;
    shippingUpdated?: boolean;
    phoneUpdated?: boolean;
  };
  errorMessage?: string;
  onClose: () => void;
  onConfirm: (choices: {
    billingChoice?: Choice;
    shippingChoice?: Choice;
    phoneChoice?: Choice;
  }) => void;
  onRetry?: () => void;
};

const STEP_ORDER: CheckoutAddressImportProgressStep[] = [
  "connecting",
  "fetching",
  "comparing",
  "applying",
];

const STEP_LABELS: Record<CheckoutAddressImportProgressStep, string> = {
  connecting: "Connecting to payment checkout",
  fetching: "Fetching customer information from quote payment",
  comparing: "Comparing with customer record on file",
  applying: "Updating customer record",
};

function ProgressList({
  active,
  isSubmittingChoices,
}: {
  active?: CheckoutAddressImportProgressStep;
  isSubmittingChoices?: boolean;
}) {
  const activeIndex = active ? STEP_ORDER.indexOf(active) : 0;
  return (
    <ul className="space-y-2">
      {STEP_ORDER.map((step, idx) => {
        const isApplying = step === "applying";
        const isSkipped = isApplying && !isSubmittingChoices && active !== "applying";
        const isCurrent = idx === activeIndex;
        const isDone = idx < activeIndex;
        return (
          <li
            key={step}
            className="flex items-center gap-3 text-sm"
            aria-current={isCurrent ? "step" : undefined}
          >
            <span
              className={`relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                isDone
                  ? "border-green-500 bg-green-500"
                  : isCurrent
                    ? "border-blue-500"
                    : "border-gray-300 dark:border-gray-600"
              }`}
            >
              {isDone ? (
                <svg
                  viewBox="0 0 20 20"
                  className="h-3 w-3 text-white"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : isCurrent ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
              ) : null}
            </span>
            <span
              className={`${
                isDone
                  ? "text-gray-700 dark:text-gray-200"
                  : isCurrent
                    ? "text-gray-900 dark:text-gray-100 font-medium"
                    : isSkipped
                      ? "text-gray-400 dark:text-gray-500 line-through"
                      : "text-gray-500 dark:text-gray-400"
              }`}
            >
              {STEP_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function StatusIcon({ kind }: { kind: "success" | "noop" | "error" }) {
  if (kind === "success") {
    return (
      <svg
        className="h-6 w-6 text-green-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M5 13l4 4L19 7"
        />
      </svg>
    );
  }
  if (kind === "noop") {
    return (
      <svg
        className="h-6 w-6 text-gray-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M12 22a10 10 0 110-20 10 10 0 010 20z"
        />
      </svg>
    );
  }
  return (
    <svg
      className="h-6 w-6 text-red-500"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z"
      />
    </svg>
  );
}

export default function CheckoutAddressConflictModal({
  open,
  phase,
  progressStep,
  preview,
  summary,
  errorMessage,
  onClose,
  onConfirm,
  onRetry,
}: CheckoutAddressConflictModalProps) {
  const [billing, setBilling] = useState<Choice | null>(null);
  const [shipping, setShipping] = useState<Choice | null>(null);
  const [phone, setPhone] = useState<Choice | null>(null);

  useEffect(() => {
    if (open && preview) {
      setBilling(null);
      setShipping(null);
      setPhone(null);
    }
    // We intentionally key this effect on `preview?.quoteId` rather than the
    // full `preview` object so the choices only reset when the modal opens
    // for a new quote, not on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preview?.quoteId]);

  if (!open) return null;

  const needBilling = preview?.chooseBilling ?? false;
  const needShipping = preview?.chooseShipping ?? false;
  const needPhone = preview?.choosePhone ?? false;

  const submittingChoices = phase === "submitting_choices";

  const canSubmit =
    !!preview &&
    (!needBilling || billing !== null) &&
    (!needShipping || shipping !== null) &&
    (!needPhone || phone !== null) &&
    !submittingChoices;

  const handleConfirm = () => {
    if (!canSubmit) return;
    onConfirm({
      ...(needBilling ? { billingChoice: billing! } : {}),
      ...(needShipping ? { shippingChoice: shipping! } : {}),
      ...(needPhone ? { phoneChoice: phone! } : {}),
    });
  };

  const ChoiceRow = ({
    label,
    checkoutLabel,
    onFileLabel,
    value,
    onChange,
    show,
    radioName,
  }: {
    label: string;
    checkoutLabel: string;
    onFileLabel: string;
    value: Choice | null;
    onChange: (c: Choice) => void;
    show: boolean;
    radioName: string;
  }) => {
    if (!show) return null;
    return (
      <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 space-y-3">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {label}
        </p>
        <div className="grid gap-2 sm:grid-cols-2 text-sm">
          <label className="flex cursor-pointer gap-2 rounded-md border border-gray-200 dark:border-gray-600 p-3 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50/50 dark:has-[:checked]:bg-blue-950/30">
            <input
              type="radio"
              name={radioName}
              checked={value === "checkout"}
              onChange={() => onChange("checkout")}
              className="mt-0.5"
              disabled={submittingChoices}
            />
            <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {checkoutLabel}
            </span>
          </label>
          <label className="flex cursor-pointer gap-2 rounded-md border border-gray-200 dark:border-gray-600 p-3 has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50/50 dark:has-[:checked]:bg-blue-950/30">
            <input
              type="radio"
              name={radioName}
              checked={value === "on_file"}
              onChange={() => onChange("on_file")}
              className="mt-0.5"
              disabled={submittingChoices}
            />
            <span className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
              {onFileLabel}
            </span>
          </label>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Import addresses from quote payment
        </h2>

        {phase === "working" && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Looking up the latest payment checkout for this order&rsquo;s
              quote and comparing the captured information with your customer
              record.
            </p>
            <ProgressList active={progressStep} />
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </>
        )}

        {phase === "conflict" && preview && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              We compared what the customer entered at payment checkout to what
              you have on file. Pick which version to keep for each section
              below. Nothing is saved until you confirm.
            </p>

            <ChoiceRow
              label="Billing address"
              checkoutLabel={`From checkout:\n${preview.stripeBillingText || "—"}`}
              onFileLabel={`On file:\n${preview.onFileBillingText || "—"}`}
              value={billing}
              onChange={setBilling}
              show={needBilling}
              radioName="billing-import-src"
            />

            <ChoiceRow
              label="Shipping address"
              checkoutLabel={`From checkout:\n${preview.stripeShippingText || "—"}`}
              onFileLabel={`On file:\n${preview.onFileShippingText || "—"}`}
              value={shipping}
              onChange={setShipping}
              show={needShipping}
              radioName="shipping-import-src"
            />

            <ChoiceRow
              label="Phone"
              checkoutLabel={`From checkout:\n${preview.stripePhone || "—"}`}
              onFileLabel={`On file:\n${preview.onFilePhone || "—"}`}
              value={phone}
              onChange={setPhone}
              show={needPhone}
              radioName="phone-import-src"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submittingChoices}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={handleConfirm}
                className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submittingChoices ? "Saving…" : "Confirm"}
              </button>
            </div>
          </>
        )}

        {phase === "submitting_choices" && preview && (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Saving your selections to the customer record…
            </p>
            <ProgressList active="applying" isSubmittingChoices />
          </>
        )}

        {phase === "success" && (
          <>
            <div className="flex items-start gap-3">
              <StatusIcon kind="success" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Customer record updated
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Imported {[
                    summary?.billingUpdated ? "billing address" : null,
                    summary?.shippingUpdated ? "shipping address" : null,
                    summary?.phoneUpdated ? "phone" : null,
                  ]
                    .filter(Boolean)
                    .join(", ") || "address information"}{" "}
                  from the latest payment checkout.
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Done
              </button>
            </div>
          </>
        )}

        {phase === "noop" && (
          <>
            <div className="flex items-start gap-3">
              <StatusIcon kind="noop" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Nothing to update
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {errorMessage ??
                    "The customer record already matches the latest payment checkout."}
                </p>
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
              >
                Close
              </button>
            </div>
          </>
        )}

        {phase === "error" && (
          <>
            <div className="flex items-start gap-3">
              <StatusIcon kind="error" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  Couldn&rsquo;t import addresses
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  {errorMessage ??
                    "Something went wrong reading from the payment checkout."}
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Close
              </button>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-4 py-2 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700"
                >
                  Try again
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
