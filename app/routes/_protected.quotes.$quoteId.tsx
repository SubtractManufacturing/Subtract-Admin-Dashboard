import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { useState, useRef, useCallback, useEffect } from "react";
import { getQuote, updateQuote, archiveQuote, convertQuoteToOrder } from "~/lib/quotes";
import type { QuoteEventContext } from "~/lib/quotes";
import { getCustomer } from "~/lib/customers";
import { getVendor } from "~/lib/vendors";
import { getAttachment, createAttachment, deleteAttachment, type AttachmentEventContext } from "~/lib/attachments";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { shouldShowEventsInNav, shouldShowQuotesInNav, canUserManageQuotes } from "~/lib/featureFlags";
import { uploadFile, generateFileKey, deleteFile, getDownloadUrl } from "~/lib/s3.server";
import { getNotes, createNote, updateNote, archiveNote, type NoteEventContext } from "~/lib/notes";
import { getEventsByEntity } from "~/lib/events";
import { db } from "~/lib/db";
import { quoteAttachments, attachments } from "~/lib/db/schema";
import { eq } from "drizzle-orm";

import Navbar from "~/components/Navbar";
import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { Notes } from "~/components/shared/Notes";
import { EventTimeline } from "~/components/EventTimeline";
import { QuotePartsModal } from "~/components/quotes/QuotePartsModal";
import { tableStyles } from "~/utils/tw-styles";
import { isViewableFile, getFileType, formatFileSize } from "~/lib/file-utils";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();

  const quoteId = params.quoteId;
  if (!quoteId) {
    throw new Response("Quote ID is required", { status: 400 });
  }

  const canManageQuotes = await canUserManageQuotes();
  if (!canManageQuotes) {
    throw new Response("Not authorized to view quotes", { status: 403 });
  }

  const quote = await getQuote(parseInt(quoteId));
  if (!quote) {
    throw new Response("Quote not found", { status: 404 });
  }

  // Fetch customer and vendor details
  const customer = quote.customerId ? await getCustomer(quote.customerId) : null;
  const vendor = quote.vendorId ? await getVendor(quote.vendorId) : null;

  // Generate signed URLs for quote parts with meshes
  const partsWithSignedUrls = await Promise.all(
    (quote.parts || []).map(async (part) => {
      if (part.partMeshUrl && part.conversionStatus === 'completed') {
        const { getQuotePartMeshUrl } = await import("~/lib/quote-part-mesh-converter.server");
        const result = await getQuotePartMeshUrl(part.id);
        if ('url' in result) {
          return { ...part, signedMeshUrl: result.url };
        }
      }
      return part;
    })
  );

  // Update quote with signed URLs
  const quoteWithSignedUrls = { ...quote, parts: partsWithSignedUrls };

  // Fetch notes for this quote
  const notes = await getNotes("quote", quote.id.toString());

  // Fetch attachments for this quote
  const quoteAttachmentRecords = await db
    .select({
      attachment: attachments
    })
    .from(quoteAttachments)
    .leftJoin(attachments, eq(quoteAttachments.attachmentId, attachments.id))
    .where(eq(quoteAttachments.quoteId, quote.id));

  const attachmentList = quoteAttachmentRecords
    .map(record => record.attachment)
    .filter((attachment): attachment is NonNullable<typeof attachment> => attachment !== null);

  // Generate download URLs for attachments
  const attachmentsWithUrls = await Promise.all(
    attachmentList.map(async (attachment) => ({
      ...attachment,
      downloadUrl: await getDownloadUrl(attachment.s3Key)
    }))
  );

  // Get feature flags and events
  const [showEventsLink, showQuotesLink, events] = await Promise.all([
    shouldShowEventsInNav(),
    shouldShowQuotesInNav(),
    getEventsByEntity("quote", quote.id.toString(), 10),
  ]);

  return withAuthHeaders(
    json({
      quote: quoteWithSignedUrls,
      customer,
      vendor,
      notes,
      attachments: attachmentsWithUrls,
      user,
      userDetails,
      appConfig,
      showEventsLink,
      showQuotesLink,
      events
    }),
    headers
  );
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  const quoteId = params.quoteId;
  if (!quoteId) {
    return json({ error: "Quote ID is required" }, { status: 400 });
  }

  const canManageQuotes = await canUserManageQuotes();
  if (!canManageQuotes) {
    return json({ error: "Not authorized to manage quotes" }, { status: 403 });
  }

  const quote = await getQuote(parseInt(quoteId));
  if (!quote) {
    return json({ error: "Quote not found" }, { status: 404 });
  }

  // Handle file uploads separately
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const uploadHandler = unstable_createMemoryUploadHandler({
      maxPartSize: MAX_FILE_SIZE,
    });

    const formData = await unstable_parseMultipartFormData(request, uploadHandler);
    const file = formData.get("file") as File;

    if (!file) {
      return json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return json({ error: "File size exceeds 50MB limit" }, { status: 400 });
    }

    try {
      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Generate S3 key
      const key = generateFileKey(quote.id, file.name);

      // Upload to S3
      const uploadResult = await uploadFile({
        key,
        buffer,
        contentType: file.type || 'application/octet-stream',
        fileName: file.name,
      });

      // Create event context for attachment operations
      const eventContext: AttachmentEventContext = {
        userId: user?.id,
        userEmail: user?.email || userDetails?.name || undefined,
      };

      // Create attachment record
      const attachment = await createAttachment({
        s3Bucket: uploadResult.bucket,
        s3Key: uploadResult.key,
        fileName: uploadResult.fileName,
        contentType: uploadResult.contentType,
        fileSize: uploadResult.size,
      }, eventContext);

      // Link to quote
      await db.insert(quoteAttachments).values({
        quoteId: quote.id,
        attachmentId: attachment.id,
      });

      // Return a redirect to refresh the page
      return redirect(`/quotes/${quoteId}`);
    } catch (error) {
      console.error('Upload error:', error);
      return json({ error: "Failed to upload file" }, { status: 500 });
    }
  }

  // Handle other form submissions
  const formData = await request.formData();
  const intent = formData.get("intent");

  const eventContext: QuoteEventContext = {
    userId: user?.id,
    userEmail: user?.email || userDetails?.name || undefined,
  };

  try {
    switch (intent) {
      case "updateStatus": {
        const status = formData.get("status") as "RFQ" | "Draft" | "Sent" | "Accepted" | "Rejected" | "Dropped" | "Expired";
        const rejectionReason = formData.get("rejectionReason") as string;

        await updateQuote(quote.id, {
          status,
          rejectionReason: status === "Rejected" ? rejectionReason : null
        }, eventContext);

        return redirect(`/quotes/${quoteId}`);
      }

      case "updateQuote": {
        const expirationDays = formData.get("expirationDays");
        const notes = formData.get("notes");

        const updates: { expirationDays?: number; notes?: string | null } = {};
        if (expirationDays !== null) {
          updates.expirationDays = parseInt(expirationDays as string);
        }
        if (notes !== null) {
          updates.notes = notes as string || null;
        }

        await updateQuote(quote.id, updates, eventContext);
        return json({ success: true });
      }

      case "updateValidUntil": {
        const validUntil = formData.get("validUntil") as string;

        if (!validUntil) {
          return json({ error: "Valid until date is required" }, { status: 400 });
        }

        await updateQuote(quote.id, { validUntil: new Date(validUntil) }, eventContext);
        return json({ success: true });
      }

      case "convertToOrder": {
        const result = await convertQuoteToOrder(quote.id, eventContext);
        if (result.success && result.orderNumber) {
          return redirect(`/orders/${result.orderNumber}`);
        }
        return json({ error: result.error || "Failed to convert quote" }, { status: 400 });
      }

      case "updateLineItem": {
        const lineItemId = formData.get("lineItemId") as string;

        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        const { updateQuoteLineItem } = await import("~/lib/line-items");

        const updateData: { quantity?: number; unitPrice?: string; totalPrice?: string } = {};

        // Get all possible updated fields
        const quantity = formData.get("quantity") as string | null;
        const unitPrice = formData.get("unitPrice") as string | null;
        const totalPrice = formData.get("totalPrice") as string | null;

        // Only add fields that were provided
        if (quantity !== null) {
          updateData.quantity = parseInt(quantity);
        }
        if (unitPrice !== null) {
          updateData.unitPrice = unitPrice;
        }
        if (totalPrice !== null) {
          updateData.totalPrice = totalPrice;
        }

        await updateQuoteLineItem(parseInt(lineItemId), updateData);

        // Recalculate totals after updating line item
        const { calculateQuoteTotals } = await import("~/lib/quotes");
        const updatedTotals = await calculateQuoteTotals(quote.id);

        // Return JSON response for fetcher to handle without navigation
        return json({ success: true, totals: updatedTotals });
      }

      case "archiveQuote": {
        await archiveQuote(quote.id, eventContext);
        return redirect("/quotes");
      }


      case "getNotes": {
        const notes = await getNotes("quote", quote.id.toString());
        return withAuthHeaders(json({ notes }), headers);
      }

      case "createNote": {
        const content = formData.get("content") as string;
        const createdBy = formData.get("createdBy") as string;

        if (!content || !createdBy) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const noteEventContext: NoteEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const note = await createNote({
          entityType: "quote",
          entityId: quote.id.toString(),
          content,
          createdBy,
        }, noteEventContext);

        return withAuthHeaders(json({ note }), headers);
      }

      case "updateNote": {
        const noteId = formData.get("noteId") as string;
        const content = formData.get("content") as string;

        if (!noteId || !content) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const noteEventContext: NoteEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const note = await updateNote(noteId, content, noteEventContext);
        return withAuthHeaders(json({ note }), headers);
      }

      case "deleteNote": {
        const noteId = formData.get("noteId") as string;

        if (!noteId) {
          return json({ error: "Missing note ID" }, { status: 400 });
        }

        const noteEventContext: NoteEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await archiveNote(noteId, noteEventContext);
        return withAuthHeaders(json({ success: true }), headers);
      }

      case "deleteAttachment": {
        const attachmentId = formData.get("attachmentId") as string;

        if (!attachmentId) {
          return json({ error: "Missing attachment ID" }, { status: 400 });
        }

        // Unlink from quote
        await db
          .delete(quoteAttachments)
          .where(eq(quoteAttachments.attachmentId, attachmentId));

        // Get attachment to delete S3 file
        const attachment = await getAttachment(attachmentId);
        if (attachment) {
          await deleteFile(attachment.s3Key);

          const eventContext: AttachmentEventContext = {
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          };

          await deleteAttachment(attachmentId, eventContext);
        }

        return redirect(`/quotes/${quoteId}`);
      }

      default:
        return json({ error: "Invalid action" }, { status: 400 });
    }
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: "An error occurred" }, { status: 500 });
  }
}

export default function QuoteDetail() {
  const { quote, customer, vendor, notes, attachments, user, userDetails, appConfig, showEventsLink, showQuotesLink, events } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [selectedFile, setSelectedFile] = useState<{ url: string; type: string; fileName: string; contentType?: string; fileSize?: number } | null>(null);
  const [isFileViewerOpen, setIsFileViewerOpen] = useState(false);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  const [isPartsModalOpen, setIsPartsModalOpen] = useState(false);
  // Define the line item type
  type LineItem = {
    id: number;
    quotePartId: string | null;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    leadTimeDays: number | null;
    notes: string | null;
  };

  const [editingLineItem, setEditingLineItem] = useState<{ id: number; field: 'quantity' | 'unitPrice' | 'totalPrice'; value: string } | null>(null);
  const [optimisticLineItems, setOptimisticLineItems] = useState<LineItem[] | undefined>(quote.lineItems as LineItem[] | undefined);
  const [optimisticTotal, setOptimisticTotal] = useState(quote.total || "0.00");
  const [editingExpirationDays, setEditingExpirationDays] = useState(false);
  const [expirationDaysValue, setExpirationDaysValue] = useState((quote.expirationDays || 14).toString());
  const [editingValidUntil, setEditingValidUntil] = useState(false);
  const [validUntilValue, setValidUntilValue] = useState(quote.validUntil ? new Date(quote.validUntil).toISOString().split('T')[0] : '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const lineItemFetcher = useFetcher();

  // Check if quote is in a locked state (sent or beyond)
  const isQuoteLocked = ['Sent', 'Accepted', 'Rejected', 'Expired'].includes(quote.status);

  // Check if any parts are currently converting
  const hasConvertingParts = quote.parts?.some((part: { conversionStatus: string | null }) =>
    part.conversionStatus === 'in_progress' ||
    part.conversionStatus === 'queued' ||
    part.conversionStatus === 'pending'
  );

  // Set up polling for parts conversion status
  useEffect(() => {
    if (hasConvertingParts && !pollInterval) {
      const interval = setInterval(() => {
        // Revalidate the page data to get updated conversion status
        revalidator.revalidate();
      }, 5000); // Poll every 5 seconds
      setPollInterval(interval);
    } else if (!hasConvertingParts && pollInterval) {
      clearInterval(pollInterval);
      setPollInterval(null);
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [hasConvertingParts, pollInterval, revalidator]);

  // Update optimistic line items when the actual data changes
  useEffect(() => {
    setOptimisticLineItems(quote.lineItems as LineItem[] | undefined);
    setOptimisticTotal(quote.total || "0.00");
  }, [quote.lineItems, quote.total]);

  // Calculate optimistic total whenever line items change
  useEffect(() => {
    if (optimisticLineItems && optimisticLineItems.length > 0) {
      const total = optimisticLineItems.reduce((sum: number, item: LineItem) => {
        const itemTotal = parseFloat(item.totalPrice) || 0;
        return sum + itemTotal;
      }, 0);
      setOptimisticTotal(total.toFixed(2));
    }
  }, [optimisticLineItems]);

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  }, [fetcher]);

  const handleViewFile = (attachment: { downloadUrl: string; fileName: string; id: string; contentType?: string; fileSize?: number }) => {
    if (isViewableFile(attachment.fileName)) {
      setSelectedFile({
        url: attachment.downloadUrl,
        type: getFileType(attachment.fileName).type,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        fileSize: attachment.fileSize,
      });
      setIsFileViewerOpen(true);
    } else {
      // Download non-viewable files
      window.open(attachment.downloadUrl, '_blank');
    }
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    if (confirm("Are you sure you want to delete this attachment?")) {
      fetcher.submit(
        { intent: "deleteAttachment", attachmentId },
        { method: "post" }
      );
    }
  };


  const handleConvertToOrder = () => {
    if (confirm("Are you sure you want to convert this quote to an order? This action cannot be undone.")) {
      fetcher.submit(
        { intent: "convertToOrder" },
        { method: "post" }
      );
    }
  };

  const handleAddLineItem = () => {
    // This would need to be implemented with quote-specific line item management
    // For now, this is a placeholder that shows the intent
    alert("Add line item functionality coming soon. You can manage line items through the quote edit form.");
  };

  const startEditingLineItem = (itemId: number, field: 'quantity' | 'unitPrice' | 'totalPrice', currentValue: string | number) => {
    const value = field === 'quantity' ? currentValue.toString() : currentValue.toString().replace(/[^0-9.]/g, '');
    setEditingLineItem({ id: itemId, field, value });
    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.focus();
        editInputRef.current.select();
      }
    }, 0);
  };

  const cancelEditingLineItem = () => {
    setEditingLineItem(null);
  };

  const saveLineItemEdit = () => {
    if (!editingLineItem) return;

    // Find the current item
    const currentItem = optimisticLineItems?.find(item => item.id === editingLineItem.id);
    if (!currentItem) return;

    // Validate and calculate related values
    const updatedItem: Partial<LineItem> = {};

    if (editingLineItem.field === 'quantity') {
      const qty = parseInt(editingLineItem.value);
      if (isNaN(qty) || qty <= 0) {
        alert('Please enter a valid quantity');
        return;
      }

      // Update quantity and recalculate total based on unit price
      updatedItem.quantity = qty;
      const unitPrice = parseFloat(currentItem.unitPrice);
      if (!isNaN(unitPrice)) {
        updatedItem.totalPrice = (qty * unitPrice).toFixed(2);
      }
    } else if (editingLineItem.field === 'unitPrice') {
      const unitPrice = parseFloat(editingLineItem.value);
      if (isNaN(unitPrice) || unitPrice < 0) {
        alert('Please enter a valid price');
        return;
      }

      // Update unit price and recalculate total based on quantity
      updatedItem.unitPrice = unitPrice.toFixed(2);
      updatedItem.totalPrice = (currentItem.quantity * unitPrice).toFixed(2);
    } else if (editingLineItem.field === 'totalPrice') {
      const totalPrice = parseFloat(editingLineItem.value);
      if (isNaN(totalPrice) || totalPrice < 0) {
        alert('Please enter a valid price');
        return;
      }

      // Update total price and recalculate unit price based on quantity
      updatedItem.totalPrice = totalPrice.toFixed(2);
      if (currentItem.quantity > 0) {
        updatedItem.unitPrice = (totalPrice / currentItem.quantity).toFixed(2);
      }
    }

    // Optimistically update the line items with all calculated values
    setOptimisticLineItems((prevItems) =>
      prevItems?.map((item) =>
        item.id === editingLineItem.id
          ? { ...item, ...updatedItem }
          : item
      )
    );

    // Submit all updated values to the backend
    const formData = new FormData();
    formData.append('intent', 'updateLineItem');
    formData.append('lineItemId', editingLineItem.id.toString());

    // Send all updated fields to the backend
    if (updatedItem.quantity !== undefined) {
      formData.append('quantity', updatedItem.quantity.toString());
    }
    if (updatedItem.unitPrice !== undefined) {
      formData.append('unitPrice', updatedItem.unitPrice);
    }
    if (updatedItem.totalPrice !== undefined) {
      formData.append('totalPrice', updatedItem.totalPrice);
    }

    lineItemFetcher.submit(formData, { method: 'post' });
    setEditingLineItem(null);
  };

  const handleLineItemKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveLineItemEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditingLineItem();
    }
  };



  // Format currency
  const formatCurrency = (amount: string | null) => {
    if (!amount) return '$0.00';
    return `$${parseFloat(amount).toFixed(2)}`;
  };

  // Format date
  const formatDate = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  };

  // Calculate days until expiry
  const validUntil = quote.validUntil ? new Date(quote.validUntil) : null;
  const today = new Date();
  const daysUntilExpiry = validUntil ? Math.ceil((validUntil.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;


  // Get status color classes
  const getStatusClasses = (status: string) => {
    switch (status.toLowerCase()) {
      case 'rfq':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
      case 'draft':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
      case 'sent':
        return 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300';
      case 'accepted':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
      case 'rejected':
        return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
      case 'dropped':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
      case 'expired':
        return 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    }
  };


  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
        version={appConfig.version}
        isStaging={appConfig.isStaging}
        showEventsLink={showEventsLink}
        showQuotesLink={showQuotesLink}
      />

      <div className="max-w-[1920px] mx-auto">
        {/* Custom breadcrumb bar with buttons */}
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/" },
            { label: "Quotes", href: "/quotes" },
            { label: quote.quoteNumber }
          ]} />
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => {}} variant="secondary">
              Actions (Coming Soon)
            </Button>
            {(quote.status === "Sent" || quote.status === "Accepted") && !quote.convertedToOrderId && (
              <Button onClick={handleConvertToOrder} variant="primary">
                Convert to Order
              </Button>
            )}
          </div>
        </div>

        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">

          {/* Notice Bar */}
          {daysUntilExpiry && daysUntilExpiry > 0 && daysUntilExpiry <= 7 && quote.status === "Sent" && (
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
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Quote Status</h3>
              {isQuoteLocked ? (
                <div className={`px-4 py-3 rounded-full text-center font-semibold ${getStatusClasses(quote.status)}`}>
                  {quote.status.charAt(0).toUpperCase() + quote.status.slice(1)}
                </div>
              ) : (
                <select
                  value={quote.status}
                  onChange={(e) => {
                    const newStatus = e.target.value as "RFQ" | "Draft" | "Sent" | "Accepted" | "Rejected" | "Dropped" | "Expired";
                    fetcher.submit(
                      { intent: "updateStatus", status: newStatus, rejectionReason: "" },
                      { method: "post" }
                    );
                  }}
                  className={`w-full px-4 py-3 rounded-full text-center font-semibold cursor-pointer border-none outline-none focus:ring-2 focus:ring-blue-500 ${getStatusClasses(quote.status)}`}
                >
                  <option value="RFQ">RFQ</option>
                  <option value="Draft">Draft</option>
                  <option value="Sent">Sent</option>
                  <option value="Accepted">Accepted</option>
                  <option value="Rejected">Rejected</option>
                  <option value="Dropped">Dropped</option>
                  <option value="Expired">Expired</option>
                </select>
              )}
            </div>

            {/* Valid Until Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Valid Until</h3>
              <div className="relative">
                {editingValidUntil && isQuoteLocked ? (
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
                          { intent: "updateValidUntil", validUntil: validUntilValue },
                          { method: "post" }
                        );
                      }
                      setEditingValidUntil(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (validUntilValue) {
                          fetcher.submit(
                            { intent: "updateValidUntil", validUntil: validUntilValue },
                            { method: "post" }
                          );
                        }
                        setEditingValidUntil(false);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setValidUntilValue(quote.validUntil ? new Date(quote.validUntil).toISOString().split('T')[0] : '');
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
                        {daysUntilExpiry > 0 ? `${daysUntilExpiry} days remaining` : 'Expired'}
                      </p>
                    )}
                    {isQuoteLocked && (
                      <button
                        onClick={() => setEditingValidUntil(true)}
                        className="absolute -top-2 -right-2 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
                        aria-label="Edit expiration date"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zM4 8h12v8H4V8z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Quote Value Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Quote Value</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {formatCurrency(optimisticTotal)}
              </p>
            </div>

            {/* Customer Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Customer</h3>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {customer?.displayName || "N/A"}
              </p>
              {vendor && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  Vendor: {vendor.displayName}
                </p>
              )}
            </div>
          </div>

          {/* Quote Details Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Quote Details</h3>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Quote Number</p>
                <p className="text-base font-medium text-gray-900 dark:text-gray-100">{quote.quoteNumber}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Created Date</p>
                <p className="text-base font-medium text-gray-900 dark:text-gray-100">{formatDate(quote.createdAt)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Expiration Days</p>
                {!isQuoteLocked ? (
                  <div
                    className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 rounded px-2 py-1 -mx-2 transition-colors"
                    onClick={() => {
                      setEditingExpirationDays(true);
                      setTimeout(() => {
                        const input = document.getElementById('expiration-days-input');
                        if (input) {
                          (input as HTMLInputElement).focus();
                          (input as HTMLInputElement).select();
                        }
                      }, 0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setEditingExpirationDays(true);
                        setTimeout(() => {
                          const input = document.getElementById('expiration-days-input');
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
                        onChange={(e) => setExpirationDaysValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const days = parseInt(expirationDaysValue);
                            if (!isNaN(days) && days > 0) {
                              fetcher.submit(
                                { intent: "updateQuote", expirationDays: expirationDaysValue },
                                { method: "post" }
                              );
                              setEditingExpirationDays(false);
                            }
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setExpirationDaysValue((quote.expirationDays || 14).toString());
                            setEditingExpirationDays(false);
                          }
                        }}
                        onBlur={() => {
                          const days = parseInt(expirationDaysValue);
                          if (!isNaN(days) && days > 0 && days !== (quote.expirationDays || 14)) {
                            fetcher.submit(
                              { intent: "updateQuote", expirationDays: expirationDaysValue },
                              { method: "post" }
                            );
                          } else {
                            setExpirationDaysValue((quote.expirationDays || 14).toString());
                          }
                          setEditingExpirationDays(false);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        min="1"
                      />
                      <span className="text-base font-medium text-gray-900 dark:text-gray-100">days</span>
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
              {quote.sentAt && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Sent Date</p>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">{formatDate(quote.sentAt)}</p>
                </div>
              )}
              {quote.convertedToOrderId && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Converted to Order</p>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">Order #{quote.convertedToOrderId}</p>
                </div>
              )}
              {quote.rejectionReason && (
                <div className="md:col-span-2">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Rejection Reason</p>
                  <p className="text-base font-medium text-gray-900 dark:text-gray-100">{quote.rejectionReason}</p>
                </div>
              )}
              </div>

              {quote.notes && (
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Notes</p>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{quote.notes}</p>
              </div>
            )}

            {quote.termsAndConditions && (
              <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Terms and Conditions</p>
                <p className="text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{quote.termsAndConditions}</p>
              </div>
            )}
            </div>
          </div>

          {/* Line Items Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Line Items</h3>
              <div className="flex gap-2">
                {quote.parts && quote.parts.length > 0 && (
                  <Button size="sm" variant="secondary" onClick={() => setIsPartsModalOpen(true)}>
                    View Parts ({quote.parts.length})
                  </Button>
                )}
                <Button size="sm" onClick={handleAddLineItem}>Add Line Item</Button>
              </div>
            </div>
            <div className="p-6">

          {optimisticLineItems && optimisticLineItems.length > 0 ? (
            <table className={tableStyles.container}>
              <thead className={tableStyles.header}>
                <tr>
                  <th className={tableStyles.headerCell}>Part</th>
                  <th className={tableStyles.headerCell}>Notes</th>
                  <th className={tableStyles.headerCell}>Quantity</th>
                  <th className={tableStyles.headerCell}>Unit Price</th>
                  <th className={tableStyles.headerCell}>Total Price</th>
                </tr>
              </thead>
              <tbody>
                {optimisticLineItems.map((item) => (
                  <tr key={item.id} className={tableStyles.row}>
                    <td className={tableStyles.cell}>
                      {quote.parts?.find((p: { id: string; partName: string }) => p.id === item.quotePartId)?.partName || "N/A"}
                    </td>
                    <td className={tableStyles.cell}>{item.notes || "—"}</td>
                    <td
                      className={`${tableStyles.cell} ${!isQuoteLocked ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors' : ''}`}
                      onClick={() => !isQuoteLocked && startEditingLineItem(item.id, 'quantity', item.quantity)}
                    >
                      {editingLineItem?.id === item.id && editingLineItem?.field === 'quantity' ? (
                        <input
                          ref={editInputRef}
                          type="number"
                          className="w-20 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                          value={editingLineItem.value}
                          onChange={(e) => setEditingLineItem({ ...editingLineItem, value: e.target.value })}
                          onKeyDown={handleLineItemKeyDown}
                          onBlur={cancelEditingLineItem}
                          onClick={(e) => e.stopPropagation()}
                          min="1"
                        />
                      ) : (
                        item.quantity
                      )}
                    </td>
                    <td
                      className={`${tableStyles.cell} ${!isQuoteLocked ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors' : ''}`}
                      onClick={() => !isQuoteLocked && startEditingLineItem(item.id, 'unitPrice', item.unitPrice)}
                    >
                      {editingLineItem?.id === item.id && editingLineItem?.field === 'unitPrice' ? (
                        <div className="flex items-center">
                          <span className="mr-1">$</span>
                          <input
                            ref={editInputRef}
                            type="text"
                            className="w-24 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                            value={editingLineItem.value}
                            onChange={(e) => setEditingLineItem({ ...editingLineItem, value: e.target.value })}
                            onKeyDown={handleLineItemKeyDown}
                            onBlur={cancelEditingLineItem}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        `$${item.unitPrice}`
                      )}
                    </td>
                    <td
                      className={`${tableStyles.cell} ${!isQuoteLocked ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors' : ''}`}
                      onClick={() => !isQuoteLocked && startEditingLineItem(item.id, 'totalPrice', item.totalPrice)}
                    >
                      {editingLineItem?.id === item.id && editingLineItem?.field === 'totalPrice' ? (
                        <div className="flex items-center">
                          <span className="mr-1">$</span>
                          <input
                            ref={editInputRef}
                            type="text"
                            className="w-24 px-2 py-1 border border-blue-500 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-white"
                            value={editingLineItem.value}
                            onChange={(e) => setEditingLineItem({ ...editingLineItem, value: e.target.value })}
                            onKeyDown={handleLineItemKeyDown}
                            onBlur={cancelEditingLineItem}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </div>
                      ) : (
                        `$${item.totalPrice}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-right font-bold text-gray-700 dark:text-gray-300">
                    Total: ${optimisticTotal}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <p className="text-gray-500 dark:text-gray-400 text-center py-8">No line items added yet.</p>
          )}
            </div>
          </div>

          {/* Attachments Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Attachments</h3>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  size="sm"
                >
                  Upload File
                </Button>
              </div>
            </div>
            <div className="p-6">

            {attachments && attachments.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {attachments.map((attachment: { id: string; fileName: string; fileSize?: number; contentType?: string; downloadUrl?: string }) => (
                  <div
                    key={attachment.id}
                    className={`
                      relative p-4 rounded-lg border-2 border-gray-200 dark:border-gray-600 transition-all
                      ${isViewableFile(attachment.fileName)
                        ? 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer hover:scale-[1.02] hover:shadow-md focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none'
                        : 'bg-gray-50 dark:bg-gray-700'
                      }
                    `}
                    onClick={isViewableFile(attachment.fileName) && attachment.downloadUrl ? () => handleViewFile(attachment as { downloadUrl: string; fileName: string; id: string; contentType?: string; fileSize?: number }) : undefined}
                    onKeyDown={isViewableFile(attachment.fileName) && attachment.downloadUrl ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleViewFile(attachment as { downloadUrl: string; fileName: string; id: string; contentType?: string; fileSize?: number });
                      }
                    } : undefined}
                    role={isViewableFile(attachment.fileName) ? "button" : undefined}
                    tabIndex={isViewableFile(attachment.fileName) ? 0 : undefined}
                  >
                    <div className="flex-1 pointer-events-none">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{attachment.fileName}</p>
                        {isViewableFile(attachment.fileName) && (
                          <span className="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                            {getFileType(attachment.fileName).type.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {formatFileSize(attachment.fileSize || 0)}
                      </p>
                    </div>
                    <div
                      className="absolute top-4 right-4 flex gap-2 pointer-events-auto"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      role="presentation"
                    >
                      {!isViewableFile(attachment.fileName) && (
                        <Button
                          onClick={() => window.open(attachment.downloadUrl, '_blank')}
                          variant="secondary"
                          size="sm"
                        >
                          Download
                        </Button>
                      )}
                      <Button
                        onClick={() => handleDeleteAttachment(attachment.id)}
                        variant="danger"
                        size="sm"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500 dark:text-gray-400 text-center py-8">No attachments uploaded yet.</p>
            )}
            </div>
          </div>

          {/* Notes and Event Log Section - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Notes */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Quote Notes</h3>
                {!isAddingNote && (
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


      {/* File Viewer Modal */}
      {selectedFile && (
        <FileViewerModal
          isOpen={isFileViewerOpen}
          onClose={() => {
            setIsFileViewerOpen(false);
            setSelectedFile(null);
          }}
          fileUrl={selectedFile.url}
          fileName={selectedFile.fileName}
          contentType={selectedFile.contentType}
          fileSize={selectedFile.fileSize}
        />
      )}

      {/* Quote Parts Modal */}
      {quote.parts && quote.parts.length > 0 && (
        <QuotePartsModal
          isOpen={isPartsModalOpen}
          onClose={() => setIsPartsModalOpen(false)}
          parts={quote.parts}
        />
      )}
    </div>
  );
}