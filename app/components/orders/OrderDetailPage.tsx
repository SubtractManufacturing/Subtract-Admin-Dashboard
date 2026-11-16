import {
  Link,
  useLoaderData,
  useFetcher,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import { resolveInvoiceModalInitialPresetId } from "~/lib/invoice-pdf-output";
import {
  addBusinessDays,
  businessDaysFrom,
  businessDaysUntil,
  parseAppInstant,
  parseAppCalendarDateString,
  startOfTodayInAppTz,
  toAppCalendarDate,
  toAppCalendarDateIsoString,
} from "~/lib/business-days";
import { orderPlacementAnchor } from "~/lib/order-delivery";
import { formatDateForDisplay } from "~/lib/date-display";
import BusinessDayCalendar from "~/components/shared/BusinessDayCalendar";
import type { Attachment, OrderTrackingNumber, Vendor } from "~/lib/db/schema";

import Button from "~/components/shared/Button";
import { NdaRequiredBanner } from "~/components/shared/NdaRequiredBanner";
import Breadcrumbs from "~/components/Breadcrumbs";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { Notes } from "~/components/shared/Notes";
import OrderActionsDropdown from "~/components/orders/OrderActionsDropdown";
import CheckoutAddressConflictModal, {
  type CheckoutAddressImportPhase,
  type CheckoutAddressImportProgressStep,
} from "~/components/orders/CheckoutAddressConflictModal";
import type { CheckoutAddressConflictPreview } from "~/lib/stripe/checkout-address-conflict.types";
import SendOrderConfirmationModal from "~/components/orders/SendOrderConfirmationModal";
import JobBoardModal from "~/components/orders/JobBoardModal";
import { jobBoardDiscordFileName } from "~/lib/job-board/file-names";
import { JOB_BOARD_POST_REQUIRES_DELIVERY_DATE } from "~/lib/job-board/types";
import type { JobBoardPartInput } from "~/lib/job-board/types";
import GeneratePurchaseOrderPdfModal from "~/components/orders/GeneratePurchaseOrderPdfModal";
import GenerateInvoicePdfModal from "~/components/orders/GenerateInvoicePdfModal";
import GeneratePackingSlipPdfModal from "~/components/orders/GeneratePackingSlipPdfModal";
import OrderTrackingModal, { type OrderTrackingActionData } from "~/components/orders/OrderTrackingModal";
import { type LineItemWithPart } from "~/lib/lineItems";
import { orderPositiveSubtotalExcluding } from "~/lib/lineItemPricing";
import { CarrierBadge, TrackLink } from "~/components/orders/CarrierBadge";

import {
  hasConvertingOrderParts,
  planOrderLineItemEdit,
  type LineItemEditField,
} from "~/lib/order-detail/line-item-edit";
import { usePolling } from "~/hooks/usePolling";
import {
  deliveryBanner as buildDeliveryBanner,
  formatOrderDate as formatDate,
  formatOrderMoney as formatCurrency,
  orderPriority,
  orderPriorityBadgeClasses as getPriorityClasses,
  orderProgress,
  orderStatusBadgeClasses as getStatusClasses,
  orderStatusLabel as getStatusDisplay,
  vendorPayPercentage as computeVendorPayPercentage,
} from "~/lib/order-detail/view";
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Part3DViewerModal } from "~/components/shared/Part3DViewerModal";
import { EventTimeline } from "~/components/EventTimeline";
import { AttachmentsSection } from "~/components/shared/AttachmentsSection";
import { AddLineItemModal } from "~/components/shared/AddLineItemModal";
import { LineItemsSection } from "~/components/shared/LineItemsSection";
import { usePartAssetAdminAccess } from "~/components/admin/PartAssetAdminFlyout";
import {
  normalizeOrderLineItems,
  type NormalizedDrawing,
  type NormalizedPart,
} from "~/components/shared/line-items/types";
import type { loader } from "~/routes/_protected.orders.$orderId";

export default function OrderDetailPage() {
  const {
    order,
    customer,
    vendor,
    vendors,
    notes,
    lineItems,
    parts,
    user,
    userDetails,
    pdfAutoDownload,
    events,
    canRevise,
    bananaEnabled,
    bananaModelUrl,
    outboundEmailEnabled,
    hideLineItemThumbnails,
    orderConfirmationEmailReady,
    orderConfirmationEmailDefaultSubject,
    orderConfirmationEditableSlots,
    orderConfirmationRequiredAttachmentDocumentKinds,
    orderConfirmationSendBlocked,
    stripePaymentLinksEnabled,
    stripeConfigured,
    quoteStripePaymentLinkId,
    sourceQuote,
    trackingNumbers,
    archivedLineItems,
    archiveRetentionDays,
    jobBoardOrderInput,
    jobBoardWebhookConfigured,
    jobBoardNotifyRoleId,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const jobBoardClaimWarning = searchParams.get("jobBoardClaimWarning");
  const partAssetAdminAction = usePartAssetAdminAccess()
    ? `/orders/${order.orderNumber}`
    : undefined;
  const revalidator = useRevalidator();
  const [showNotice, setShowNotice] = useState(true);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    url: string;
    fileName: string;
    contentType?: string;
    fileSize?: number;
    drawingId?: string;
    partId?: string;
  } | null>(null);
  const [lineItemModalOpen, setLineItemModalOpen] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [part3DModalOpen, setPart3DModalOpen] = useState(false);
  const [selectedPart3D, setSelectedPart3D] = useState<{
    partId?: string;
    partName?: string;
    modelUrl?: string;
    solidModelUrl?: string;
    thumbnailUrl?: string;
    cadFileUrl?: string;
    meshConversionStatus?: string | null;
    meshConversionError?: string | null;
  } | null>(null);
  const [jobBoardModalOpen, setJobBoardModalOpen] = useState(false);
  const [jobBoardDeliveryDateNotice, setJobBoardDeliveryDateNotice] =
    useState(false);
  const [assignShopModalOpen, setAssignShopModalOpen] = useState(false);
  const [manageVendorModalOpen, setManageVendorModalOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<number | null>(null);
  const [editOrderModalOpen, setEditOrderModalOpen] = useState(false);
  const [trackingModalOpen, setTrackingModalOpen] = useState(false);
  const [trackingModalMode, setTrackingModalMode] = useState<
    "advance" | "manage"
  >("manage");
  const [editOrderForm, setEditOrderForm] = useState({
    deliveryDate: "",
    leadTime: "",
    vendorPayDollar: "",
    vendorPayPercent: "",
    poNumber: "",
  });
  const lineItemFetcher = useFetcher();
  const directShipPendingRef = useRef(false);
  const restoreLineItemFetcher = useFetcher();
  const [restoringArchivedLineItemId, setRestoringArchivedLineItemId] =
    useState<number | null>(null);
  const notesFetcher = useFetcher();
  const orderEditFetcher = useFetcher();
  const trackingFetcher = useFetcher<OrderTrackingActionData>();
  const drawingFetcher = useFetcher();
  const drawingDeleteFetcher = useFetcher();
  const [drawingUploadingPartId, setDrawingUploadingPartId] = useState<
    string | undefined
  >(undefined);
  const lastDrawingFetcherData = useRef<unknown>(null);
  const lastDrawingDeleteFetcherData = useRef<unknown>(null);
  const [isActionsDropdownOpen, setIsActionsDropdownOpen] = useState(false);
  const actionsButtonRef = useRef<HTMLButtonElement>(null);
  const [isPOModalOpen, setIsPOModalOpen] = useState(false);
  const [invoiceModalSource, setInvoiceModalSource] = useState<
    "standard" | "confirmation_invoice" | "confirmation_order_confirmation"
  >("standard");
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isPackingSlipModalOpen, setIsPackingSlipModalOpen] = useState(false);
  const [isSendOrderConfirmationModalOpen, setSendOrderConfirmationModalOpen] =
    useState(false);
  const [checkoutAddressModalOpen, setCheckoutAddressModalOpen] =
    useState(false);
  const [checkoutAddressPhase, setCheckoutAddressPhase] =
    useState<CheckoutAddressImportPhase>("working");
  const [checkoutAddressStep, setCheckoutAddressStep] =
    useState<CheckoutAddressImportProgressStep>("connecting");
  const [checkoutConflictPreview, setCheckoutConflictPreview] = useState<
    CheckoutAddressConflictPreview | null
  >(null);
  const [checkoutErrorMessage, setCheckoutErrorMessage] = useState<
    string | undefined
  >(undefined);
  const [checkoutSummary, setCheckoutSummary] = useState<{
    billingUpdated?: boolean;
    shippingUpdated?: boolean;
    phoneUpdated?: boolean;
  }>({});
  const checkoutAddressImportFetcher = useFetcher();
  const lastCheckoutChoicesRef = useRef<{
    billingChoice?: "checkout" | "on_file";
    shippingChoice?: "checkout" | "on_file";
    phoneChoice?: "checkout" | "on_file";
  } | null>(null);

  const showImportCheckoutAddresses =
    stripePaymentLinksEnabled && !!quoteStripePaymentLinkId;

  const importCheckoutAddressesDisabled =
    !order.customerId || !stripeConfigured;

  const importCheckoutAddressesTooltip = !order.customerId
    ? "Orders need a customer to import addresses."
    : !stripeConfigured
      ? "Payment checkout is not configured."
      : "";

  const canSendOrderConfirmation =
    outboundEmailEnabled &&
    orderConfirmationEmailReady &&
    !orderConfirmationSendBlocked &&
    Boolean(customer?.email?.trim());

  const orderEmailModalAttachments = useMemo(
    () =>
      (order.attachments ?? []).map((a: Attachment) => ({
        id: a.id,
        fileName: a.fileName,
        fileSize: a.fileSize,
        documentKind: a.documentKind,
        createdAt:
          typeof a.createdAt === "string"
            ? a.createdAt
            : (a.createdAt as Date).toISOString(),
        contentType: a.contentType,
      })),
    [order.attachments],
  );

  const orderPositiveSubForAddLineModal = useMemo(
    () =>
      orderPositiveSubtotalExcluding(
        lineItems.map((row: LineItemWithPart) => ({
          id: row.lineItem.id,
          quantity: row.lineItem.quantity,
          unitPrice: row.lineItem.unitPrice ?? "0",
        }))
      ),
    [lineItems]
  );

  const handleAddLineItem = () => {
    setLineItemModalOpen(true);
  };

  const handleDeleteLineItem = (lineItemId: number) => {
    if (
      confirm(
        `Archive this line item? It will be kept for ${archiveRetentionDays} day(s) and can be restored from Archived before permanent deletion.`,
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "archiveLineItem");
      formData.append("lineItemId", lineItemId.toString());

      lineItemFetcher.submit(formData, {
        method: "post",
      });
    }
  };

  const handleRestoreArchivedLineItem = (lineItemId: number) => {
    setRestoringArchivedLineItemId(lineItemId);
    const formData = new FormData();
    formData.append("intent", "restoreLineItem");
    formData.append("lineItemId", lineItemId.toString());
    restoreLineItemFetcher.submit(formData, { method: "post" });
  };

  useEffect(() => {
    if (lineItemFetcher.state === "idle" && lineItemFetcher.data) {
      const data = lineItemFetcher.data as {
        success?: boolean;
        error?: string;
        lineItem?: unknown;
      };
      if (data.success || data.lineItem) {
        revalidator.revalidate();
      } else if (data.error) {
        alert(`Failed to update line item: ${data.error}`);
      }
    }
  }, [lineItemFetcher.state, lineItemFetcher.data, revalidator]);

  useEffect(() => {
    if (trackingFetcher.state === "idle" && trackingFetcher.data) {
      if (trackingFetcher.data.success) {
        revalidator.revalidate();
      } else if (
        trackingFetcher.data.error &&
        directShipPendingRef.current
      ) {
        alert(`Failed to ship order: ${trackingFetcher.data.error}`);
      }
      directShipPendingRef.current = false;
    }
  }, [trackingFetcher.state, trackingFetcher.data, revalidator]);

  useEffect(() => {
    if (restoreLineItemFetcher.state === "idle" && restoreLineItemFetcher.data) {
      const data = restoreLineItemFetcher.data as {
        success?: boolean;
        error?: string;
      };
      setRestoringArchivedLineItemId(null);
      if (data.success) {
        revalidator.revalidate();
      } else if (data.error) {
        alert(`Failed to restore line item: ${data.error}`);
      }
    }
  }, [restoreLineItemFetcher.state, restoreLineItemFetcher.data, revalidator]);

  const handleDrawingUpload = useCallback(
    (partId: string, files: FileList | null) => {
      if (!files || files.length === 0) return;

      // Validate file sizes (10MB limit per file)
      const MAX_DRAWING_SIZE = 10 * 1024 * 1024; // 10MB
      const invalidFiles = Array.from(files).filter(
        (file) => file.size > MAX_DRAWING_SIZE
      );

      if (invalidFiles.length > 0) {
        alert(
          `The following files exceed the 10MB limit:\n${invalidFiles
            .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB)`)
            .join("\n")}`
        );
        return;
      }

      setDrawingUploadingPartId(partId);
      const formData = new FormData();
      formData.append("intent", "addDrawingToPart");
      formData.append("partId", partId);

      Array.from(files).forEach((file, index) => {
        formData.append(`drawing_${index}`, file);
      });
      formData.append("drawingCount", files.length.toString());

      drawingFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
    },
    [drawingFetcher]
  );

  // Watch drawing upload completion and revalidate
  useEffect(() => {
    if (
      drawingFetcher.state === "idle" &&
      drawingFetcher.data &&
      drawingFetcher.data !== lastDrawingFetcherData.current
    ) {
      lastDrawingFetcherData.current = drawingFetcher.data;
      const data = drawingFetcher.data as { success?: boolean; error?: string };
      if (data.success) {
        // Success - revalidate to show new drawings
        setDrawingUploadingPartId(undefined);
        revalidator.revalidate();
      } else if (data.error) {
        // Error - show error message
        setDrawingUploadingPartId(undefined);
        alert(`Upload failed: ${data.error}`);
      }
    }
  }, [drawingFetcher.state, drawingFetcher.data, revalidator]);

  const handleDeleteDrawing = useCallback(
    (drawingId: string, partId: string) => {
      const formData = new FormData();
      formData.append("intent", "deleteDrawingFromPart");
      formData.append("drawingId", drawingId);
      formData.append("partId", partId);

      drawingDeleteFetcher.submit(formData, {
        method: "post",
      });
    },
    [drawingDeleteFetcher]
  );

  // Watch drawing delete completion and revalidate
  useEffect(() => {
    if (
      drawingDeleteFetcher.state === "idle" &&
      drawingDeleteFetcher.data &&
      drawingDeleteFetcher.data !== lastDrawingDeleteFetcherData.current
    ) {
      lastDrawingDeleteFetcherData.current = drawingDeleteFetcher.data;
      const data = drawingDeleteFetcher.data as {
        success?: boolean;
        error?: string;
      };
      if (data.success) {
        // Success - close modal and revalidate
        setFileModalOpen(false);
        setSelectedFile(null);
        revalidator.revalidate();
      } else if (data.error) {
        // Error - show error message
        alert(`Delete failed: ${data.error}`);
      }
    }
  }, [drawingDeleteFetcher.state, drawingDeleteFetcher.data, revalidator]);

  // Refresh while parts are converting; give up after 10 minutes (120 x 5s).
  usePolling({
    active: hasConvertingOrderParts(
      lineItems.map((li: LineItemWithPart) => li.part),
    ),
    intervalMs: 5000,
    maxTicks: 120,
    resetKey: order.id,
    onTick: () => revalidator.revalidate(),
  });

  const handleAddLineItemSubmit = useCallback(
    (submitData: FormData) => {
      const hasUpload = !!submitData.get("file");
      submitData.append("intent", hasUpload ? "createLineItemWithUpload" : "createLineItem");
      lineItemFetcher.submit(submitData, {
        method: "post",
        encType: hasUpload ? "multipart/form-data" : "application/x-www-form-urlencoded",
      });
    },
    [lineItemFetcher]
  );

  const handleSaveLineItemField = useCallback(
    (
      lineItemId: number,
      field: LineItemEditField,
      value: string
    ) => {
      const plan = planOrderLineItemEdit(
        lineItems.map((li: LineItemWithPart) => li.lineItem),
        lineItemId,
        field,
        value,
      );
      if (plan.kind === "reject") alert(plan.message);
      if (plan.kind !== "save") return;
      lineItemFetcher.submit(plan.fields, { method: "post" });
    },
    [lineItems, lineItemFetcher]
  );

  const handleSavePartAttribute = useCallback(
    (partId: string, field: "material" | "tolerance" | "finish", value: string) => {
      const currentPart = lineItems.find(
        (item: LineItemWithPart) => item.part?.id === partId
      )?.part;
      if (!currentPart) return;

      const formData = new FormData();
      formData.append("intent", "updatePartAttributes");
      formData.append("partId", partId);
      formData.append("material", field === "material" ? value : currentPart.material || "");
      formData.append("tolerance", field === "tolerance" ? value : currentPart.tolerance || "");
      formData.append("finishing", field === "finish" ? value : currentPart.finishing || "");
      notesFetcher.submit(formData, { method: "post" });
    },
    [lineItems, notesFetcher]
  );

  const handleView3DModel = (part: {
    id: string;
    partName: string | null;
    partMeshUrl?: string | null;
    partFileUrl?: string | null;
    thumbnailUrl?: string | null;
    meshConversionStatus?: string | null;
    meshConversionError?: string | null;
  }) => {
    if (part) {
      setSelectedPart3D({
        partId: part.id,
        partName: part.partName || undefined,
        modelUrl: part.partMeshUrl || undefined,
        solidModelUrl: part.partFileUrl || undefined,
        thumbnailUrl: part.thumbnailUrl || undefined,
        // partFileUrl is the original CAD file used for revisions
        cadFileUrl: part.partFileUrl || undefined,
        meshConversionStatus: part.meshConversionStatus,
        meshConversionError: part.meshConversionError,
      });
      setPart3DModalOpen(true);
    }
  };

  const openJobBoardPartViewer = (partId: string) => {
    const item = lineItems.find(
      (lineItem: LineItemWithPart) => lineItem.part?.id === partId,
    );
    if (item?.part) {
      handleView3DModel(item.part);
    }
  };

  // Status transition handlers
  const handleSendToShops = () => {
    if (!order.deliveryDate) {
      setJobBoardDeliveryDateNotice(true);
      return;
    }
    setJobBoardDeliveryDateNotice(false);
    setJobBoardModalOpen(true);
  };

  useEffect(() => {
    if (order.deliveryDate) {
      setJobBoardDeliveryDateNotice(false);
    }
  }, [order.deliveryDate]);

  const jobBoardPartPreviews = useMemo(() => {
    if (!jobBoardOrderInput) return [];
    return jobBoardOrderInput.parts.map((part: JobBoardPartInput) => {
      const lineItem = lineItems.find(
        (item: LineItemWithPart) => item.part?.id === part.partId,
      );
      return {
        partId: part.partId,
        partName: part.partName,
        quantity: part.quantity,
        thumbnailUrl: lineItem?.part?.thumbnailUrl ?? null,
        hasThumbnail: Boolean(part.thumbnailS3Key),
        hasCad: Boolean(part.currentCad),
        cadFileName: part.currentCad
          ? jobBoardDiscordFileName(
              part.currentCad.s3Key,
              part.currentCad.fileName,
            )
          : null,
        drawings: part.drawings.map((drawing: { attachmentId: string; s3Key: string; fileName: string }) => ({
          id: drawing.attachmentId,
          fileName: jobBoardDiscordFileName(drawing.s3Key, drawing.fileName),
        })),
      };
    });
  }, [jobBoardOrderInput, lineItems]);

  const handleStartProduction = () => {
    if (
      confirm(
        "Are you sure you want to start production? The order will move to 'In Production' status."
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "In_Production");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleAssignShop = () => {
    setSelectedVendorId(order.vendorId);
    setAssignShopModalOpen(true);
  };

  const handleAssignShopSubmit = () => {
    if (!selectedVendorId) {
      alert("Please select a vendor");
      return;
    }

    const formData = new FormData();
    formData.append("intent", "assignShop");
    formData.append("vendorId", selectedVendorId.toString());
    lineItemFetcher.submit(formData, { method: "post" });
    setAssignShopModalOpen(false);
  };

  const handleManageVendor = () => {
    setSelectedVendorId(order.vendorId);
    setManageVendorModalOpen(true);
  };

  const handleDuplicateOrder = () => {
    if (
      confirm(
        "Create a duplicate of this order? A new order with a fresh order number will be created."
      )
    ) {
      lineItemFetcher.submit(
        { intent: "duplicateOrder" },
        { method: "post" }
      );
    }
  };

  useEffect(() => {
    if (!checkoutAddressModalOpen) return;
    if (checkoutAddressImportFetcher.state === "submitting") {
      setCheckoutAddressStep("fetching");
      return;
    }
    if (checkoutAddressImportFetcher.state === "loading") {
      setCheckoutAddressStep("comparing");
    }
  }, [checkoutAddressImportFetcher.state, checkoutAddressModalOpen]);

  useEffect(() => {
    if (!checkoutAddressModalOpen) return;
    if (checkoutAddressImportFetcher.state !== "idle") return;
    const d = checkoutAddressImportFetcher.data as
      | {
          kind?: string;
          message?: string;
          reason?: string;
          preview?: CheckoutAddressConflictPreview;
          success?: boolean;
          updated?: boolean;
          error?: string;
        }
      | undefined;
    if (!d) return;

    if (d.kind === "error" || d.error) {
      setCheckoutErrorMessage(d.message ?? d.error ?? "Import failed.");
      setCheckoutAddressPhase("error");
      return;
    }

    if (d.kind === "applied") {
      const choices = lastCheckoutChoicesRef.current;
      lastCheckoutChoicesRef.current = null;
      setCheckoutSummary(
        choices
          ? {
              billingUpdated: choices.billingChoice === "checkout",
              shippingUpdated: choices.shippingChoice === "checkout",
              phoneUpdated: choices.phoneChoice === "checkout",
            }
          : { billingUpdated: true, shippingUpdated: true, phoneUpdated: true }
      );
      setCheckoutAddressPhase("success");
      revalidator.revalidate();
      return;
    }

    if (d.kind === "noop") {
      setCheckoutErrorMessage(d.message);
      setCheckoutAddressPhase("noop");
      return;
    }

    if (d.kind === "conflict" && d.preview) {
      setCheckoutConflictPreview(d.preview);
      setCheckoutAddressPhase("conflict");
      return;
    }

    if (d.success === true && typeof d.updated === "boolean") {
      const choices = lastCheckoutChoicesRef.current;
      lastCheckoutChoicesRef.current = null;
      if (d.updated) {
        setCheckoutSummary({
          billingUpdated: choices?.billingChoice === "checkout",
          shippingUpdated: choices?.shippingChoice === "checkout",
          phoneUpdated: choices?.phoneChoice === "checkout",
        });
        setCheckoutAddressPhase("success");
        revalidator.revalidate();
      } else {
        setCheckoutAddressPhase("noop");
      }
    }
  }, [
    checkoutAddressImportFetcher.state,
    checkoutAddressImportFetcher.data,
    checkoutAddressModalOpen,
    revalidator,
  ]);

  const startCheckoutAddressImport = () => {
    setCheckoutErrorMessage(undefined);
    setCheckoutConflictPreview(null);
    setCheckoutSummary({});
    setCheckoutAddressStep("connecting");
    setCheckoutAddressPhase("working");
    setCheckoutAddressModalOpen(true);
    const fd = new FormData();
    fd.append("intent", "importCheckoutAddressesQuick");
    checkoutAddressImportFetcher.submit(fd, { method: "post" });
  };

  const handleImportCheckoutAddresses = () => {
    if (importCheckoutAddressesDisabled) return;
    startCheckoutAddressImport();
  };

  const handleCloseCheckoutAddressModal = () => {
    setCheckoutAddressModalOpen(false);
    setCheckoutConflictPreview(null);
    setCheckoutErrorMessage(undefined);
  };

  const handleCheckoutConflictConfirm = (choices: {
    billingChoice?: "checkout" | "on_file";
    shippingChoice?: "checkout" | "on_file";
    phoneChoice?: "checkout" | "on_file";
  }) => {
    lastCheckoutChoicesRef.current = choices;
    setCheckoutAddressPhase("submitting_choices");
    setCheckoutAddressStep("applying");
    const fd = new FormData();
    fd.append("intent", "applyCheckoutAddressImportChoices");
    if (choices.billingChoice)
      fd.append("billingChoice", choices.billingChoice);
    if (choices.shippingChoice)
      fd.append("shippingChoice", choices.shippingChoice);
    if (choices.phoneChoice) fd.append("phoneChoice", choices.phoneChoice);
    checkoutAddressImportFetcher.submit(fd, { method: "post" });
  };

  const handleManageVendorSubmit = () => {
    const formData = new FormData();
    formData.append("intent", "updateVendor");
    if (selectedVendorId) {
      formData.append("vendorId", selectedVendorId.toString());
    }
    lineItemFetcher.submit(formData, { method: "post" });
    setManageVendorModalOpen(false);
  };

  const handleRemoveVendor = () => {
    if (
      confirm("Are you sure you want to remove the vendor from this order?")
    ) {
      const formData = new FormData();
      formData.append("intent", "updateVendor");
      lineItemFetcher.submit(formData, { method: "post" });
      setManageVendorModalOpen(false);
    }
  };

  const handleStartInspection = () => {
    if (
      confirm(
        "Are you sure you want to start inspection? The order will move to 'In Inspection' status."
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "In_Inspection");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const submitShipOrder = () => {
    const formData = new FormData();
    formData.append("intent", "shipOrder");
    formData.append("newTrackingEntries", "[]");
    formData.append("updatedTrackingEntries", "[]");
    formData.append("deletedIds", "[]");
    trackingFetcher.submit(formData, { method: "post" });
  };

  const handleShipOrder = () => {
    if (trackingNumbers.length > 0) {
      directShipPendingRef.current = true;
      submitShipOrder();
      return;
    }
    setTrackingModalMode("advance");
    setTrackingModalOpen(true);
  };

  const handleManageTracking = () => {
    setTrackingModalMode("manage");
    setTrackingModalOpen(true);
  };

  const handleMarkAsDelivered = () => {
    if (confirm("Are you sure you want to mark this order as delivered?")) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "Delivered");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const handleCompleteOrder = () => {
    if (
      confirm(
        "Are you sure you want to complete this order? The order will be marked as 'Completed'."
      )
    ) {
      const formData = new FormData();
      formData.append("intent", "updateStatus");
      formData.append("status", "Completed");
      lineItemFetcher.submit(formData, { method: "post" });
    }
  };

  const orderPlacedAnchor = useMemo(() => {
    const createdAt = parseAppInstant(order.createdAt);
    return createdAt ? orderPlacementAnchor(createdAt) : startOfTodayInAppTz();
  }, [order.createdAt]);
  const orderDeliveryDate = parseAppInstant(order.deliveryDate);

  const handleEditOrder = () => {
    // Initialize with the existing vendor pay dollar amount
    const vendorPayAmount = Math.max(0, parseFloat(order.vendorPay || "0"));
    const orderTotal = Math.max(0, parseFloat(order.totalPrice || "0"));
    const vendorPayPercentCalc =
      orderTotal > 0 ? Math.min(100, (vendorPayAmount / orderTotal) * 100) : 70;

    setEditOrderForm({
      deliveryDate: orderDeliveryDate
        ? toAppCalendarDateIsoString(orderDeliveryDate)
        : "",
      leadTime: order.leadTime?.toString() || "",
      vendorPayDollar: vendorPayAmount > 0 ? vendorPayAmount.toFixed(2) : "",
      vendorPayPercent:
        vendorPayPercentCalc > 0 ? vendorPayPercentCalc.toFixed(1) : "",
      poNumber: order.poNumber || "",
    });
    setEditOrderModalOpen(true);
  };

  const handleEditOrderSubmit = useCallback(() => {
    const formData = new FormData();
    formData.append("intent", "updateOrderInfo");

    if (!editOrderForm.deliveryDate && !editOrderForm.leadTime) {
      formData.append("deliveryDate", "");
    } else {
      if (editOrderForm.deliveryDate) {
        formData.append("deliveryDate", editOrderForm.deliveryDate);
      }

      if (editOrderForm.leadTime) {
        const leadTime = parseInt(editOrderForm.leadTime);
        if (!isNaN(leadTime) && leadTime >= 0) {
          formData.append("leadTime", leadTime.toString());
        }
      }
    }

    // Validate and submit vendor pay
    const vendorPayDollar = parseFloat(editOrderForm.vendorPayDollar || "0");
    if (!isNaN(vendorPayDollar) && vendorPayDollar >= 0) {
      formData.append("vendorPay", vendorPayDollar.toFixed(2));
    } else {
      // Default to 0 if invalid
      formData.append("vendorPay", "0.00");
    }

    formData.append("poNumber", editOrderForm.poNumber.trim());

    orderEditFetcher.submit(formData, { method: "post" });
    setEditOrderModalOpen(false);
  }, [editOrderForm, orderEditFetcher]);

  // Handle keyboard shortcuts for edit order modal
  useEffect(() => {
    if (!editOrderModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setEditOrderModalOpen(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleEditOrderSubmit();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editOrderModalOpen, handleEditOrderSubmit]);

  const handleGenerateInvoice = () => {
    setInvoiceModalSource("standard");
    setIsInvoiceModalOpen(true);
  };

  const handleGeneratePO = () => {
    setIsPOModalOpen(true);
  };

  const handleGeneratePackingSlip = () => {
    setIsPackingSlipModalOpen(true);
  };

  const businessDaysToDelivery = orderDeliveryDate
    ? businessDaysUntil(orderDeliveryDate)
    : null;

  const priority = orderPriority(businessDaysToDelivery);

  const deliveryBanner = buildDeliveryBanner(
    orderDeliveryDate
      ? {
          businessDays: businessDaysUntil(orderDeliveryDate),
          dateLabel: formatDateForDisplay(orderDeliveryDate) ?? "",
        }
      : null,
  );

  // Use the stored total price from the database (maintained by line item operations)
  const orderTotalPrice = order.totalPrice || "0";
  const normalizedLineItems = useMemo(
    () => normalizeOrderLineItems(lineItems as LineItemWithPart[]),
    [lineItems]
  );

  // For debugging: calculate from line items to verify stored total is correct
  // const calculatedFromLineItems = lineItems
  //   .reduce((sum: number, item: LineItemWithPart) => {
  //     const quantity = item.lineItem?.quantity || 0;
  //     const unitPrice = parseFloat(item.lineItem?.unitPrice || "0");
  //     return sum + quantity * unitPrice;
  //   }, 0)
  //   .toString();

  // Vendor pay is now stored as a dollar amount
  const vendorPayAmount = parseFloat(order.vendorPay || "0");

  // Calculate the percentage for display purposes
  const vendorPayPercentage = computeVendorPayPercentage(
    order.vendorPay,
    orderTotalPrice,
  );
  const progress = orderProgress(order.status);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-[1920px] mx-auto">
        {jobBoardDeliveryDateNotice && (
          <div className="mx-10 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            <div className="flex items-start justify-between gap-4">
              <p>{JOB_BOARD_POST_REQUIRES_DELIVERY_DATE}</p>
              <button
                type="button"
                className="shrink-0 text-red-800 underline dark:text-red-200"
                onClick={() => setJobBoardDeliveryDateNotice(false)}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {jobBoardClaimWarning && (
          <div className="mx-10 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start justify-between gap-4">
              <p>{jobBoardClaimWarning}</p>
              <button
                type="button"
                className="shrink-0 text-amber-800 underline dark:text-amber-200"
                onClick={() => {
                  const next = new URLSearchParams(searchParams);
                  next.delete("jobBoardClaimWarning");
                  setSearchParams(next, { replace: true });
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        {/* Custom breadcrumb bar with buttons */}
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/" },
              { label: "Orders", href: "/orders" },
              { label: order.orderNumber },
            ]}
          />
          <div className="flex flex-wrap gap-3">
            <div className="relative">
              <Button
                ref={actionsButtonRef}
                onClick={() => setIsActionsDropdownOpen(!isActionsDropdownOpen)}
                variant="secondary"
              >
                Actions
              </Button>
              <OrderActionsDropdown
                isOpen={isActionsDropdownOpen}
                onClose={() => setIsActionsDropdownOpen(false)}
                excludeRef={actionsButtonRef}
                onDuplicate={handleDuplicateOrder}
                onGenerateInvoice={handleGenerateInvoice}
                onGeneratePO={handleGeneratePO}
                onGeneratePackingSlip={handleGeneratePackingSlip}
                onManageTracking={
                  order.status === "Archived" ? undefined : handleManageTracking
                }
                onManageVendor={handleManageVendor}
                onSendOrderConfirmation={() =>
                  setSendOrderConfirmationModalOpen(true)
                }
                hasVendor={!!order.vendorId}
                hasCustomer={!!order.customerId}
                showOrderConfirmationInMenu={
                  outboundEmailEnabled &&
                  orderConfirmationEmailReady &&
                  order.status !== "Pending"
                }
                orderConfirmationMenuDisabled={
                  !canSendOrderConfirmation
                }
                onImportCheckoutAddresses={handleImportCheckoutAddresses}
                showImportCheckoutAddresses={showImportCheckoutAddresses}
                importCheckoutAddressesDisabled={
                  importCheckoutAddressesDisabled
                }
                importCheckoutAddressesTooltip={
                  importCheckoutAddressesTooltip
                }
              />
            </div>
            {order.status === "Pending" &&
              canSendOrderConfirmation && (
                <Button
                  onClick={() => setSendOrderConfirmationModalOpen(true)}
                  variant="primary"
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  Send customer confirmation
                </Button>
              )}
            {order.status === "Pending" &&
              (order.vendorId ? (
                <Button
                  onClick={handleStartProduction}
                  variant="primary"
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Start Production
                </Button>
              ) : (
                <Button
                  onClick={handleSendToShops}
                  variant="primary"
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  Send to Board
                </Button>
              ))}
            {order.status === "Waiting_For_Shop_Selection" && (
              <Button
                onClick={handleAssignShop}
                variant="primary"
                className="bg-blue-600 hover:bg-blue-700"
              >
                Assign Shop
              </Button>
            )}
            {order.status === "In_Production" && (
              <Button
                onClick={handleStartInspection}
                variant="primary"
                className="bg-amber-600 hover:bg-amber-700"
              >
                Start Inspection
              </Button>
            )}
            {order.status === "In_Inspection" && (
              <Button
                onClick={handleShipOrder}
                variant="primary"
                className="bg-teal-600 hover:bg-teal-700"
                disabled={
                  trackingFetcher.state !== "idle" && !trackingModalOpen
                }
              >
                {trackingFetcher.state !== "idle" && !trackingModalOpen
                  ? "Shipping..."
                  : "Ship Order"}
              </Button>
            )}
            {order.status === "Shipped" && (
              <Button
                onClick={handleMarkAsDelivered}
                variant="primary"
                className="bg-green-600 hover:bg-green-700"
              >
                Mark as Delivered
              </Button>
            )}
            {order.status === "Delivered" && (
              <Button
                onClick={handleCompleteOrder}
                variant="primary"
                className="bg-green-700 hover:bg-green-800"
              >
                Complete Order
              </Button>
            )}
            {/* No action buttons for archived orders - restore button is in the banner */}
          </div>
        </div>

        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">
          <div className="flex flex-col gap-3">
            <NdaRequiredBanner required={order.ndaRequired} />
            <orderEditFetcher.Form method="post">
              <input type="hidden" name="intent" value="updateNdaRequired" />
              <input type="hidden" name="ndaRequired" value={String(!order.ndaRequired)} />
              <button type="submit" className="text-sm font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400">
                {order.ndaRequired ? "Remove NDA requirement" : "Mark NDA required"}
              </button>
            </orderEditFetcher.Form>
          </div>
          {/* Archived Notice Bar */}
          {order.status === "Archived" && (
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
                    This order has been archived
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Delivery Date proximity banner */}
          {deliveryBanner.show &&
            order.status !== "Archived" &&
            (deliveryBanner.color === "amber" || showNotice) && (
            <div
              className={`relative rounded-lg p-4 border-2 ${
                deliveryBanner.color === "amber"
                  ? "bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-700"
                  : deliveryBanner.color === "orange"
                    ? "bg-orange-100 dark:bg-orange-900/50 border-orange-300 dark:border-orange-700"
                    : "bg-red-100 dark:bg-red-900/50 border-red-300 dark:border-red-700"
              }`}
            >
              {deliveryBanner.color !== "amber" && (
                <button
                  onClick={() => setShowNotice(false)}
                  className="absolute top-2 right-2 text-gray-600 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              )}
              <p
                className={`font-semibold ${
                  deliveryBanner.color === "amber"
                    ? "text-amber-900 dark:text-amber-200"
                    : deliveryBanner.color === "orange"
                      ? "text-orange-800 dark:text-orange-200"
                      : "text-red-800 dark:text-red-200"
                }`}
              >
                {deliveryBanner.message}
              </p>
            </div>
          )}

          {/* Status Cards - Always at top */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Order Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Order Status
              </h3>
              <div
                className={`px-4 py-3 rounded-full text-center font-semibold ${getStatusClasses(
                  order.status
                )}`}
              >
                {getStatusDisplay(order.status)}
              </div>
            </div>

            {/* Priority Level Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Priority Level
              </h3>
              <div
                className={`px-4 py-3 rounded-full text-center font-semibold ${getPriorityClasses(
                  priority
                )}`}
              >
                {priority} Priority
              </div>
            </div>

            {/* Order Value Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Order Value
              </h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {formatCurrency(orderTotalPrice)}
              </p>
            </div>

            {/* Progress Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Progress
              </h3>
              <div className="relative w-full h-8 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="absolute top-0 left-0 h-full bg-green-500 dark:bg-green-600 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
                <span className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white">
                  {progress}%
                </span>
              </div>
            </div>
          </div>

          {/* Information Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Order Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Order Information
                </h3>
                <button
                  onClick={handleEditOrder}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                >
                  Edit
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
                    />
                  </svg>
                </button>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Order Number
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {order.orderNumber}
                    </p>
                  </div>
                  {sourceQuote ? (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Source Quote
                      </p>
                      <Link
                        to={`/quotes/${sourceQuote.id}`}
                        className="text-lg font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                      >
                        {sourceQuote.quoteNumber}
                      </Link>
                    </div>
                  ) : null}
                  {order.poNumber ? (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        PO Number
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        {order.poNumber}
                      </p>
                    </div>
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Order Date
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {formatDate(order.createdAt)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Delivery Date
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {orderDeliveryDate
                        ? formatDateForDisplay(orderDeliveryDate) ??
                          formatDate(orderDeliveryDate)
                        : "--"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Lead Time (Business Days)
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {order.leadTime
                        ? `${order.leadTime} Business Day${order.leadTime === 1 ? "" : "s"}`
                        : "--"}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Vendor Pay
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {formatCurrency(vendorPayAmount.toString())} (
                      {vendorPayPercentage.toFixed(1)}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Profit Margin
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {formatCurrency(
                        (
                          parseFloat(orderTotalPrice) - vendorPayAmount
                        ).toString()
                      )}{" "}
                      ({(100 - vendorPayPercentage).toFixed(1)}%)
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Customer Information
                </h3>
                {customer && (
                  <a
                    href={`/customers/${customer.id}`}
                    className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                  >
                    View Customer
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="14"
                      height="14"
                      fill="currentColor"
                      viewBox="0 0 16 16"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
                      />
                    </svg>
                  </a>
                )}
              </div>
              <div className="p-6">
                {customer ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Company
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        {customer.displayName}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Customer ID
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        CUST-{customer.id.toString().padStart(5, "0")}
                      </p>
                    </div>
                    {customer.email && (
                      <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4">
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                          Primary Contact
                        </p>
                        <p className="text-gray-900 dark:text-gray-100">
                          {customer.email}
                        </p>
                        {customer.phone && (
                          <p className="text-gray-900 dark:text-gray-100">
                            {customer.phone}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">
                    No customer information available
                  </p>
                )}
              </div>
            </div>
          </div>

          <LineItemsSection
            items={normalizedLineItems}
            entityType="order"
            hideThumbnails={hideLineItemThumbnails}
            subtotal={formatCurrency(orderTotalPrice)}
            archivedItems={archivedLineItems}
            onAdd={handleAddLineItem}
            onDelete={handleDeleteLineItem}
            onRestoreArchived={handleRestoreArchivedLineItem}
            isRestoringArchived={restoreLineItemFetcher.state !== "idle"}
            restoringArchivedLineItemId={restoringArchivedLineItemId}
            onSaveField={handleSaveLineItemField}
            onSaveAttribute={handleSavePartAttribute}
            onDrawingUpload={(partId, files) => handleDrawingUpload(partId, files)}
            onDrawingDelete={handleDeleteDrawing}
            drawingUploadingPartId={drawingUploadingPartId}
            partAssetAdminAction={partAssetAdminAction}
            onView3DModel={(part: NormalizedPart) => {
              handleView3DModel({
                id: part.id,
                partName: part.partName || null,
                partMeshUrl: part.modelUrl || null,
                partFileUrl: part.cadFileUrl || null,
                thumbnailUrl: part.thumbnailUrl || null,
                meshConversionStatus: part.conversionStatus,
                meshConversionError: part.meshConversionError,
              });
            }}
            onViewDrawing={(drawing: NormalizedDrawing, partId: string) => {
              setSelectedFile({
                url: drawing.signedUrl,
                fileName: drawing.fileName,
                contentType: drawing.contentType || undefined,
                fileSize: drawing.fileSize || undefined,
                drawingId: drawing.id,
                partId,
              });
              setFileModalOpen(true);
            }}
          />

          {/* Order Notes - full width */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                Order Notes
              </h3>
              {!isAddingNote && (
                <Button size="sm" onClick={() => setIsAddingNote(true)}>
                  Add Note
                </Button>
              )}
            </div>
            <div className="p-6">
              <Notes
                entityType="order"
                entityId={order.id.toString()}
                initialNotes={notes}
                currentUserId={user.id || user.email}
                currentUserName={userDetails?.name || user.email}
                showHeader={false}
                onAddNoteClick={() => setIsAddingNote(false)}
                isAddingNote={isAddingNote}
                externalControl={true}
              />
            </div>
          </div>

          {/* Vendor Information */}
          {vendor && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Vendor Information
                </h3>
                <a
                  href={`/vendors/${vendor.id}`}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 rounded-md transition-colors"
                >
                  View Vendor
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    fill="currentColor"
                    viewBox="0 0 16 16"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
                    />
                  </svg>
                </a>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Vendor
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {vendor.displayName}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      Company
                    </p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {vendor.companyName || "--"}
                    </p>
                  </div>
                  {vendor.contactName && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Contact
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        {vendor.contactName}
                      </p>
                    </div>
                  )}
                  {vendor.email && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                        Email
                      </p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">
                        {vendor.email}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          <AttachmentsSection
            attachments={order.attachments || []}
            entityType="order"
            entityId={order.id}
            canDeleteProtected={userDetails.role === "Admin" || userDetails.role === "Dev"}
          />

          {/* Shipping and Event Log - Side by Side at bottom */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  Shipping
                </h3>
                {order.status !== "Archived" && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleManageTracking}
                  >
                    Manage
                  </Button>
                )}
              </div>
              <div className="p-6">
                {trackingNumbers.length > 0 ? (
                  <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                    {trackingNumbers.map(
                      (trackingNumber: OrderTrackingNumber) => {
                        const customName =
                          trackingNumber.carrier === "OTHER"
                            ? ((trackingNumber.carrierDetails as { name: string } | null)?.name ?? null)
                            : null;
                        return (
                          <li
                            key={trackingNumber.id}
                            className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                          >
                            <div className="flex min-w-0 items-center gap-2">
                              <CarrierBadge
                                code={trackingNumber.carrier}
                                customName={customName}
                                size="md"
                              />
                              <span className="truncate text-sm text-gray-900 dark:text-gray-100">
                                {trackingNumber.trackingNumber}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <TrackLink
                                code={trackingNumber.carrier}
                                trackingNumber={trackingNumber.trackingNumber}
                              />
                              <span className="text-sm text-gray-500 dark:text-gray-400">
                                {formatDate(trackingNumber.createdAt)}
                              </span>
                            </div>
                          </li>
                        );
                      },
                    )}
                  </ul>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">
                    No tracking numbers yet.
                  </p>
                )}
              </div>
            </div>

            <EventTimeline
              entityType="order"
              entityId={order.id.toString()}
              entityName={order.orderNumber}
              initialEvents={events}
            />
          </div>
        </div>
      </div>

      {/* File Viewer Modal */}
      {selectedFile && (
        <FileViewerModal
          isOpen={fileModalOpen}
          onClose={() => {
            setFileModalOpen(false);
            setSelectedFile(null);
          }}
          fileUrl={selectedFile.url}
          fileName={selectedFile.fileName}
          contentType={selectedFile.contentType}
          fileSize={selectedFile.fileSize}
          onDelete={
            selectedFile.drawingId && selectedFile.partId
              ? () =>
                  handleDeleteDrawing(
                    selectedFile.drawingId!,
                    selectedFile.partId!
                  )
              : undefined
          }
          isDeleting={drawingDeleteFetcher.state === "submitting"}
          partAssetAdmin={
            partAssetAdminAction &&
            selectedFile.drawingId &&
            selectedFile.partId
              ? {
                  action: partAssetAdminAction,
                  context: {
                    surface: "drawing",
                    entity: "part",
                    parentPartId: selectedFile.partId,
                    drawingId: selectedFile.drawingId,
                    fileName: selectedFile.fileName,
                  },
                }
              : undefined
          }
        />
      )}

      {/* Add Line Item Modal */}
      <AddLineItemModal
        isOpen={lineItemModalOpen}
        onClose={() => setLineItemModalOpen(false)}
        onSubmit={handleAddLineItemSubmit}
        context="order"
        positiveSubtotalForDiscount={orderPositiveSubForAddLineModal}
        customerId={order.customerId}
        existingParts={parts}
      />

      <OrderTrackingModal
        isOpen={trackingModalOpen}
        onClose={() => setTrackingModalOpen(false)}
        mode={trackingModalMode}
        existingTrackingNumbers={trackingNumbers}
        fetcher={trackingFetcher}
        disabled={order.status === "Archived"}
      />

      {/* 3D Viewer Modal */}
      {selectedPart3D && (
        <Part3DViewerModal
          isOpen={part3DModalOpen}
          zIndex={jobBoardModalOpen ? 60 : 50}
          onClose={() => {
            setPart3DModalOpen(false);
            setSelectedPart3D(null);
          }}
          partName={selectedPart3D.partName}
          modelUrl={selectedPart3D.modelUrl}
          solidModelUrl={selectedPart3D.solidModelUrl}
          partId={selectedPart3D.partId}
          entityType="part"
          cadFileUrl={selectedPart3D.cadFileUrl}
          partAssetAdminAction={partAssetAdminAction}
          meshConversionStatus={selectedPart3D.meshConversionStatus}
          meshConversionError={selectedPart3D.meshConversionError}
          canRevise={canRevise}
          onThumbnailUpdate={() => {
            revalidator.revalidate();
          }}
          onRevisionComplete={() => {
            revalidator.revalidate();
          }}
          onRegenerateMesh={
            selectedPart3D.partId
              ? () => {
                  const fd = new FormData();
                  fd.append("intent", "regenerateMesh");
                  fd.append("partId", selectedPart3D.partId!);
                  lineItemFetcher.submit(fd, { method: "post" });
                  setPart3DModalOpen(false);
                  setSelectedPart3D(null);
                  revalidator.revalidate();
                }
              : undefined
          }
          autoGenerateThumbnail={true}
          existingThumbnailUrl={selectedPart3D.thumbnailUrl}
          bananaEnabled={bananaEnabled}
          bananaModelUrl={bananaModelUrl || undefined}
        />
      )}

      {/* Purchase Order PDF Modal */}
      <GeneratePurchaseOrderPdfModal
        isOpen={isPOModalOpen}
        onClose={() => setIsPOModalOpen(false)}
        order={order}
        lineItems={lineItems.map((item: LineItemWithPart) => item.lineItem)}
        parts={lineItems.map((item: LineItemWithPart) => item.part)}
        autoDownload={pdfAutoDownload}
      />

      {/* Invoice PDF Modal */}
      <GenerateInvoicePdfModal
        isOpen={isInvoiceModalOpen}
        onClose={() => {
          setIsInvoiceModalOpen(false);
          setInvoiceModalSource("standard");
        }}
        entity={order}
        lineItems={lineItems.map((item: LineItemWithPart) => item.lineItem)}
        parts={lineItems.map((item: LineItemWithPart) => item.part)}
        initialPresetId={resolveInvoiceModalInitialPresetId(
          invoiceModalSource,
          order.poNumber,
        )}
        autoDownload={
          invoiceModalSource === "standard" ? pdfAutoDownload : false
        }
      />

      <GeneratePackingSlipPdfModal
        isOpen={isPackingSlipModalOpen}
        onClose={() => setIsPackingSlipModalOpen(false)}
        order={order}
        lineItems={lineItems.map((item: LineItemWithPart) => item.lineItem)}
        parts={lineItems.map((item: LineItemWithPart) => item.part)}
        autoDownload={pdfAutoDownload}
      />

      <CheckoutAddressConflictModal
        open={checkoutAddressModalOpen}
        phase={checkoutAddressPhase}
        progressStep={checkoutAddressStep}
        preview={checkoutConflictPreview}
        summary={checkoutSummary}
        errorMessage={checkoutErrorMessage}
        onClose={handleCloseCheckoutAddressModal}
        onConfirm={handleCheckoutConflictConfirm}
        onRetry={startCheckoutAddressImport}
      />

      {outboundEmailEnabled && isSendOrderConfirmationModalOpen && (
        <SendOrderConfirmationModal
          isOpen={isSendOrderConfirmationModalOpen}
          onClose={() => setSendOrderConfirmationModalOpen(false)}
          onSendSuccess={() => {
            revalidator.revalidate();
          }}
          order={{
            id: order.id,
            orderNumber: order.orderNumber,
            updatedAt: order.updatedAt,
          }}
          customer={customer}
          attachments={orderEmailModalAttachments}
          defaultSubject={
            orderConfirmationEmailDefaultSubject ?? undefined
          }
          editableSlots={orderConfirmationEditableSlots}
          requiredAttachmentDocumentKinds={
            orderConfirmationRequiredAttachmentDocumentKinds
          }
          onRequestGenerateForDocumentKind={(kind) => {
            if (kind === "invoice") {
              setInvoiceModalSource("confirmation_invoice");
              setIsInvoiceModalOpen(true);
              return;
            }
            if (kind === "order_confirmation") {
              setInvoiceModalSource("confirmation_order_confirmation");
              setIsInvoiceModalOpen(true);
              return;
            }
            if (kind === "purchase_order") {
              setIsPOModalOpen(true);
              return;
            }
            if (kind === "packing_slip") {
              setIsPackingSlipModalOpen(true);
            }
          }}
          invoiceGenerateDisabled={!order.customerId}
          orderConfirmationGenerateDisabled={!order.customerId}
          purchaseOrderGenerateDisabled={!order.vendorId}
          packingSlipGenerateDisabled={!order.customerId}
        />
      )}

      {jobBoardModalOpen && jobBoardOrderInput && (
        <JobBoardModal
          isOpen={jobBoardModalOpen}
          onClose={() => setJobBoardModalOpen(false)}
          orderNumber={order.orderNumber}
          orderInput={jobBoardOrderInput}
          partPreviews={jobBoardPartPreviews}
          attachments={(order.attachments ?? []).map((attachment: Attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName,
          }))}
          webhookConfigured={jobBoardWebhookConfigured}
          notifyRoleId={jobBoardNotifyRoleId}
          onOpenPartViewer={openJobBoardPartViewer}
        />
      )}

      {/* Assign Shop Modal */}
      {assignShopModalOpen && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Assign Shop to Order
              </h2>
              <button
                onClick={() => setAssignShopModalOpen(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="vendor-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Select Vendor (Shop)
                </label>
                <select
                  id="vendor-select"
                  value={selectedVendorId || ""}
                  onChange={(e) =>
                    setSelectedVendorId(
                      e.target.value ? parseInt(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">-- Select a vendor --</option>
                  {vendors.map((v: Vendor) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  Assigning a shop will move the order to &quot;In
                  Production&quot; status.
                </p>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <Button
                  variant="secondary"
                  onClick={() => setAssignShopModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleAssignShopSubmit}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Assign Shop
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage Vendor Modal */}
      {manageVendorModalOpen && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Manage Vendor
              </h2>
              <button
                onClick={() => setManageVendorModalOpen(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="vendor-manage-select"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Select Vendor
                </label>
                <select
                  id="vendor-manage-select"
                  value={selectedVendorId || ""}
                  onChange={(e) =>
                    setSelectedVendorId(
                      e.target.value ? parseInt(e.target.value) : null
                    )
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="">-- No vendor --</option>
                  {vendors.map((v: Vendor) => (
                    <option key={v.id} value={v.id}>
                      {v.displayName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 justify-between mt-6">
                <div className="flex gap-3">
                  {order.vendorId && (
                    <Button
                      variant="secondary"
                      onClick={handleRemoveVendor}
                      className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30"
                    >
                      Remove Vendor
                    </Button>
                  )}
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setManageVendorModalOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    onClick={handleManageVendorSubmit}
                    className="bg-blue-600 hover:bg-blue-700"
                  >
                    Update Vendor
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Order Modal */}
      {editOrderModalOpen && (
        <div className="fixed inset-0 bg-black/60 dark:bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white">
                Edit Order Information
              </h2>
              <button
                onClick={() => setEditOrderModalOpen(false)}
                className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="po-number-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  PO Number
                </label>
                <input
                  id="po-number-input"
                  type="text"
                  value={editOrderForm.poNumber}
                  onChange={(e) =>
                    setEditOrderForm({
                      ...editOrderForm,
                      poNumber: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="Customer PO number (optional)"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Delivery Date
                </label>
                <BusinessDayCalendar
                  mode="single"
                  value={
                    editOrderForm.deliveryDate
                      ? parseAppCalendarDateString(editOrderForm.deliveryDate)
                      : null
                  }
                  onChange={(date) => {
                    const cal = toAppCalendarDate(date);
                    const iso = toAppCalendarDateIsoString(cal);
                    const lead = businessDaysFrom(orderPlacedAnchor, cal);
                    setEditOrderForm({
                      ...editOrderForm,
                      deliveryDate: iso,
                      leadTime: String(lead),
                    });
                  }}
                />
              </div>

              <div>
                <label
                  htmlFor="lead-time-input"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  Lead Time (Business Days)
                </label>
                <input
                  id="lead-time-input"
                  type="number"
                  value={editOrderForm.leadTime}
                  onChange={(e) => {
                    const input = e.target.value;
                    if (input === "") {
                      setEditOrderForm({
                        ...editOrderForm,
                        leadTime: "",
                        deliveryDate: "",
                      });
                      return;
                    }

                    const leadTimeDays = parseInt(input);
                    if (isNaN(leadTimeDays) || leadTimeDays < 0) return;

                    const newDate = addBusinessDays(orderPlacedAnchor, leadTimeDays);
                    const deliveryDateString = toAppCalendarDateIsoString(newDate);

                    setEditOrderForm({
                      ...editOrderForm,
                      leadTime: input,
                      deliveryDate: deliveryDateString,
                    });
                  }}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  placeholder="e.g., 10"
                  min="0"
                />
              </div>

              <div className="space-y-4">
                <div className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Vendor Pay
                </div>

                {/* Dual synchronized inputs */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Percentage Input */}
                  <div>
                    <label
                      htmlFor="vendor-pay-percent"
                      className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                    >
                      Percentage
                    </label>
                    <div className="relative">
                      <input
                        id="vendor-pay-percent"
                        type="number"
                        value={editOrderForm.vendorPayPercent}
                        onChange={(e) => {
                          const input = e.target.value;
                          // Allow empty input
                          if (input === "") {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayPercent: "",
                              vendorPayDollar: "",
                            });
                            return;
                          }

                          // Validate and clamp percentage between 0-100
                          let percentage = parseFloat(input);
                          if (isNaN(percentage)) return; // Don't update if invalid
                          percentage = Math.max(0, Math.min(100, percentage));

                          const total = Math.max(
                            0,
                            parseFloat(order.totalPrice || "0")
                          );
                          const dollarAmount = (
                            (percentage / 100) *
                            total
                          ).toFixed(2);

                          setEditOrderForm({
                            ...editOrderForm,
                            vendorPayPercent: input,
                            vendorPayDollar: dollarAmount,
                          });
                        }}
                        onBlur={(e) => {
                          // Clean up display on blur
                          const percentage = parseFloat(e.target.value);
                          if (!isNaN(percentage)) {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayPercent: Math.max(
                                0,
                                Math.min(100, percentage)
                              ).toFixed(1),
                            });
                          }
                        }}
                        className="w-full pl-3 pr-8 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="70"
                        min="0"
                        max="100"
                        step="0.1"
                      />
                      <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none">
                        %
                      </span>
                    </div>
                  </div>

                  {/* Dollar Input */}
                  <div>
                    <label
                      htmlFor="vendor-pay-dollar"
                      className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1"
                    >
                      Dollar Amount
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 dark:text-gray-400 pointer-events-none">
                        $
                      </span>
                      <input
                        id="vendor-pay-dollar"
                        type="number"
                        value={editOrderForm.vendorPayDollar}
                        onChange={(e) => {
                          const input = e.target.value;
                          // Allow empty input
                          if (input === "") {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayDollar: "",
                              vendorPayPercent: "",
                            });
                            return;
                          }

                          // Validate input
                          let dollarAmount = parseFloat(input);
                          if (isNaN(dollarAmount)) return; // Don't update if invalid
                          dollarAmount = Math.max(0, dollarAmount);

                          const total = Math.max(
                            0,
                            parseFloat(order.totalPrice || "0")
                          );
                          const percentage =
                            total > 0
                              ? Math.min(
                                  100,
                                  (dollarAmount / total) * 100
                                ).toFixed(1)
                              : "0";

                          setEditOrderForm({
                            ...editOrderForm,
                            vendorPayDollar: input,
                            vendorPayPercent: percentage,
                          });
                        }}
                        onBlur={(e) => {
                          // Clean up display on blur
                          const dollarAmount = parseFloat(e.target.value);
                          if (!isNaN(dollarAmount)) {
                            setEditOrderForm({
                              ...editOrderForm,
                              vendorPayDollar: Math.max(
                                0,
                                dollarAmount
                              ).toFixed(2),
                            });
                          }
                        }}
                        className="w-full pl-8 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        placeholder="500.00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                </div>

                {/* Summary info */}
                <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md text-sm space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">
                      Order Total:
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      ${parseFloat(order.totalPrice || "0").toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600 dark:text-gray-400">
                      Vendor Pay:
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {(() => {
                        const dollarVal = parseFloat(
                          editOrderForm.vendorPayDollar || "0"
                        );
                        const percentVal = parseFloat(
                          editOrderForm.vendorPayPercent || "0"
                        );
                        return `$${dollarVal.toFixed(2)} (${percentVal.toFixed(
                          1
                        )}%)`;
                      })()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-gray-700">
                    <span className="text-gray-600 dark:text-gray-400">
                      Profit Margin:
                    </span>
                    <span className="font-semibold text-green-600 dark:text-green-400">
                      {(() => {
                        const orderTotal = parseFloat(order.totalPrice || "0");
                        const vendorPay = parseFloat(
                          editOrderForm.vendorPayDollar || "0"
                        );
                        const profit = Math.max(0, orderTotal - vendorPay);
                        const profitPercent =
                          orderTotal > 0 ? (profit / orderTotal) * 100 : 0;
                        return `$${profit.toFixed(2)} (${profitPercent.toFixed(
                          1
                        )}%)`;
                      })()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end mt-6">
                <Button
                  variant="secondary"
                  onClick={() => setEditOrderModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleEditOrderSubmit}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  Save Changes
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
