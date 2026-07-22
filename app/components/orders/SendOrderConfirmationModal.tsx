import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { useFetcher, useRevalidator } from "@remix-run/react";
import Modal from "~/components/shared/Modal";
import Button from "~/components/shared/Button";
import { RequiredAttachmentKindEmptyDashedBox } from "~/components/shared/RequiredAttachmentKindEmptyDashedBox";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { EMAIL_CONTEXT } from "~/lib/email/email-context-registry";
import { ATTACHMENT_DOCUMENT_KIND_LABELS } from "~/lib/email/attachment-document-kind-labels";
import type { AttachmentDocumentKind } from "~/lib/db/schema";
import { emailPreviewInlineEditCss } from "~/lib/pdf-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

type AttachmentData = {
  id: string;
  fileName: string;
  fileSize: number | null;
  documentKind: string | null;
  createdAt: string;
  contentType?: string | null;
};

type CustomerData = {
  email: string | null;
  displayName: string | null;
};

type EditableSlot = {
  id: string;
  type: "plainText" | "markdown";
  adminLabel: string;
  templateValue: string;
};

type SendQueueDelivery = "queued" | "awaiting_approval";

/** Kinds the order page can create via PDF modals (see Generate*PdfModal on order route). */
const ORDER_PDF_GENERATABLE_KINDS = [
  "invoice",
  "order_confirmation",
  "purchase_order",
  "packing_slip",
] as const satisfies readonly AttachmentDocumentKind[];

function isGeneratableOnOrderPage(
  kind: AttachmentDocumentKind,
): kind is (typeof ORDER_PDF_GENERATABLE_KINDS)[number] {
  return (ORDER_PDF_GENERATABLE_KINDS as readonly string[]).includes(kind);
}

function generateButtonText(
  kind: (typeof ORDER_PDF_GENERATABLE_KINDS)[number],
): string {
  switch (kind) {
    case "invoice":
      return "Generate invoice";
    case "order_confirmation":
      return "Generate order confirmation";
    case "purchase_order":
      return "Generate purchase order";
    case "packing_slip":
      return "Generate packing slip";
  }
}

/** Outbound order confirmation: registry ~/lib/email/email-context-registry (ORDER_CONFIRMATION) */
interface SendOrderConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendSuccess?: (result: { delivery: SendQueueDelivery }) => void;
  order: { id: number; orderNumber: string; updatedAt: string | Date };
  customer: CustomerData | null;
  attachments: AttachmentData[];
  defaultSubject?: string;
  editableSlots: EditableSlot[];
  requiredAttachmentDocumentKinds: AttachmentDocumentKind[];
  /**
   * Opens the matching in-app PDF flow (invoice, order confirmation, purchase order, packing slip).
   * Quote PDFs are not generated on the order page — use upload or existing attachments.
   */
  onRequestGenerateForDocumentKind?: (kind: AttachmentDocumentKind) => void;
  /** No customer — invoice / packing slip generation unavailable */
  invoiceGenerateDisabled?: boolean;
  /** No customer — order confirmation PDF generation unavailable */
  orderConfirmationGenerateDisabled?: boolean;
  /** No vendor — purchase order generation unavailable */
  purchaseOrderGenerateDisabled?: boolean;
  /** No customer — packing slip generation unavailable */
  packingSlipGenerateDisabled?: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_EMAIL_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number | null): string {
  if (!bytes) return "unknown size";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ─── Iframe editing helper ────────────────────────────────────────────────────

/**
 * Injects shared PDF-style {@link emailPreviewInlineEditCss} and a script that:
 * - plainText: `contentEditable` + class `editable`, commit on `blur` via `postMessage`
 * - markdown: click to swap in a yellow-styled `textarea` (raw markdown in `postMessage`)
 */
function injectEditingScript(
  html: string,
  slotOverrides: Record<string, string>,
  editableSlots: EditableSlot[],
): string {
  if (editableSlots.length === 0) return html;

  const slotData: Record<string, string> = {};
  for (const slot of editableSlots) {
    slotData[slot.id] = slotOverrides[slot.id] ?? slot.templateValue;
  }

  const typeById = Object.fromEntries(
    editableSlots.map((s) => [s.id, s.type] as const),
  );

  const styleBlock = emailPreviewInlineEditCss;
  const script = `<script>(function(){
var d=document,sd=${JSON.stringify(slotData)},types=${JSON.stringify(typeById)};
var s=d.createElement("style");
s.textContent=${JSON.stringify(styleBlock)};
d.head.appendChild(s);
var activeMdSlot=null;
d.querySelectorAll("[data-slot-id]").forEach(function(el){
  var sid=el.getAttribute("data-slot-id");
  if(!sid||!Object.prototype.hasOwnProperty.call(types,sid))return;
  var st=types[sid];
  if(st==="markdown"){
    el.classList.add("email-md-slot");
    el.addEventListener("click",function(){
      if(activeMdSlot)return;
      activeMdSlot=sid;
      var oh=el.innerHTML;
      var ta=d.createElement("textarea");
      ta.value=sd[sid]||"";
      var rows=ta.value.split("\\n").length;
      ta.rows=rows>1?Math.min(16,rows+1):3;
      ta.style.cssText="display:block;width:100%;min-height:64px;padding:8px 10px;border:2px solid #ffc107;border-radius:4px;font-family:inherit;font-size:inherit;line-height:1.5;resize:vertical;box-sizing:border-box;background:#fff8dc;color:#1e1e1e;outline:none;";
      el.classList.remove("email-md-slot");
      el.innerHTML="";
      el.appendChild(ta);
      requestAnimationFrame(function(){ta.focus();});
      var committed=false;
      function commit(){
        if(committed)return;
        committed=true;
        var nv=ta.value;
        el.innerHTML=oh;
        el.classList.add("email-md-slot");
        activeMdSlot=null;
        window.parent.postMessage({type:"__slot_edit",slotId:sid,value:nv},"*");
      }
      ta.addEventListener("blur",commit);
      ta.addEventListener("keydown",function(e){
        if(e.key==="Enter"&&(e.ctrlKey||e.metaKey))commit();
        if(e.key==="Escape"){
          committed=true;
          ta.removeEventListener("blur",commit);
          el.innerHTML=oh;
          el.classList.add("email-md-slot");
          activeMdSlot=null;
        }
      });
    });
    return;
  }
  el.contentEditable="true";
  el.setAttribute("spellcheck","true");
  el.classList.add("editable");
  el.tabIndex=0;
  el.addEventListener("blur",function(){
    var v=el.textContent!=null?el.textContent:"";
    window.parent.postMessage({type:"__slot_edit",slotId:sid,value:v},"*");
  });
});
})()
\x3c/script>`;

  return html.includes("</body>")
    ? html.replace("</body>", script + "</body>")
    : html + script;
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SendOrderConfirmationModal({
  isOpen,
  onClose,
  onSendSuccess,
  order,
  customer,
  attachments,
  defaultSubject,
  editableSlots,
  requiredAttachmentDocumentKinds,
  onRequestGenerateForDocumentKind,
  invoiceGenerateDisabled = false,
  orderConfirmationGenerateDisabled = false,
  purchaseOrderGenerateDisabled = false,
  packingSlipGenerateDisabled = false,
}: SendOrderConfirmationModalProps) {
  const submitFetcher = useFetcher<{
    success?: boolean;
    error?: string;
    delivery?: SendQueueDelivery;
  }>();
  const previewFetcher = useFetcher<{ subject?: string; html?: string; error?: string }>();
  const uploadFetcher = useFetcher<{ success?: boolean; attachmentId?: string; error?: string }>();
  const revalidator = useRevalidator();
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Delivery fields ──
  const [subject, setSubject] = useState(defaultSubject ?? "");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const ccInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (showCc) {
      ccInputRef.current?.focus();
    }
  }, [showCc]);

  // ── Per-send slot overrides ──
  const [slotOverrides, setSlotOverrides] = useState<Record<string, string>>(
    () => Object.fromEntries(editableSlots.map((s) => [s.id, s.templateValue])),
  );

  // Ref that always holds the latest overrides — used when baking values into the
  // iframe script (captured at the moment the preview HTML arrives, not reactively)
  const latestSlotOverridesRef = useRef(slotOverrides);
  useEffect(() => {
    latestSlotOverridesRef.current = slotOverrides;
  }, [slotOverrides]);

  // ── Attachment state ──
  const requiredKindSet = useMemo(
    () => new Set(requiredAttachmentDocumentKinds),
    [requiredAttachmentDocumentKinds],
  );

  const [selectedPrimaryByKind, setSelectedPrimaryByKind] = useState<
    Partial<Record<AttachmentDocumentKind, string | null>>
  >({});
  const [selectedOptionalIds, setSelectedOptionalIds] = useState<string[]>([]);

  // ── Attachment viewer ──
  const [viewingAttachment, setViewingAttachment] = useState<AttachmentData | null>(null);

  // ── File upload ──
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Error state ──
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showRequiredAttachmentError, setShowRequiredAttachmentError] =
    useState(false);

  // ── Editable preview HTML (script injected client-side) ──
  const [editableHtml, setEditableHtml] = useState<string | null>(null);

  // ── Reset on open ──
  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = crypto.randomUUID();
      setSubject(defaultSubject ?? "");
      setCc("");
      setShowCc(false);
      setSlotOverrides(Object.fromEntries(editableSlots.map((s) => [s.id, s.templateValue])));
      setSelectedOptionalIds([]);
      setSubmitError(null);
      setShowRequiredAttachmentError(false);
      setEditableHtml(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Re-evaluate required primary selections when attachments or template config change ──
  useEffect(() => {
    const next: Partial<Record<AttachmentDocumentKind, string | null>> = {};
    for (const kind of requiredAttachmentDocumentKinds) {
      const list = attachments
        .filter((a) => a.documentKind === kind)
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      const latest = list[0] ?? null;
      next[kind] = latest?.id ?? null;
    }
    setSelectedPrimaryByKind(next);
  }, [attachments, requiredAttachmentDocumentKinds]);

  // ── Upload success → revalidate ──
  useEffect(() => {
    if (uploadFetcher.data?.success) {
      revalidator.revalidate();
    }
  }, [uploadFetcher.data, revalidator]);

  // ── Preview fetching (debounced) ──
  const refreshPreview = useCallback(() => {
    if (!isOpen) return;
    const fd = new FormData();
    fd.set("intent", "emailPreview");
    fd.set("contextKey", EMAIL_CONTEXT.ORDER_CONFIRMATION);
    fd.set("entityId", String(order.id));
    fd.set("subject", subject);
    for (const [id, value] of Object.entries(slotOverrides)) {
      fd.set(`slot.${id}`, value);
    }
    previewFetcher.submit(fd, {
      method: "post",
      action: `/orders/${order.orderNumber}`,
    });
  }, [isOpen, order.id, order.orderNumber, subject, slotOverrides, previewFetcher]);

  useEffect(() => {
    if (!isOpen) return;
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(refreshPreview, 600);
    return () => {
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, subject, slotOverrides]);

  // ── Build editable HTML when preview arrives (bakes slot values into the script) ──
  useEffect(() => {
    const html = previewFetcher.data?.html;
    if (!html) return;
    setEditableHtml(
      injectEditingScript(html, latestSlotOverridesRef.current, editableSlots),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewFetcher.data?.html]);

  // ── Listen for slot edits posted from within the iframe ──
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (typeof e.data !== "object" || e.data?.type !== "__slot_edit") return;
      const { slotId, value } = e.data as { slotId: string; value: string };
      if (typeof slotId !== "string" || typeof value !== "string") return;
      setSlotOverrides((prev) => ({ ...prev, [slotId]: value }));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // ── Submit handling ──
  useEffect(() => {
    if (submitFetcher.data?.success) {
      const delivery = submitFetcher.data.delivery ?? "queued";
      onSendSuccess?.({ delivery });
      onClose();
      revalidator.revalidate();
    } else if (submitFetcher.data?.error) {
      setSubmitError(submitFetcher.data.error);
    }
  }, [submitFetcher.data, onClose, onSendSuccess, revalidator]);

  // ── Size calculations ──
  const primaryAttachmentIds = useMemo(
    () =>
      requiredAttachmentDocumentKinds
        .map((k) => selectedPrimaryByKind[k])
        .filter((id): id is string => id != null && id.length > 0),
    [requiredAttachmentDocumentKinds, selectedPrimaryByKind],
  );
  const allSelectedIds = useMemo(
    () => [
      ...new Set([...primaryAttachmentIds, ...selectedOptionalIds]),
    ],
    [primaryAttachmentIds, selectedOptionalIds],
  );
  const totalSize = attachments
    .filter((a) => allSelectedIds.includes(a.id))
    .reduce((sum, a) => sum + (a.fileSize ?? 0), 0);
  const isOverSizeLimit = totalSize > MAX_EMAIL_ATTACHMENT_BYTES;

  // ── Validation ──
  const allRequiredPrimariesSelected =
    requiredAttachmentDocumentKinds.length === 0 ||
    requiredAttachmentDocumentKinds.every(
      (k) => (selectedPrimaryByKind[k] ?? null) != null,
    );

  const missingKinds = requiredAttachmentDocumentKinds.filter(
    (k) => (selectedPrimaryByKind[k] ?? null) == null,
  );

  const sendButtonHardDisabled =
    isOverSizeLimit || submitFetcher.state !== "idle";

  useEffect(() => {
    if (allRequiredPrimariesSelected) {
      setShowRequiredAttachmentError(false);
    }
  }, [allRequiredPrimariesSelected]);

  // ── Submit ──
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sendButtonHardDisabled) return;
    if (!allRequiredPrimariesSelected) {
      setShowRequiredAttachmentError(true);
      return;
    }
    setShowRequiredAttachmentError(false);
    if (subject.trim().length === 0) return;
    setSubmitError(null);

    const formData = new FormData();
    formData.set("intent", "emailQueue");
    formData.set("idempotencyKey", idempotencyKeyRef.current);
    formData.set("subject", subject);
    if (cc) formData.set("cc", cc);
    formData.set("contextKey", EMAIL_CONTEXT.ORDER_CONFIRMATION);
    formData.set("entityType", "order");
    formData.set("entityId", String(order.id));
    for (const id of allSelectedIds) {
      formData.append("attachmentId", id);
    }
    for (const [id, value] of Object.entries(slotOverrides)) {
      formData.set(`slot.${id}`, value);
    }
    submitFetcher.submit(formData, {
      method: "post",
      action: `/orders/${order.orderNumber}`,
    });
  };

  const optionalAttachments = attachments.filter(
    (a) => a.documentKind == null || !requiredKindSet.has(a.documentKind as AttachmentDocumentKind),
  );

  const isGenerateDisabled = useCallback(
    (kind: AttachmentDocumentKind) => {
      if (!isGeneratableOnOrderPage(kind) || !onRequestGenerateForDocumentKind) {
        return true;
      }
      if (kind === "invoice" && invoiceGenerateDisabled) return true;
      if (kind === "order_confirmation" && orderConfirmationGenerateDisabled) {
        return true;
      }
      if (kind === "purchase_order" && purchaseOrderGenerateDisabled) return true;
      if (kind === "packing_slip" && packingSlipGenerateDisabled) return true;
      return false;
    },
    [
      onRequestGenerateForDocumentKind,
      invoiceGenerateDisabled,
      orderConfirmationGenerateDisabled,
      purchaseOrderGenerateDisabled,
      packingSlipGenerateDisabled,
    ],
  );

  const generateDisabledTitle = (kind: AttachmentDocumentKind) => {
    if (kind === "invoice" && invoiceGenerateDisabled) {
      return "Invoices require a customer on the order";
    }
    if (kind === "order_confirmation" && orderConfirmationGenerateDisabled) {
      return "Order confirmations require a customer on the order";
    }
    if (kind === "purchase_order" && purchaseOrderGenerateDisabled) {
      return "Purchase orders require a vendor on the order";
    }
    if (kind === "packing_slip" && packingSlipGenerateDisabled) {
      return "Packing slips require a customer on the order";
    }
    return undefined;
  };

  const toggleOptional = (id: string) => {
    setSelectedOptionalIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  // ─── Primary document chip (required template kinds) ─────────────────────
  const setPrimaryIdForKind = (kind: AttachmentDocumentKind, id: string) => {
    setSelectedPrimaryByKind((p) => ({ ...p, [kind]: id }));
  };

  const clearPrimaryForKind = (kind: AttachmentDocumentKind) => {
    setSelectedPrimaryByKind((p) => ({ ...p, [kind]: null }));
  };

  const renderPrimaryChip = (
    kind: AttachmentDocumentKind,
    file: AttachmentData,
  ) => {
    const viewUrl = `/download/attachment/${file.id}?inline`;
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-md border bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700">
        <svg className="h-4 w-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>

        <button
          type="button"
          onClick={() =>
            setViewingAttachment({
              ...file,
              contentType: file.contentType ?? "application/pdf",
            })
          }
          title="Click to preview"
          className="flex-1 min-w-0 truncate text-sm font-medium text-left underline underline-offset-2 decoration-dotted text-blue-800 dark:text-blue-200 hover:text-blue-900 dark:hover:text-blue-100"
        >
          {file.fileName}
        </button>

        <span className="shrink-0 text-xs text-blue-600 dark:text-blue-400">
          {formatBytes(file.fileSize)}
        </span>

        <button
          type="button"
          onClick={() => clearPrimaryForKind(kind)}
          title="Remove from email"
          className="shrink-0 rounded p-0.5 transition-colors text-blue-300 hover:text-blue-700 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <input type="hidden" name={`__viewUrl_${file.id}`} value={viewUrl} />
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title="Send order confirmation"
        size="full"
        zIndex={55}
      >
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {showRequiredAttachmentError && missingKinds.length > 0 && (
            <div
              role="alert"
              className="shrink-0 mx-6 mt-4 rounded-md border border-red-300 dark:border-red-700 bg-red-100 dark:bg-red-950/60 px-4 py-3 text-sm font-medium text-red-900 dark:text-red-100"
            >
              Attach{" "}
              {missingKinds
                .map((k) => ATTACHMENT_DOCUMENT_KIND_LABELS[k])
                .join(" and ")}{" "}
              before sending.
            </div>
          )}
          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* ── Delivery ── */}
            <div className="space-y-2.5">
              {/* To + inline CC toggle */}
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">
                  To
                </span>
                <div className="flex-1 flex items-center h-9 px-3 rounded-md bg-gray-100 dark:bg-gray-700 text-sm text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 min-w-0">
                  <span className="truncate flex-1">
                    {customer?.email ?? (
                      <span className="text-red-500">No email address</span>
                    )}
                  </span>
                  {!showCc && (
                    <button
                      type="button"
                      onClick={() => setShowCc(true)}
                      className="ml-3 shrink-0 text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                    >
                      + CC
                    </button>
                  )}
                </div>
              </div>

              {/* CC (only shown when expanded) */}
              {showCc && (
                <div className="flex items-center gap-3">
                  <span className="w-14 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">
                    CC
                  </span>
                  <input
                    ref={ccInputRef}
                    type="text"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    placeholder="comma-separated addresses"
                    className="flex-1 h-9 px-3 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {/* Subject */}
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-sm font-medium text-gray-500 dark:text-gray-400">
                  Subject
                </span>
                <input
                  type="text"
                  required
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="flex-1 h-9 px-3 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* ── Email preview (with inline editing) ── */}
            <div className="rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-750 border-b border-gray-200 dark:border-gray-700">
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                  Preview
                  {editableSlots.length > 0 && (
                    <span className="ml-1.5 font-normal text-gray-400/70 dark:text-gray-500/70">
                      — click to edit; markdown blocks use a source editor
                    </span>
                  )}
                </span>
                {previewFetcher.state !== "idle" && (
                  <svg
                    className="animate-spin h-3 w-3 text-gray-400"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </div>
              {previewFetcher.data?.error ? (
                <div className="p-4 bg-red-50 dark:bg-red-900/20 text-sm text-red-700 dark:text-red-300">
                  Preview unavailable: {previewFetcher.data.error}
                </div>
              ) : editableHtml ? (
                <div className="p-1 sm:p-2 bg-white dark:bg-gray-900">
                  <iframe
                    title="Email preview"
                    srcDoc={editableHtml}
                    className="w-full bg-white"
                    style={{ height: "420px", border: "none" }}
                    sandbox="allow-scripts allow-same-origin"
                  />
                </div>
              ) : (
                <div className="h-28 flex items-center justify-center text-sm text-gray-400 dark:text-gray-500">
                  Loading preview…
                </div>
              )}
            </div>

            {/* ── Attachments ── */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2.5">
                Attachments
              </p>

              {requiredAttachmentDocumentKinds.map((kind) => {
                const label = ATTACHMENT_DOCUMENT_KIND_LABELS[kind];
                const forKind = attachments
                  .filter((a) => a.documentKind === kind)
                  .sort(
                    (a, b) =>
                      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
                  );
                const selectedId = selectedPrimaryByKind[kind] ?? null;
                const selected = selectedId
                  ? attachments.find((a) => a.id === selectedId) ?? null
                  : null;
                const showGenerate =
                  onRequestGenerateForDocumentKind &&
                  isGeneratableOnOrderPage(kind);
                return (
                  <div key={kind} className="mb-3">
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-1.5 font-medium">
                      {label}
                    </p>
                    {selected ? (
                      <>
                        {renderPrimaryChip(kind, selected)}

                        {forKind.filter((f) => f.id !== selectedId).length > 0 && (
                          <div className="mt-1.5 pl-1">
                            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">Other versions:</p>
                            <div className="space-y-1">
                              {forKind
                                .filter((f) => f.id !== selectedId)
                                .map((f) => (
                                <label key={f.id} className="flex items-center gap-2 text-xs cursor-pointer">
                                  <input
                                    type="radio"
                                    name={`primaryDoc_${kind}`}
                                    checked={selectedId === f.id}
                                    onChange={() => setPrimaryIdForKind(kind, f.id)}
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setViewingAttachment({
                                        ...f,
                                        contentType: f.contentType ?? "application/pdf",
                                      })
                                    }
                                    className="flex-1 truncate text-left text-gray-500 dark:text-gray-400 underline underline-offset-2 decoration-dotted hover:text-blue-500"
                                  >
                                    {f.fileName}
                                  </button>
                                  <span className="text-gray-400">{formatBytes(f.fileSize)}</span>
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mb-1 space-y-2">
                        <RequiredAttachmentKindEmptyDashedBox
                          kindLabel={label}
                          trailingAction={
                            showGenerate ? (
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={isGenerateDisabled(kind)}
                                title={
                                  generateDisabledTitle(kind) ??
                                  "Create a new PDF and attach it to the order"
                                }
                                onClick={() =>
                                  onRequestGenerateForDocumentKind!(kind)
                                }
                              >
                                {generateButtonText(kind)}
                              </Button>
                            ) : null
                          }
                        />

                        {forKind.length > 0 && (
                          <div className="pl-1 space-y-1">
                            {forKind.map((f) => (
                              <label key={f.id} className="flex items-center gap-2 text-xs cursor-pointer">
                                <input
                                  type="radio"
                                  name={`primaryDoc_empty_${kind}`}
                                  checked={false}
                                  onChange={() => setPrimaryIdForKind(kind, f.id)}
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    setViewingAttachment({
                                      ...f,
                                      contentType: f.contentType ?? "application/pdf",
                                    })
                                  }
                                  className="flex-1 truncate text-left text-gray-500 dark:text-gray-400 underline underline-offset-2 decoration-dotted hover:text-blue-500"
                                >
                                  {f.fileName}
                                </button>
                                <span className="text-gray-400">{formatBytes(f.fileSize)}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Optional additional files + upload */}
              <div className="rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden">
                {optionalAttachments.length > 0 && (
                  <div className="divide-y divide-gray-100 dark:divide-gray-700/60 max-h-36 overflow-y-auto">
                    {optionalAttachments.map((a) => {
                      const checked = selectedOptionalIds.includes(a.id);
                      const wouldExceed = !checked && totalSize + (a.fileSize ?? 0) > MAX_EMAIL_ATTACHMENT_BYTES;
                      return (
                        <label key={a.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-750">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={wouldExceed}
                            onChange={() => toggleOptional(a.id)}
                            className="rounded"
                          />
                          <button
                            type="button"
                            onClick={() => setViewingAttachment(a)}
                            className="flex-1 min-w-0 truncate text-left text-gray-700 dark:text-gray-300 underline underline-offset-2 decoration-dotted hover:text-blue-500"
                          >
                            {a.fileName}
                          </button>
                          <span className="shrink-0 text-xs text-gray-400">{formatBytes(a.fileSize)}</span>
                        </label>
                      );
                    })}
                  </div>
                )}

                {/* Upload new attachment */}
                <div className="px-3 py-2 border-t border-gray-100 dark:border-gray-700/60 first:border-t-0">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="sr-only"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const fd = new FormData();
                        fd.append("file", file);
                        fd.append("intent", "uploadAttachment");
                        fd.append("_noRedirect", "1");
                        uploadFetcher.submit(fd, {
                          method: "post",
                          action: `/orders/${order.orderNumber}`,
                          encType: "multipart/form-data",
                        });
                        // Reset input so the same file can be re-uploaded
                        e.target.value = "";
                      }}
                    />
                    {uploadFetcher.state !== "idle" ? (
                      <span className="text-sm text-gray-400 flex items-center gap-1.5">
                        <svg className="animate-spin h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Uploading…
                      </span>
                    ) : (
                      <span className="text-sm text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 transition-colors flex items-center gap-1.5">
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add attachment
                      </span>
                    )}
                  </label>
                  {uploadFetcher.data?.error && (
                    <p className="mt-1 text-xs text-red-500">{uploadFetcher.data.error}</p>
                  )}
                </div>
              </div>

              {/* Size meter */}
              <div className="mt-1.5 flex justify-between text-xs">
                <span className={isOverSizeLimit ? "text-red-500 font-medium" : "text-gray-400 dark:text-gray-500"}>
                  {(totalSize / 1024 / 1024).toFixed(2)} MB / 10 MB
                </span>
                {isOverSizeLimit && <span className="text-red-500">Exceeds 10 MB limit</span>}
              </div>
            </div>

            {/* Submit error */}
            {submitError && (
              <div className="px-4 py-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 text-sm text-red-700 dark:text-red-300">
                {submitError}
              </div>
            )}
          </div>

          {/* ── Sticky footer ── */}
          <div className="shrink-0 border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={sendButtonHardDisabled}
              title={
                isOverSizeLimit
                  ? "Attachments exceed 10 MB limit"
                  : undefined
              }
            >
              {submitFetcher.state !== "idle" ? "Sending…" : "Send confirmation email"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Attachment viewer — stacks above all other modals */}
      {viewingAttachment && (
        <FileViewerModal
          isOpen={true}
          onClose={() => setViewingAttachment(null)}
          fileUrl={`/download/attachment/${viewingAttachment.id}?inline`}
          fileName={viewingAttachment.fileName}
          contentType={viewingAttachment.contentType ?? undefined}
          fileSize={viewingAttachment.fileSize ?? undefined}
          zIndex={65}
        />
      )}
    </>
  );
}
