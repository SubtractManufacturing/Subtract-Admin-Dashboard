import Modal from "~/components/shared/Modal";
import {
  MERGE_TOKEN_CATALOG,
  type EntityKind,
  type MergeTokenDefinition,
} from "~/lib/email/resolve";

const ENTITY_LABEL: Record<EntityKind, string> = {
  quote: "Quote",
  order: "Order",
  customer: "Customer",
  vendor: "Vendor",
};

function formatSuppliedBy(
  suppliedBy: MergeTokenDefinition["suppliedBy"],
): string {
  if (suppliedBy === "all") {
    return "All kinds (where customer data exists)";
  }
  return suppliedBy.map((k) => ENTITY_LABEL[k]).join(", ");
}

function formatPresence(presence: MergeTokenDefinition["presence"]): string {
  return presence === "always"
    ? "Always set when the send applies to this kind"
    : "Only when underlying data exists; otherwise the send fails";
}

export function EmailMergeTokensReferenceModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Merge tokens (built-in)"
      size="full"
    >
      <div className="space-y-5 text-base leading-relaxed text-gray-700 dark:text-gray-200">
        <p className="text-gray-600 dark:text-gray-300">
          Use{" "}
          <code className="rounded bg-gray-100 px-1.5 font-mono text-sm dark:bg-slate-700">
            {"{{tokenName}}"}
          </code>{" "}
          in subjects, body slots, and button text or links. Built-in tokens
          below are filled from application data for each send. You can also
          reference Snippets you define in the Snippets section as{" "}
          <code className="rounded bg-gray-100 px-1.5 font-mono text-sm dark:bg-slate-700">
            {"{{yourSnippetKey}}"}
          </code>
          . If a snippet name matches a built-in token, the built-in value
          takes precedence.
        </p>
        <div className="space-y-5">
          {MERGE_TOKEN_CATALOG.map((def) => (
            <div
              key={def.key}
              className="border-b border-gray-100 pb-5 last:border-0 last:pb-0 dark:border-slate-700"
            >
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <code className="shrink-0 font-mono text-sm font-medium text-gray-900 dark:text-white sm:text-base">
                  {`{{${def.key}}}`}
                </code>
                <span className="text-base font-semibold text-gray-800 dark:text-gray-100">
                  {def.label}
                </span>
              </div>
              <p className="text-gray-600 dark:text-gray-300">
                {def.description}
              </p>
              <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-500">
                <span className="font-medium text-gray-600 dark:text-gray-400">
                  Applies to:
                </span>{" "}
                {formatSuppliedBy(def.suppliedBy)}
                <span className="mx-2 text-gray-300 dark:text-gray-600">·</span>
                <span className="font-medium text-gray-600 dark:text-gray-400">
                  Availability:
                </span>{" "}
                {formatPresence(def.presence)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
