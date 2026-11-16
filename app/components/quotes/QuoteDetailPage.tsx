import {
  useLoaderData,
  useFetcher,
  useRevalidator,
  useRouteError,
  isRouteErrorResponse,
  Link,
} from "@remix-run/react";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  daysUntil,
  describeQuoteReceivedResendPrompt,
  formatQuoteDate as formatDate,
  formatQuoteDateTime as formatDateTime,
  formatQuoteMoney as formatCurrency,
  quoteSectionLocks,
  quoteStatusBadgeClasses as getStatusClasses,
  sortQuoteLineItems,
  sumLineTotals,
} from "~/lib/quote-detail/view";
import {
  hasConvertingQuoteParts,
  planQuoteLineItemEdit,
  type LineItemEditField,
} from "~/lib/quote-detail/line-item-edit";
import { quotePositiveSubtotalExcluding } from "~/lib/lineItemPricing";
import { usePolling } from "~/hooks/usePolling";
import Button from "~/components/shared/Button";
import { NdaRequiredBanner } from "~/components/shared/NdaRequiredBanner";
import Breadcrumbs from "~/components/Breadcrumbs";
import { AttachmentsSection } from "~/components/shared/AttachmentsSection";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { usePartAssetAdminAccess } from "~/components/admin/PartAssetAdminFlyout";
import Modal from "~/components/shared/Modal";
import { Notes } from "~/components/shared/Notes";
import { EventTimeline } from "~/components/EventTimeline";
import { AddLineItemModal } from "~/components/shared/AddLineItemModal";
import { LineItemsSection } from "~/components/shared/LineItemsSection";
import { IconButton } from "~/components/shared/IconButton";
import { FilePlusCorner } from "lucide-react";
import QuoteActionsDropdown from "~/components/quotes/QuoteActionsDropdown";
import ReceivePoModal from "~/components/quotes/ReceivePoModal";
import type { ReceivePoActionData } from "~/components/quotes/ReceivePoModal";
import QuotePriceCalculatorModal from "~/components/quotes/QuotePriceCalculatorModal";
import QuoteDeliveryDateCard from "~/components/quotes/QuoteDeliveryDateCard";
import { formatLeadTimeBusinessDays } from "~/lib/business-days";
import GenerateQuotePdfModal from "~/components/quotes/GenerateQuotePdfModal";
import GenerateInvoicePdfModal from "~/components/orders/GenerateInvoicePdfModal";
import { HiddenThumbnailGenerator } from "~/components/HiddenThumbnailGenerator";
import { Part3DViewerModal } from "~/components/shared/Part3DViewerModal";
import SendQuoteEmailModal from "~/components/quotes/SendQuoteEmailModal";
import { useDownload } from "~/hooks/useDownload";
import {
  normalizeQuoteLineItems,
  type NormalizedDrawing,
  type NormalizedLineItem,
  type NormalizedPart,
} from "~/components/shared/line-items/types";
import type { loader } from "~/routes/_protected.quotes.$quoteId";

export default function QuoteDetailPage() {
  const {
    quote,
    customer,
    vendor,
    customers,
    vendors,
    notes,
    attachments,
    user,
    userDetails,
    priceCalculations,
    canAccessPriceCalculator,
    pdfAutoDownload,
    rejectionReasonRequired,
    events,
    convertedOrder,
    canRevise,
    bananaEnabled,
    bananaModelUrl,
    stripeEnabled,
    outboundEmailEnabled,
    hideLineItemThumbnails,
    quoteSendEmailReady,
    quoteSendEmailDefaultSubject,
    quoteSendEditableSlots,
    quoteSendRequiredAttachmentDocumentKinds,
    archivedLineItems,
    archiveRetentionDays,
    quoteReceivedEmailReadiness,
    quoteReceivedLastSend,
  } = useLoaderData<typeof loader>();
  const partAssetAdminAction = usePartAssetAdminAccess()
    ? `/quotes/${quote.id}`
    : undefined;
  const fetcher = useFetcher();
  const quoteReceivedFetcher = useFetcher<{
    success?: boolean;
    error?: string;
  }>();
  const receivePoFetcher = useFetcher<ReceivePoActionData>();
  const revalidator = useRevalidator();
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isWaitingForSentStatus, setIsWaitingForSentStatus] = useState(false);
  const [isAddLineItemModalOpen, setIsAddLineItemModalOpen] = useState(false);
  const [promoteLineItemTarget, setPromoteLineItemTarget] = useState<{
    id: number;
    name: string;
    quantity: number;
    unitPrice: string;
    totalPrice?: string;
    description?: string;
    notes?: string;
  } | null>(null);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [isSendEmailModalOpen, setSendEmailModalOpen] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isCustomerInfoModalOpen, setIsCustomerInfoModalOpen] = useState(false);
  const [isLeadTimeModalOpen, setIsLeadTimeModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState(false);
  // Define the line item type
  type LineItem = {
    id: number;
    quotePartId: string | null;
    name: string | null;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    leadTimeDays: number | null;
    description: string | null;
    notes: string | null;
  };

  const [optimisticLineItems, setOptimisticLineItems] = useState<
    LineItem[] | undefined
  >(quote.lineItems as LineItem[] | undefined);

  const quotePositiveSubForAddLineModal = useMemo(
    () =>
      quotePositiveSubtotalExcluding(
        (optimisticLineItems ?? []).map((li) => ({
          id: li.id,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          totalPrice: li.totalPrice,
        })),
      ),
    [optimisticLineItems],
  );

  const [optimisticTotal, setOptimisticTotal] = useState(quote.total || "0.00");
  const [editingExpirationDays, setEditingExpirationDays] = useState(false);
  const [expirationDaysValue, setExpirationDaysValue] = useState(
    (quote.expirationDays || 14).toString(),
  );
  const [editingValidUntil, setEditingValidUntil] = useState(false);
  const [validUntilValue, setValidUntilValue] = useState(
    quote.validUntil
      ? new Date(quote.validUntil).toISOString().split("T")[0]
      : "",
  );
  const lineItemFetcher = useFetcher();
  const restoreLineItemFetcher = useFetcher();
  const [restoringArchivedLineItemId, setRestoringArchivedLineItemId] =
    useState<number | null>(null);
  const drawingFetcher = useFetcher();
  const [selectedDrawing, setSelectedDrawing] = useState<{
    drawing: NormalizedDrawing;
    quotePartId: string;
  } | null>(null);
  const [drawingModalOpen, setDrawingModalOpen] = useState(false);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const [quoteReceivedConfirmOpen, setQuoteReceivedConfirmOpen] =
    useState(false);
  const quoteReceivedIdempotencyRef = useRef(crypto.randomUUID());
  const isQuoteReceivedEmailSending = quoteReceivedFetcher.state !== "idle";

  useEffect(() => {
    if (quoteReceivedFetcher.state !== "idle") return;
    if (!quoteReceivedFetcher.data?.success) return;
    quoteReceivedIdempotencyRef.current = crypto.randomUUID();
    revalidator.revalidate();
  }, [
    quoteReceivedFetcher.state,
    quoteReceivedFetcher.data,
    revalidator,
  ]);

  const [copiedLink, setCopiedLink] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [currentCalculatorPartIndex, setCurrentCalculatorPartIndex] =
    useState(0);
  const [calculatorMode, setCalculatorMode] = useState<
    "allParts" | "singlePart"
  >("allParts");
  const calculatorFetcher = useFetcher<{
    success?: boolean;
    error?: string;
  }>();
  const { download, isDownloading } = useDownload({
    onError: (err) => {
      console.error("Download error:", err);
      alert("Failed to download files. Please try again.");
    },
  });
  const [isGeneratePdfModalOpen, setIsGeneratePdfModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isReceivePoModalOpen, setIsReceivePoModalOpen] = useState(false);
  const [part3DModalOpen, setPart3DModalOpen] = useState(false);
  const [selectedPart3D, setSelectedPart3D] = useState<{
    partId: string;
    quotePartId: string;
    partName: string;
    modelUrl?: string;
    solidModelUrl?: string;
    cadFileUrl?: string;
    thumbnailUrl?: string;
    conversionStatus?: string | null;
    meshConversionError?: string | null;
    usesPlaceholderCad?: boolean;
  } | null>(null);

  // Which sections are editable at this status (see quote-detail/view.ts)
  const locks = quoteSectionLocks(quote.status);
  const areNotesLocked = locks.notes;
  const areAttachmentsLocked = locks.attachments;
  const isPricingLocked = locks.pricing;
  const areDetailsLocked = locks.details;
  const quoteLeadTimeDisplay =
    quote.leadTimeBusinessDaysMin != null &&
    quote.leadTimeBusinessDaysMax != null
      ? formatLeadTimeBusinessDays(
          quote.leadTimeBusinessDaysMin,
          quote.leadTimeBusinessDaysMax,
        )
      : "Not set";

  // Refresh while parts are converting; give up after 10 minutes (120 x 5s).
  usePolling({
    active: hasConvertingQuoteParts(quote.parts),
    intervalMs: 5000,
    maxTicks: 120,
    resetKey: quote.id,
    onTick: () => revalidator.revalidate(),
    onTimeout: () =>
      console.warn("Background status polling timeout reached (10 minutes)"),
  });

  // After queueing an email send, refresh until the quote reads Sent (~2 minutes at 3s).
  useEffect(() => {
    if (isWaitingForSentStatus && quote.status === "Sent") {
      setIsWaitingForSentStatus(false);
    }
  }, [isWaitingForSentStatus, quote.status]);
  usePolling({
    active: isWaitingForSentStatus && quote.status !== "Sent",
    intervalMs: 3000,
    maxTicks: 40,
    resetKey: quote.id,
    onTick: () => revalidator.revalidate(),
    onTimeout: () => setIsWaitingForSentStatus(false),
  });

  // Update optimistic line items when the actual data changes
  // Sort so part line items (quotePartId != null) appear before additional services,
  // and items within each group are stable by id
  useEffect(() => {
    const items = quote.lineItems as LineItem[] | undefined;
    if (items) {
      const sorted = sortQuoteLineItems(items);
      setOptimisticLineItems(sorted);
    } else {
      setOptimisticLineItems(undefined);
    }
    setOptimisticTotal(quote.total || "0.00");
  }, [quote.lineItems, quote.total]);

  // Calculate optimistic total whenever line items change
  useEffect(() => {
    if (optimisticLineItems && optimisticLineItems.length > 0) {
      setOptimisticTotal(sumLineTotals(optimisticLineItems));
    }
  }, [optimisticLineItems]);

  const normalizedLineItems = useMemo(
    () =>
      normalizeQuoteLineItems(
        (optimisticLineItems || []) as Array<{
          id: number;
          quotePartId: string | null;
          name: string | null;
          description: string | null;
          notes: string | null;
          quantity: number;
          unitPrice: string;
          totalPrice: string;
        }>,
        (quote.parts || []) as Array<{
          id: string;
          partName: string;
          material: string | null;
          tolerance: string | null;
          finish: string | null;
          conversionStatus: string | null;
          meshConversionError?: string | null;
          partFileUrl?: string | null;
          signedFileUrl?: string;
          signedMeshUrl?: string;
          signedThumbnailUrl?: string;
          usesPlaceholderCad?: boolean;
          drawings?: Array<{
            id: string;
            fileName: string;
            contentType: string | null;
            fileSize: number | null;
          }>;
        }>,
      ),
    [optimisticLineItems, quote.parts],
  );

  // Track if we've handled the last fetcher response to prevent re-triggering
  const [lastHandledFetcherData, setLastHandledFetcherData] =
    useState<unknown>(null);

  // Monitor calculator fetcher state to handle success/error
  useEffect(() => {
    // Skip if we've already handled this response
    if (calculatorFetcher.data === lastHandledFetcherData) {
      return;
    }

    // When fetcher completes successfully, revalidate data
    // Note: Modal closing is handled by the modal component itself:
    // - In singlePart mode: closes immediately after save
    // - In allParts mode: closes when user clicks "Save & Close" on last part
    if (calculatorFetcher.state === "idle" && calculatorFetcher.data?.success) {
      setLastHandledFetcherData(calculatorFetcher.data);
      revalidator.revalidate();
    }

    // Handle errors
    if (calculatorFetcher.state === "idle" && calculatorFetcher.data?.error) {
      setLastHandledFetcherData(calculatorFetcher.data);
      alert(`Failed to save calculation: ${calculatorFetcher.data.error}`);
    }
  }, [
    calculatorFetcher.state,
    calculatorFetcher.data,
    revalidator,
    lastHandledFetcherData,
  ]);

  const handleView3DModel = (part: {
    id: string;
    partName: string;
    signedMeshUrl?: string;
    signedFileUrl?: string;
    signedThumbnailUrl?: string;
    partFileUrl?: string | null;
    conversionStatus?: string | null;
    meshConversionError?: string | null;
    usesPlaceholderCad?: boolean;
  }) => {
    // Open if there is mesh/CAD, or drawing-only placeholder rows (no mesh until CAD is uploaded)
    if (
      part.signedMeshUrl ||
      part.signedFileUrl ||
      part.partFileUrl ||
      part.usesPlaceholderCad
    ) {
      setSelectedPart3D({
        partId: part.id,
        quotePartId: part.id,
        partName: part.partName,
        modelUrl: part.signedMeshUrl,
        solidModelUrl: part.signedFileUrl,
        cadFileUrl: part.partFileUrl || part.signedFileUrl,
        thumbnailUrl: part.signedThumbnailUrl,
        conversionStatus: part.conversionStatus,
        meshConversionError: part.meshConversionError,
        usesPlaceholderCad: part.usesPlaceholderCad,
      });
      setPart3DModalOpen(true);
    }
  };

  const handleReviseQuote = () => {
    if (
      confirm(
        "Are you sure you want to revise this quote? This will revert the quote to Draft status and allow editing again.",
      )
    ) {
      fetcher.submit({ intent: "reviseQuote" }, { method: "post" });
    }
  };

  const submitQuoteReceivedEmail = () => {
    quoteReceivedFetcher.submit(
      {
        intent: "sendQuoteReceivedEmail",
        idempotencyKey: quoteReceivedIdempotencyRef.current,
      },
      { method: "post" },
    );
    setQuoteReceivedConfirmOpen(false);
  };

  const handleQuoteReceivedEmail = () => {
    if (isQuoteReceivedEmailSending) return;
    setIsActionsDropdownOpen(false);
    if (quoteReceivedLastSend) {
      setQuoteReceivedConfirmOpen(true);
      return;
    }
    submitQuoteReceivedEmail();
  };

  const handleDuplicateQuote = () => {
    if (
      confirm(
        "Create a duplicate of this quote? A new quote with a fresh quote number will be created.",
      )
    ) {
      fetcher.submit({ intent: "duplicateQuote" }, { method: "post" });
    }
  };

  const handleMarkAsSent = () => {
    if (
      confirm(
        "Are you sure you want to mark this quote as sent? Once sent, the quote will be locked and line items cannot be modified.",
      )
    ) {
      fetcher.submit(
        {
          intent: "updateStatus",
          status: "Sent",
          rejectionReason: "",
        },
        { method: "post" },
      );
    }
  };

  const handleMarkAsAccepted = () => {
    if (
      confirm(
        "Are you sure you want to mark this quote as accepted? This will automatically convert the quote to an order and the quote will become permanently immutable.",
      )
    ) {
      fetcher.submit(
        {
          intent: "updateStatus",
          status: "Accepted",
          rejectionReason: "",
        },
        { method: "post" },
      );
    }
  };

  const handleRejectQuote = () => {
    setIsRejectModalOpen(true);
  };

  const handleRejectQuoteConfirm = () => {
    if (rejectionReasonRequired && !rejectionReason.trim()) {
      alert("Rejection reason is required.");
      return;
    }

    fetcher.submit(
      {
        intent: "updateStatus",
        status: "Rejected",
        rejectionReason: rejectionReason.trim(),
      },
      { method: "post" },
    );
    setIsRejectModalOpen(false);
    setRejectionReason("");
  };

  const handleRejectModalClose = () => {
    setIsRejectModalOpen(false);
    setRejectionReason("");
  };

  const handleAddLineItem = () => {
    setIsAddLineItemModalOpen(true);
  };

  const handleAddLineItemSubmit = (formData: FormData) => {
    formData.append("intent", "addLineItem");
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  const handlePromoteLineItemSubmit = (formData: FormData) => {
    formData.append("intent", "promoteLineItemToQuotePart");
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
    setPromoteLineItemTarget(null);
  };

  const handleOpenCalculator = () => {
    if (!canAccessPriceCalculator) return;
    setCalculatorMode("allParts");
    setIsCalculatorOpen(true);
    setCurrentCalculatorPartIndex(0);
  };

  const handleGeneratePdf = () => {
    setIsGeneratePdfModalOpen(true);
  };

  const handleGenerateInvoice = () => {
    setIsInvoiceModalOpen(true);
  };

  const handleOpenCalculatorForPart = (partId: string) => {
    if (!canAccessPriceCalculator) return;
    // Find the index of the part in the quote.parts array
    const partIndex =
      quote.parts?.findIndex((p: { id: string }) => p.id === partId) ?? 0;
    setCalculatorMode("singlePart");
    setCurrentCalculatorPartIndex(partIndex);
    setIsCalculatorOpen(true);
  };

  const handleDownloadFiles = () => {
    download(
      `/download/quote/${quote.id}`,
      `Quote-${quote.quoteNumber}-Files.zip`,
    );
  };

  const handleSaveCalculation = (calculationData: Record<string, unknown>) => {
    // Don't submit if already submitting
    if (calculatorFetcher.state !== "idle") {
      return;
    }

    const formData = new FormData();
    formData.append("intent", "savePriceCalculation");
    formData.append("calculationData", JSON.stringify(calculationData));

    calculatorFetcher.submit(formData, {
      method: "post",
    });

    // Modal closing is handled by the useEffect that monitors calculatorFetcher.state
  };

  const handleDeleteLineItem = (lineItemId: number) => {
    if (
      confirm(
        `Archive this line item? It will be kept for ${archiveRetentionDays} day(s) and can be restored from Archived before permanent deletion.`,
      )
    ) {
      fetcher.submit(
        {
          intent: "archiveLineItem",
          lineItemId: lineItemId.toString(),
        },
        { method: "post" },
      );
    }
  };

  const handleRestoreArchivedLineItem = (lineItemId: number) => {
    setRestoringArchivedLineItemId(lineItemId);
    restoreLineItemFetcher.submit(
      {
        intent: "restoreLineItem",
        lineItemId: lineItemId.toString(),
      },
      { method: "post" },
    );
  };

  const handleSaveLineItemField = useCallback(
    (
      lineItemId: number,
      field: LineItemEditField,
      value: string,
    ) => {
      const plan = planQuoteLineItemEdit(
        optimisticLineItems ?? [],
        lineItemId,
        field,
        value,
      );
      if (plan.kind === "reject") alert(plan.message);
      if (plan.kind !== "save") return;

      setOptimisticLineItems((prevItems) =>
        prevItems?.map((item) =>
          item.id === lineItemId ? { ...item, ...plan.patch } : item,
        ),
      );
      lineItemFetcher.submit(plan.fields, { method: "post" });
    },
    [lineItemFetcher, optimisticLineItems],
  );

  const handleSaveQuotePartAttribute = useCallback(
    (
      partId: string,
      field: "material" | "tolerance" | "finish",
      value: string,
    ) => {
      const part = quote.parts?.find((p: { id: string }) => p.id === partId);
      if (!part) return;
      const formData = new FormData();
      formData.append("intent", "updateQuotePartAttributes");
      formData.append("quotePartId", partId);
      formData.append(
        "material",
        field === "material" ? value : part.material || "",
      );
      formData.append(
        "tolerance",
        field === "tolerance" ? value : part.tolerance || "",
      );
      formData.append("finish", field === "finish" ? value : part.finish || "");
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher, quote.parts],
  );

  const handleQuoteDrawingUpload = useCallback(
    (partId: string, files: FileList) => {
      const formData = new FormData();
      formData.append("intent", "addDrawingToExistingPart");
      formData.append("quotePartId", partId);
      Array.from(files).forEach((file, index) => {
        formData.append(`drawing_${index}`, file);
      });
      formData.append("drawingCount", files.length.toString());
      drawingFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
    },
    [drawingFetcher],
  );

  const handleQuoteDrawingDelete = useCallback(
    (drawingId: string, quotePartId: string) => {
      const formData = new FormData();
      formData.append("intent", "deleteDrawing");
      formData.append("drawingId", drawingId);
      formData.append("quotePartId", quotePartId);
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher],
  );

  const daysUntilExpiry = daysUntil(quote.validUntil);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-[1920px] mx-auto">
        {/* Custom breadcrumb bar with buttons */}
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/" },
              { label: "Quotes", href: "/quotes" },
              { label: quote.quoteNumber },
            ]}
          />
          <div className="flex flex-wrap gap-3">
            {!quote.isArchived && (
              <>
                <div className="relative">
                  <Button
                    ref={actionsButtonRef}
                    onClick={() =>
                      setIsActionsDropdownOpen(!isActionsDropdownOpen)
                    }
                    variant="secondary"
                  >
                    Actions
                  </Button>
                  <QuoteActionsDropdown
                    isOpen={isActionsDropdownOpen}
                    onClose={() => setIsActionsDropdownOpen(false)}
                    excludeRef={actionsButtonRef}
                    quoteStatus={quote.status}
                    onReviseQuote={handleReviseQuote}
                    onDuplicate={handleDuplicateQuote}
                    onCalculatePricing={
                      canAccessPriceCalculator
                        ? handleOpenCalculator
                        : undefined
                    }
                    onDownloadFiles={handleDownloadFiles}
                    onGeneratePdf={handleGeneratePdf}
                    onGenerateInvoice={handleGenerateInvoice}
                    onReceivePo={
                      quote.status === "Sent"
                        ? () => setIsReceivePoModalOpen(true)
                        : undefined
                    }
                    onQuoteReceived={
                      quoteReceivedEmailReadiness.canSend
                        ? handleQuoteReceivedEmail
                        : undefined
                    }
                    quoteReceivedDisabledReason={
                      quoteReceivedEmailReadiness.outboundEnabled &&
                      !quoteReceivedEmailReadiness.canSend
                        ? quoteReceivedEmailReadiness.disabledReason
                        : undefined
                    }
                    isQuoteReceivedSending={isQuoteReceivedEmailSending}
                    isDownloading={isDownloading}
                    hasCustomer={!!quote.customerId}
                  />
                </div>
                {(quote.status === "RFQ" || quote.status === "Draft") && (
                  <>
                    <Button
                      onClick={handleMarkAsSent}
                      variant="secondary"
                      className="!border-blue-600 !text-blue-600 hover:!bg-blue-50 dark:!border-blue-500 dark:!text-blue-400 dark:hover:!bg-blue-900/20"
                    >
                      Mark as Sent
                    </Button>
                    {outboundEmailEnabled && (
                      <Button
                        onClick={() => setSendEmailModalOpen(true)}
                        variant="primary"
                        disabled={
                          !customer?.email ||
                          isWaitingForSentStatus ||
                          !quoteSendEmailReady
                        }
                        title={
                          !customer?.email
                            ? "Customer has no email address"
                            : !quoteSendEmailReady
                              ? "Configure quote email: Admin → Email → assign a template to “Send quote email”"
                              : undefined
                        }
                      >
                        Send Quote
                      </Button>
                    )}
                    {isWaitingForSentStatus && (
                      <div className="flex items-center text-sm text-blue-700 dark:text-blue-300">
                        <svg
                          className="animate-spin h-4 w-4 mr-2"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Waiting for status update...
                      </div>
                    )}
                  </>
                )}
                {quote.status === "Sent" && !quote.convertedToOrderId && (
                  <>
                    <Button onClick={handleMarkAsAccepted} variant="primary">
                      Mark as Accepted
                    </Button>
                    <Button onClick={handleRejectQuote} variant="danger">
                      Reject Quote
                    </Button>
                  </>
                )}
              </>
            )}
            {/* No action buttons for archived quotes - restore button is in the banner */}
          </div>
        </div>

        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">
          <div className="flex flex-col gap-3">
            <NdaRequiredBanner required={quote.ndaRequired} />
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="updateNdaRequired" />
              <input type="hidden" name="ndaRequired" value={String(!quote.ndaRequired)} />
              <button type="submit" className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400">
                {quote.ndaRequired ? "Remove NDA requirement" : "Mark NDA required"}
              </button>
            </fetcher.Form>
          </div>
          {/* Error Banner */}
          {fetcher.data &&
            typeof fetcher.data === "object" &&
            "error" in fetcher.data &&
            fetcher.data.error && (
              <div className="relative bg-red-50 dark:bg-red-900/20 border-2 border-red-300 dark:border-red-700 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg
                    className="w-6 h-6 flex-shrink-0 text-red-600 dark:text-red-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p className="font-semibold text-red-800 dark:text-red-200">
                      {(fetcher.data as { error: string }).error}
                    </p>
                    {"validationErrors" in fetcher.data &&
                      Array.isArray(fetcher.data.validationErrors) &&
                      fetcher.data.validationErrors.length > 0 && (
                        <ul className="mt-2 text-sm text-red-700 dark:text-red-300 list-disc list-inside space-y-1">
                          {(fetcher.data.validationErrors as string[]).map(
                            (error: string, index: number) => (
                              <li key={index}>{error}</li>
                            ),
                          )}
                        </ul>
                      )}
                  </div>
                </div>
              </div>
            )}

          {/* Archived Quote Banner */}
          {quote.isArchived && (
            <div className="relative bg-gray-900 dark:bg-gray-950 border-2 border-gray-700 dark:border-gray-800 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <svg
                  className="w-6 h-6 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
                  />
                </svg>
                <div>
                  <p className="font-semibold text-gray-100">
                    This quote has been archived
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Locked Quote Banner */}
          {(quote.status === "Sent" || quote.status === "Accepted") &&
            !quote.isArchived && (
              <div
                className={`relative border-2 rounded-lg p-4 ${
                  quote.status === "Accepted"
                    ? "bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700"
                    : "bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-700"
                }`}
              >
                <div className="flex items-start gap-3">
                  <svg
                    className={`w-6 h-6 flex-shrink-0 ${
                      quote.status === "Accepted"
                        ? "text-green-600 dark:text-green-400"
                        : "text-blue-600 dark:text-blue-400"
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <div className="flex-1">
                    <p
                      className={`font-semibold ${
                        quote.status === "Accepted"
                          ? "text-green-800 dark:text-green-200"
                          : "text-blue-800 dark:text-blue-200"
                      }`}
                    >
                      {quote.status === "Accepted"
                        ? "Quote Accepted"
                        : "Quote Sent"}
                    </p>
                    <p
                      className={`text-sm mt-1 ${
                        quote.status === "Accepted"
                          ? "text-green-700 dark:text-green-300"
                          : "text-blue-700 dark:text-blue-300"
                      }`}
                    >
                      {quote.status === "Accepted"
                        ? "Accepted quotes are immutable."
                        : quote.status === "Sent"
                          ? "Sent quotes are locked from editing pricing and details. Notes and attachments can still be modified."
                          : "Sent Quotes are locked from editing. To make revisions, use the Revise Action."}
                    </p>
                  </div>
                </div>
              </div>
            )}

          {/* Expiry Notice Bar */}
          {daysUntilExpiry &&
            daysUntilExpiry > 0 &&
            daysUntilExpiry <= 7 &&
            quote.status === "Sent" &&
            !quote.isArchived && (
              <div className="relative bg-yellow-100 dark:bg-yellow-900/50 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
                <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                  Attention: This quote expires in {daysUntilExpiry} days
                </p>
              </div>
            )}

          {/* Status Cards - Always at top */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Quote Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Quote Status
              </h3>
              <div
                className={`px-4 py-3 rounded-full text-center font-semibold ${
                  quote.isArchived
                    ? "bg-gray-900 text-gray-100 dark:bg-gray-950 dark:text-gray-300"
                    : getStatusClasses(quote.status)
                }`}
              >
                {quote.isArchived
                  ? "Archived"
                  : quote.status.charAt(0).toUpperCase() +
                    quote.status.slice(1)}
              </div>
            </div>

            <QuoteDeliveryDateCard
              quote={quote}
              variant="summary"
              readOnly={areDetailsLocked}
            />

            {/* Valid Until / Expiration Days / Accepted Date Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              {quote.status === "Accepted" ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Accepted
                  </h3>
                  <div className="relative">
                    <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                      {quote.acceptedAt
                        ? new Date(quote.acceptedAt).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                            hour12: true,
                          })
                        : "--"}
                    </p>
                    {quote.acceptedAt &&
                      (() => {
                        const acceptedDate = new Date(quote.acceptedAt);
                        const now = new Date();
                        const diffMs = now.getTime() - acceptedDate.getTime();
                        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
                        const diffDays = Math.floor(diffHours / 24);
                        const remainingHours = diffHours % 24;

                        let timeElapsed = "";
                        if (diffDays > 0) {
                          timeElapsed = `${diffDays} day${
                            diffDays > 1 ? "s" : ""
                          }${
                            remainingHours > 0
                              ? `, ${remainingHours} hour${
                                  remainingHours > 1 ? "s" : ""
                                }`
                              : ""
                          } ago`;
                        } else if (diffHours > 0) {
                          timeElapsed = `${diffHours} hour${
                            diffHours > 1 ? "s" : ""
                          } ago`;
                        } else {
                          const diffMins = Math.floor(diffMs / (1000 * 60));
                          timeElapsed =
                            diffMins > 0
                              ? `${diffMins} minute${
                                  diffMins > 1 ? "s" : ""
                                } ago`
                              : "Just now";
                        }

                        return (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {timeElapsed}
                          </p>
                        );
                      })()}
                  </div>
                </>
              ) : quote.status === "Sent" ||
                quote.status === "Rejected" ||
                quote.status === "Dropped" ||
                quote.status === "Expired" ? (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Valid Until
                  </h3>
                  <div className="relative">
                    {editingValidUntil ? (
                      <input
                        ref={(input) => {
                          if (input && editingValidUntil) {
                            input.focus();
                          }
                        }}
                        type="date"
                        className="w-full px-3 py-2 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                        value={validUntilValue}
                        onChange={(e) => setValidUntilValue(e.target.value)}
                        onBlur={() => {
                          if (validUntilValue) {
                            fetcher.submit(
                              {
                                intent: "updateValidUntil",
                                validUntil: validUntilValue,
                              },
                              { method: "post" },
                            );
                          }
                          setEditingValidUntil(false);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (validUntilValue) {
                              fetcher.submit(
                                {
                                  intent: "updateValidUntil",
                                  validUntil: validUntilValue,
                                },
                                { method: "post" },
                              );
                            }
                            setEditingValidUntil(false);
                          } else if (e.key === "Escape") {
                            e.preventDefault();
                            setValidUntilValue(
                              quote.validUntil
                                ? new Date(quote.validUntil)
                                    .toISOString()
                                    .split("T")[0]
                                : "",
                            );
                            setEditingValidUntil(false);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                          {formatDate(quote.validUntil)}
                        </p>
                        {daysUntilExpiry !== null && (
                          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                            {daysUntilExpiry > 0
                              ? `${daysUntilExpiry} days remaining`
                              : "Expired"}
                          </p>
                        )}
                        <button
                          onClick={() => setEditingValidUntil(true)}
                          className="absolute -top-2 -right-2 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                          aria-label="Edit expiration date"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="h-5 w-5"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                    Expiration Days
                  </h3>
                  <div className="relative">
                    <div
                      className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 -mx-2 transition-colors"
                      onClick={() => {
                        setEditingExpirationDays(true);
                        setTimeout(() => {
                          const input = document.getElementById(
                            "expiration-days-input-chip",
                          );
                          if (input) {
                            (input as HTMLInputElement).focus();
                            (input as HTMLInputElement).select();
                          }
                        }, 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setEditingExpirationDays(true);
                          setTimeout(() => {
                            const input = document.getElementById(
                              "expiration-days-input-chip",
                            );
                            if (input) {
                              (input as HTMLInputElement).focus();
                              (input as HTMLInputElement).select();
                            }
                          }, 0);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {editingExpirationDays ? (
                        <div className="flex items-center gap-2">
                          <input
                            id="expiration-days-input-chip"
                            type="number"
                            className="w-20 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                            value={expirationDaysValue}
                            onChange={(e) =>
                              setExpirationDaysValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const days = parseInt(expirationDaysValue);
                                if (!isNaN(days) && days > 0) {
                                  fetcher.submit(
                                    {
                                      intent: "updateQuote",
                                      expirationDays: expirationDaysValue,
                                    },
                                    { method: "post" },
                                  );
                                  setEditingExpirationDays(false);
                                }
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
                                );
                                setEditingExpirationDays(false);
                              }
                            }}
                            onBlur={() => {
                              const days = parseInt(expirationDaysValue);
                              if (
                                !isNaN(days) &&
                                days > 0 &&
                                days !== (quote.expirationDays || 14)
                              ) {
                                fetcher.submit(
                                  {
                                    intent: "updateQuote",
                                    expirationDays: expirationDaysValue,
                                  },
                                  { method: "post" },
                                );
                              } else {
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
                                );
                              }
                              setEditingExpirationDays(false);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            min="1"
                          />
                          <span className="text-base font-medium text-gray-900 dark:text-gray-100">
                            days
                          </span>
                        </div>
                      ) : (
                        <>
                          <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                            {quote.expirationDays || 14} days
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Quote Value Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Quote Value
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {formatCurrency(optimisticTotal)}
              </p>
            </div>
          </div>

          {/* Quote Details Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Quote Details
              </h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-6">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Quote Number
                  </p>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                    {quote.quoteNumber}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Customer
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsCustomerInfoModalOpen(true)}
                    className="mt-1 -mx-2 inline-flex max-w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:hover:bg-blue-900/20"
                  >
                    <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
                      {customer?.displayName || "N/A"}
                    </p>
                  </button>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Lead Time
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsLeadTimeModalOpen(true)}
                    disabled={areDetailsLocked}
                    className="mt-1 -mx-2 inline-flex max-w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-blue-50 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-blue-900/20 dark:disabled:hover:bg-transparent"
                  >
                    <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
                      {quoteLeadTimeDisplay}
                    </p>
                  </button>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Created Date
                  </p>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                    {formatDateTime(quote.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Expiration Days
                  </p>
                  {!areDetailsLocked ? (
                    <div
                      className="inline-flex cursor-pointer rounded px-2 py-1 -mx-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                      onClick={() => {
                        setEditingExpirationDays(true);
                        setTimeout(() => {
                          const input = document.getElementById(
                            "expiration-days-input",
                          );
                          if (input) {
                            (input as HTMLInputElement).focus();
                            (input as HTMLInputElement).select();
                          }
                        }, 0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setEditingExpirationDays(true);
                          setTimeout(() => {
                            const input = document.getElementById(
                              "expiration-days-input",
                            );
                            if (input) {
                              (input as HTMLInputElement).focus();
                              (input as HTMLInputElement).select();
                            }
                          }, 0);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      {editingExpirationDays ? (
                        <div className="flex items-center gap-2">
                          <input
                            id="expiration-days-input"
                            type="number"
                            className="w-20 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                            value={expirationDaysValue}
                            onChange={(e) =>
                              setExpirationDaysValue(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                const days = parseInt(expirationDaysValue);
                                if (!isNaN(days) && days > 0) {
                                  fetcher.submit(
                                    {
                                      intent: "updateQuote",
                                      expirationDays: expirationDaysValue,
                                    },
                                    { method: "post" },
                                  );
                                  setEditingExpirationDays(false);
                                }
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
                                );
                                setEditingExpirationDays(false);
                              }
                            }}
                            onBlur={() => {
                              const days = parseInt(expirationDaysValue);
                              if (
                                !isNaN(days) &&
                                days > 0 &&
                                days !== (quote.expirationDays || 14)
                              ) {
                                fetcher.submit(
                                  {
                                    intent: "updateQuote",
                                    expirationDays: expirationDaysValue,
                                  },
                                  { method: "post" },
                                );
                              } else {
                                setExpirationDaysValue(
                                  (quote.expirationDays || 14).toString(),
                                );
                              }
                              setEditingExpirationDays(false);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            min="1"
                          />
                          <span className="text-base font-medium text-gray-900 dark:text-gray-100">
                            days
                          </span>
                        </div>
                      ) : (
                        <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                          {quote.expirationDays || 14} days
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {quote.expirationDays || 14} days
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    Vendor
                  </p>
                  {!areDetailsLocked ? (
                    editingVendor ? (
                      <select
                        value={quote.vendorId?.toString() || ""}
                        onChange={(e) => {
                          const vendorId = e.target.value;
                          fetcher.submit(
                            { intent: "updateVendor", vendorId },
                            { method: "post" },
                          );
                          setEditingVendor(false);
                        }}
                        onBlur={() => setEditingVendor(false)}
                        className="w-full px-3 py-2 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">No Vendor</option>
                        {vendors.map(
                          (v: { id: number; displayName: string }) => (
                            <option key={v.id} value={v.id}>
                              {v.displayName}
                            </option>
                          ),
                        )}
                      </select>
                    ) : (
                      <div
                        onClick={() => setEditingVendor(true)}
                        className="inline-flex max-w-full cursor-pointer rounded px-2 py-1 -mx-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setEditingVendor(true);
                          }
                        }}
                      >
                        <p className="truncate text-base font-medium text-gray-900 dark:text-gray-100">
                          {vendor?.displayName || "None"}
                        </p>
                      </div>
                    )
                  ) : (
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {vendor?.displayName || "None"}
                    </p>
                  )}
                </div>
                {quote.sentAt && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Sent Date
                    </p>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {formatDateTime(quote.sentAt)}
                    </p>
                  </div>
                )}
                {stripeEnabled && quote.stripePaymentLinkUrl && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Payment Link
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            quote.stripePaymentLinkUrl!,
                          );
                          setCopiedLink(true);
                          setTimeout(() => setCopiedLink(false), 2000);
                        }}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        title="Copy payment link"
                      >
                        {copiedLink ? (
                          <svg
                            className="h-3.5 w-3.5 text-green-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                        ) : (
                          <svg
                            className="h-3.5 w-3.5 text-gray-500"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                            />
                          </svg>
                        )}
                        <span>{copiedLink ? "Copied!" : "Copy Link"}</span>
                      </button>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          quote.stripePaymentLinkActive
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {quote.stripePaymentLinkActive
                          ? "Active"
                          : "Deactivated"}
                      </span>
                    </div>
                  </div>
                )}
                {quote.acceptedAt && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Accepted Date
                    </p>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {formatDateTime(quote.acceptedAt)}
                    </p>
                  </div>
                )}
                {quote.convertedToOrderId && convertedOrder && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Converted to Order
                    </p>
                    <Link
                      to={`/orders/${convertedOrder.orderNumber}`}
                      className="text-base font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                    >
                      {convertedOrder.orderNumber}
                    </Link>
                  </div>
                )}
                {quote.rejectionReason && (
                  <div className="md:col-span-2">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Rejection Reason
                    </p>
                    <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                      {quote.rejectionReason}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <LineItemsSection
            items={normalizedLineItems}
            entityType="quote"
            hideThumbnails={hideLineItemThumbnails}
            readOnly={isPricingLocked}
            subtotal={formatCurrency(optimisticTotal)}
            archivedItems={archivedLineItems}
            onAdd={handleAddLineItem}
            onDelete={handleDeleteLineItem}
            onRestoreArchived={handleRestoreArchivedLineItem}
            isRestoringArchived={restoreLineItemFetcher.state !== "idle"}
            restoringArchivedLineItemId={restoringArchivedLineItemId}
            onSaveField={handleSaveLineItemField}
            onSaveAttribute={handleSaveQuotePartAttribute}
            onDrawingUpload={handleQuoteDrawingUpload}
            onDrawingDelete={handleQuoteDrawingDelete}
            partAssetAdminAction={partAssetAdminAction}
            onView3DModel={(part: NormalizedPart) => {
              handleView3DModel({
                id: part.id,
                partName: part.partName || "Part",
                signedMeshUrl: part.modelUrl,
                signedFileUrl: part.solidModelUrl,
                signedThumbnailUrl: part.thumbnailUrl,
                partFileUrl: part.cadFileUrl,
                conversionStatus: part.conversionStatus,
                meshConversionError: part.meshConversionError,
                usesPlaceholderCad: part.usesPlaceholderCad,
              });
            }}
            onViewDrawing={(
              drawing: NormalizedDrawing,
              quotePartId: string,
            ) => {
              setSelectedDrawing({ drawing, quotePartId });
              setDrawingModalOpen(true);
            }}
            rowExtraActions={(item: NormalizedLineItem) => (
              <>
                {item.part && canAccessPriceCalculator ? (
                  <IconButton
                    icon={
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
                        />
                      </svg>
                    }
                    title="Price Calculator"
                    onClick={() => handleOpenCalculatorForPart(item.part!.id)}
                  />
                ) : null}
                {!item.part && !isPricingLocked ? (
                  <IconButton
                    icon={
                      <FilePlusCorner
                        className="w-[18px] h-[18px]"
                        strokeWidth={2}
                      />
                    }
                    title="Add part files"
                    onClick={() =>
                      setPromoteLineItemTarget({
                        id: item.id,
                        name: item.name || "Line item",
                        quantity: item.quantity,
                        unitPrice: item.unitPrice,
                        totalPrice: item.totalPrice,
                        description: item.description,
                        notes: item.notes,
                      })
                    }
                  />
                ) : null}
              </>
            )}
          />

          <AttachmentsSection
            attachments={attachments || []}
            entityType="quote"
            entityId={quote.id}
            readOnly={areAttachmentsLocked}
            canDeleteProtected={userDetails.role === "Admin" || userDetails.role === "Dev"}
          />

          {/* Notes and Event Log Section - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Notes */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Quote Notes
                </h3>
                {!isAddingNote && !areNotesLocked && (
                  <Button size="sm" onClick={() => setIsAddingNote(true)}>
                    Add Note
                  </Button>
                )}
              </div>
              <div className="p-6">
                <Notes
                  entityType="quote"
                  entityId={quote.id.toString()}
                  initialNotes={notes}
                  currentUserId={user.id}
                  currentUserName={userDetails?.name || user.email}
                  showHeader={false}
                  onAddNoteClick={() => setIsAddingNote(false)}
                  isAddingNote={isAddingNote}
                  externalControl={true}
                  readOnly={areNotesLocked}
                />
              </div>
            </div>

            {/* Event Log */}
            <EventTimeline
              entityType="quote"
              entityId={quote.id.toString()}
              entityName={quote.quoteNumber}
              initialEvents={events}
            />
          </div>
        </div>
      </div>

      {selectedDrawing && (
        <FileViewerModal
          isOpen={drawingModalOpen}
          onClose={() => {
            setDrawingModalOpen(false);
            setSelectedDrawing(null);
          }}
          fileUrl={selectedDrawing.drawing.signedUrl}
          fileName={selectedDrawing.drawing.fileName}
          contentType={selectedDrawing.drawing.contentType || undefined}
          fileSize={selectedDrawing.drawing.fileSize || undefined}
          onDelete={
            isPricingLocked
              ? undefined
              : () =>
                  handleQuoteDrawingDelete(
                    selectedDrawing.drawing.id,
                    selectedDrawing.quotePartId,
                  )
          }
          isDeleting={fetcher.state === "submitting"}
          partAssetAdmin={
            partAssetAdminAction
              ? {
                  action: partAssetAdminAction,
                  context: {
                    surface: "drawing",
                    entity: "quote_part",
                    parentPartId: selectedDrawing.quotePartId,
                    drawingId: selectedDrawing.drawing.id,
                    fileName: selectedDrawing.drawing.fileName,
                  },
                }
              : undefined
          }
        />
      )}

      {/* 3D Viewer Modal */}
      {selectedPart3D && (
        <Part3DViewerModal
          isOpen={part3DModalOpen}
          onClose={() => {
            setPart3DModalOpen(false);
            setSelectedPart3D(null);
          }}
          partName={selectedPart3D.partName}
          modelUrl={selectedPart3D.modelUrl}
          solidModelUrl={selectedPart3D.solidModelUrl}
          partId={selectedPart3D.partId}
          quotePartId={selectedPart3D.quotePartId}
          onThumbnailUpdate={() => {
            revalidator.revalidate();
          }}
          autoGenerateThumbnail={true}
          existingThumbnailUrl={selectedPart3D.thumbnailUrl}
          isQuotePart={true}
          cadFileUrl={selectedPart3D.cadFileUrl}
          partAssetAdminAction={partAssetAdminAction}
          meshConversionStatus={selectedPart3D.conversionStatus}
          meshConversionError={selectedPart3D.meshConversionError}
          usesPlaceholderCad={selectedPart3D.usesPlaceholderCad}
          canRevise={canRevise}
          onRevisionComplete={() => {
            setPart3DModalOpen(false);
            setSelectedPart3D(null);
            revalidator.revalidate();
          }}
          onRegenerateMesh={
            selectedPart3D.quotePartId && !selectedPart3D.usesPlaceholderCad
              ? () => {
                  const fd = new FormData();
                  fd.append("intent", "regenerateMesh");
                  fd.append("partId", selectedPart3D.quotePartId!);
                  fetcher.submit(fd, { method: "post" });
                  setPart3DModalOpen(false);
                  setSelectedPart3D(null);
                  revalidator.revalidate();
                }
              : undefined
          }
          bananaEnabled={bananaEnabled}
          bananaModelUrl={bananaModelUrl || undefined}
        />
      )}

      {/* Hidden Thumbnail Generators for parts without thumbnails */}
      {quote.parts?.map(
        (part: {
          id: string;
          signedMeshUrl?: string;
          thumbnailUrl?: string | null;
          conversionStatus: string | null;
        }) => {
          if (
            part.signedMeshUrl &&
            part.conversionStatus === "completed" &&
            !part.thumbnailUrl
          ) {
            return (
              <HiddenThumbnailGenerator
                key={part.id}
                modelUrl={part.signedMeshUrl}
                partId={part.id}
                entityType="quote-part"
                onComplete={() => {
                  revalidator.revalidate();
                }}
              />
            );
          }
          return null;
        },
      )}

      {/* Add Line Item Modal */}
      <AddLineItemModal
        isOpen={isAddLineItemModalOpen || promoteLineItemTarget != null}
        onClose={() => {
          setIsAddLineItemModalOpen(false);
          setPromoteLineItemTarget(null);
        }}
        onSubmit={
          promoteLineItemTarget != null
            ? handlePromoteLineItemSubmit
            : handleAddLineItemSubmit
        }
        context="quote"
        positiveSubtotalForDiscount={quotePositiveSubForAddLineModal}
        customerId={quote.customerId}
        promoteLineItemId={promoteLineItemTarget?.id ?? null}
        initialLineItemName={promoteLineItemTarget?.name ?? null}
        prefillFromLineItem={
          promoteLineItemTarget
            ? {
                quantity: promoteLineItemTarget.quantity,
                unitPrice: promoteLineItemTarget.unitPrice,
                totalPrice: promoteLineItemTarget.totalPrice,
                description: promoteLineItemTarget.description,
                notes: promoteLineItemTarget.notes,
              }
            : null
        }
      />

      {canAccessPriceCalculator && (
        <QuotePriceCalculatorModal
          isOpen={isCalculatorOpen && canAccessPriceCalculator}
          onClose={() => setIsCalculatorOpen(false)}
          quoteParts={quote.parts || []}
          quoteLineItems={quote.lineItems || []}
          quoteId={quote.id}
          onSave={handleSaveCalculation}
          currentPartIndex={currentCalculatorPartIndex}
          onPartChange={setCurrentCalculatorPartIndex}
          existingCalculations={priceCalculations || []}
          isSaving={calculatorFetcher.state !== "idle"}
          mode={calculatorMode}
        />
      )}

      <Modal
        isOpen={quoteReceivedConfirmOpen}
        onClose={() => setQuoteReceivedConfirmOpen(false)}
        title="Send quote received email again?"
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            {quoteReceivedLastSend
              ? describeQuoteReceivedResendPrompt(quoteReceivedLastSend)
              : "A prior acknowledgment is on record."}{" "}
            Send again using the current template?
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setQuoteReceivedConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitQuoteReceivedEmail}
              disabled={isQuoteReceivedEmailSending}
            >
              Send anyway
            </Button>
          </div>
        </div>
      </Modal>

      {/* Send Email Modal */}
      {outboundEmailEnabled && isSendEmailModalOpen && (
        <SendQuoteEmailModal
          isOpen={isSendEmailModalOpen}
          onClose={() => setSendEmailModalOpen(false)}
          onSendSuccess={({ delivery }) => {
            if (delivery === "queued") {
              setIsWaitingForSentStatus(true);
            }
          }}
          quote={quote}
          customer={customer}
          attachments={attachments}
          defaultSubject={quoteSendEmailDefaultSubject ?? undefined}
          editableSlots={quoteSendEditableSlots}
          requiredAttachmentDocumentKinds={
            quoteSendRequiredAttachmentDocumentKinds
          }
        />
      )}

      <GenerateQuotePdfModal
        isOpen={isGeneratePdfModalOpen}
        onClose={() => setIsGeneratePdfModalOpen(false)}
        quote={quote}
        autoDownload={pdfAutoDownload}
      />

      <GenerateInvoicePdfModal
        isOpen={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        entity={quote}
        lineItems={quote.lineItems || []}
        parts={quote.parts || []}
        autoDownload={pdfAutoDownload}
      />

      <ReceivePoModal
        isOpen={isReceivePoModalOpen}
        onClose={() => setIsReceivePoModalOpen(false)}
        fetcher={receivePoFetcher}
      />

      <Modal
        isOpen={isCustomerInfoModalOpen}
        onClose={() => setIsCustomerInfoModalOpen(false)}
        title="Customer"
        size="md"
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Name</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                {customer?.displayName || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Business Name
              </p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                {customer?.companyName || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100 break-words">
                {customer?.email || "N/A"}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400">Phone</p>
              <p className="text-base font-medium text-gray-900 dark:text-gray-100">
                {customer?.phone || "N/A"}
              </p>
            </div>
          </div>

          {!areDetailsLocked && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
              <label
                htmlFor="quote-customer-account"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                Change Customer
              </label>
              <select
                id="quote-customer-account"
                value={quote.customerId?.toString() || ""}
                onChange={(e) => {
                  const customerId = e.target.value;
                  if (
                    !customerId ||
                    customerId === quote.customerId?.toString()
                  ) {
                    return;
                  }
                  fetcher.submit(
                    { intent: "updateCustomer", customerId },
                    { method: "post" },
                  );
                  setIsCustomerInfoModalOpen(false);
                }}
                className="mt-3 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              >
                <option value="" disabled>
                  Select a customer
                </option>
                {customers.map((c: { id: number; displayName: string }) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button
              onClick={() => setIsCustomerInfoModalOpen(false)}
              variant="secondary"
            >
              Close
            </Button>
            {customer?.id && (
              <Link
                to={`/customers/${customer.id}`}
                className="inline-flex items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
              >
                View Customer Details
              </Link>
            )}
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isLeadTimeModalOpen}
        onClose={() => setIsLeadTimeModalOpen(false)}
        title="Set Delivery Window"
        size="2xl"
      >
        <QuoteDeliveryDateCard
          quote={quote}
          variant="modal"
          onCancel={() => setIsLeadTimeModalOpen(false)}
          onSaved={() => setIsLeadTimeModalOpen(false)}
        />
      </Modal>

      <Modal
        isOpen={isRejectModalOpen}
        onClose={handleRejectModalClose}
        title="Reject Quote"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            Are you sure you want to reject this quote?
            {rejectionReasonRequired && (
              <span className="font-medium">
                {" "}
                A rejection reason is required.
              </span>
            )}
          </p>
          <div>
            <label
              htmlFor="rejectionReason"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
            >
              Rejection Reason{" "}
              {rejectionReasonRequired && (
                <span className="text-red-500">*</span>
              )}
              {!rejectionReasonRequired && (
                <span className="text-gray-500 font-normal">(Optional)</span>
              )}
            </label>
            <textarea
              id="rejectionReason"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              rows={4}
              placeholder="Enter the reason for rejecting this quote..."
              required={rejectionReasonRequired}
            />
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button onClick={handleRejectModalClose} variant="secondary">
              Cancel
            </Button>
            <Button onClick={handleRejectQuoteConfirm} variant="danger">
              Reject Quote
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function QuoteDetailErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
          <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
            {error.status} {error.statusText}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error.data || "An error occurred while loading the quote."}
          </p>
          <div className="flex gap-4">
            <a
              href="/quotes"
              className="inline-block px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              Back to Quotes
            </a>
            <button
              onClick={() => window.location.reload()}
              className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h1 className="text-2xl font-bold text-red-600 dark:text-red-400 mb-2">
          Unexpected Error
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          {error instanceof Error
            ? error.message
            : "An unexpected error occurred while loading the quote."}
        </p>
        <div className="flex gap-4">
          <a
            href="/quotes"
            className="inline-block px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            Back to Quotes
          </a>
          <button
            onClick={() => window.location.reload()}
            className="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    </div>
  );
}
