import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { getOrderByNumberWithAttachments } from "~/lib/orders";
import { getCustomer } from "~/lib/customers";
import { getVendor } from "~/lib/vendors";
import { getAttachment, createAttachment, deleteAttachment, linkAttachmentToOrder, unlinkAttachmentFromOrder, type Attachment } from "~/lib/attachments";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { uploadFile, generateFileKey, deleteFile, getDownloadUrl } from "~/lib/s3.server";
import Navbar from "~/components/Navbar";
import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { isViewableFile, getFileType, formatFileSize } from "~/lib/file-utils";
import { Notes } from "~/components/shared/Notes";
import { getNotes, createNote, updateNote, archiveNote } from "~/lib/notes";
import { getLineItemsByOrderId, createLineItem, updateLineItem, deleteLineItem } from "~/lib/lineItems";
import LineItemModal from "~/components/LineItemModal";
import type { OrderLineItem } from "~/lib/db/schema";
import { useState, useRef } from "react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  const orderNumber = params.orderId; // Note: param name stays the same but now represents orderNumber
  if (!orderNumber) {
    throw new Response("Order number is required", { status: 400 });
  }

  const order = await getOrderByNumberWithAttachments(orderNumber);
  if (!order) {
    throw new Response("Order not found", { status: 404 });
  }

  // Fetch customer and vendor details
  const customer = order.customerId ? await getCustomer(order.customerId) : null;
  const vendor = order.vendorId ? await getVendor(order.vendorId) : null;
  
  // Fetch notes for this order
  const notes = await getNotes("order", order.id.toString());
  
  // Fetch line items for this order
  const lineItems = await getLineItemsByOrderId(order.id);

  return withAuthHeaders(
    json({ order, customer, vendor, notes, lineItems, user, userDetails, appConfig }),
    headers
  );
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { headers } = await requireAuth(request);
  
  const orderNumber = params.orderId;
  if (!orderNumber) {
    return json({ error: "Order number is required" }, { status: 400 });
  }

  const order = await getOrderByNumberWithAttachments(orderNumber);
  if (!order) {
    return json({ error: "Order not found" }, { status: 404 });
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
      const key = generateFileKey(order.id, file.name);

      // Upload to S3
      const uploadResult = await uploadFile({
        key,
        buffer,
        contentType: file.type || 'application/octet-stream',
        fileName: file.name,
      });

      // Create attachment record
      const attachment = await createAttachment({
        s3Bucket: uploadResult.bucket,
        s3Key: uploadResult.key,
        fileName: uploadResult.fileName,
        contentType: uploadResult.contentType,
        fileSize: uploadResult.size,
      });

      // Link to order
      await linkAttachmentToOrder(order.id, attachment.id);

      // Return a redirect to refresh the page
      return redirect(`/orders/${orderNumber}`);
    } catch (error) {
      console.error('Upload error:', error);
      return json({ error: "Failed to upload file" }, { status: 500 });
    }
  }

  // Handle other form submissions
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    switch (intent) {
      case "getNotes": {
        const notes = await getNotes("order", order.id.toString());
        return withAuthHeaders(json({ notes }), headers);
      }

      case "createNote": {
        const content = formData.get("content") as string;
        const createdBy = formData.get("createdBy") as string;

        if (!content || !createdBy) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const note = await createNote({
          entityType: "order",
          entityId: order.id.toString(),
          content,
          createdBy,
        });

        return withAuthHeaders(json({ note }), headers);
      }

      case "updateNote": {
        const noteId = formData.get("noteId") as string;
        const content = formData.get("content") as string;

        if (!noteId || !content) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const note = await updateNote(noteId, content);
        return withAuthHeaders(json({ note }), headers);
      }

      case "deleteNote": {
        const noteId = formData.get("noteId") as string;

        if (!noteId) {
          return json({ error: "Missing note ID" }, { status: 400 });
        }

        const note = await archiveNote(noteId);
        return withAuthHeaders(json({ note }), headers);
      }

      case "deleteAttachment": {
        const attachmentId = formData.get("attachmentId") as string;

        if (!attachmentId) {
          return json({ error: "Missing attachment ID" }, { status: 400 });
        }

        // Get attachment details
        const attachment = await getAttachment(attachmentId);
        if (!attachment) {
          return json({ error: "Attachment not found" }, { status: 404 });
        }

        // Unlink from order first
        await unlinkAttachmentFromOrder(order.id, attachmentId);

        // Delete from S3
        await deleteFile(attachment.s3Key);

        // Delete database record
        await deleteAttachment(attachmentId);

        // Return a redirect to refresh the page
        return redirect(`/orders/${orderNumber}`);
      }

      case "downloadAttachment": {
        const attachmentId = formData.get("attachmentId") as string;

        if (!attachmentId) {
          return json({ error: "Missing attachment ID" }, { status: 400 });
        }

        const attachment = await getAttachment(attachmentId);
        if (!attachment) {
          return json({ error: "Attachment not found" }, { status: 404 });
        }

        // Generate a presigned URL for download
        const downloadUrl = await getDownloadUrl(attachment.s3Key);
        
        // Return the URL for client-side redirect
        return json({ downloadUrl });
      }

      case "createLineItem": {
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const quantity = parseInt(formData.get("quantity") as string);
        const unitPrice = formData.get("unitPrice") as string;

        if (!name || !quantity || !unitPrice) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const lineItem = await createLineItem({
          orderId: order.id,
          name,
          description,
          quantity,
          unitPrice,
          partId: null,
          notes: null,
        });

        return withAuthHeaders(json({ lineItem }), headers);
      }

      case "updateLineItem": {
        const lineItemId = parseInt(formData.get("lineItemId") as string);
        const name = formData.get("name") as string;
        const description = formData.get("description") as string;
        const quantity = parseInt(formData.get("quantity") as string);
        const unitPrice = formData.get("unitPrice") as string;

        if (!lineItemId || !name || !quantity || !unitPrice) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const lineItem = await updateLineItem(lineItemId, {
          name,
          description,
          quantity,
          unitPrice,
        });

        return withAuthHeaders(json({ lineItem }), headers);
      }

      case "deleteLineItem": {
        const lineItemId = parseInt(formData.get("lineItemId") as string);

        if (!lineItemId) {
          return json({ error: "Missing line item ID" }, { status: 400 });
        }

        await deleteLineItem(lineItemId);
        return withAuthHeaders(json({ success: true }), headers);
      }

      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    console.error("Notes action error:", error);
    return json({ error: "Failed to process request" }, { status: 500 });
  }
}

export default function OrderDetails() {
  const { order, customer, vendor, notes, lineItems, user, userDetails, appConfig } = useLoaderData<typeof loader>();
  const [showNotice, setShowNotice] = useState(true);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ url: string; fileName: string; contentType?: string; fileSize?: number } | null>(null);
  const [lineItemModalOpen, setLineItemModalOpen] = useState(false);
  const [selectedLineItem, setSelectedLineItem] = useState<OrderLineItem | null>(null);
  const [lineItemMode, setLineItemMode] = useState<"create" | "edit">("create");
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const lineItemFetcher = useFetcher();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);
      
      uploadFetcher.submit(formData, {
        method: "post",
        encType: "multipart/form-data",
      });
      
      // Reset the file input
      event.target.value = "";
    }
  };

  const handleDeleteAttachment = (attachmentId: string) => {
    if (confirm("Are you sure you want to delete this attachment?")) {
      const formData = new FormData();
      formData.append("intent", "deleteAttachment");
      formData.append("attachmentId", attachmentId);
      
      deleteFetcher.submit(formData, {
        method: "post",
      });
    }
  };



  const handleViewFile = (attachment: { id: string; fileName: string; contentType: string; fileSize: number | null }) => {
    const fileUrl = `/attachments/${attachment.id}/download`;
    setSelectedFile({ 
      url: fileUrl, 
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      fileSize: attachment.fileSize || undefined
    });
    setFileModalOpen(true);
  };

  const handleAddLineItem = () => {
    setSelectedLineItem(null);
    setLineItemMode("create");
    setLineItemModalOpen(true);
  };

  const handleEditLineItem = (lineItem: OrderLineItem) => {
    setSelectedLineItem(lineItem);
    setLineItemMode("edit");
    setLineItemModalOpen(true);
  };

  const handleDeleteLineItem = (lineItemId: number) => {
    if (confirm("Are you sure you want to delete this line item?")) {
      const formData = new FormData();
      formData.append("intent", "deleteLineItem");
      formData.append("lineItemId", lineItemId.toString());
      
      lineItemFetcher.submit(formData, {
        method: "post",
      });
    }
  };

  const handleLineItemSubmit = (data: {
    name: string;
    description: string;
    quantity: number;
    unitPrice: string;
  }) => {
    const formData = new FormData();
    formData.append("intent", lineItemMode === "create" ? "createLineItem" : "updateLineItem");
    formData.append("name", data.name);
    formData.append("description", data.description);
    formData.append("quantity", data.quantity.toString());
    formData.append("unitPrice", data.unitPrice);
    
    if (lineItemMode === "edit" && selectedLineItem) {
      formData.append("lineItemId", selectedLineItem.id.toString());
    }
    
    lineItemFetcher.submit(formData, {
      method: "post",
    });
  };


  // Calculate days until ship date
  const shipDate = order.shipDate ? new Date(order.shipDate) : null;
  const today = new Date();
  const daysUntilShip = shipDate ? Math.ceil((shipDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) : null;

  // Determine priority based on days until ship
  const getPriority = () => {
    if (!daysUntilShip) return "Normal";
    if (daysUntilShip <= 3) return "Critical";
    if (daysUntilShip <= 7) return "High";
    return "Normal";
  };

  const priority = getPriority();

  // Format currency
  const formatCurrency = (amount: string | null) => {
    if (!amount) return "$0.00";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(parseFloat(amount));
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

  // Calculate total price from line items
  const calculatedTotalPrice = lineItems.reduce((sum: number, item: OrderLineItem) => 
    sum + (item.quantity * parseFloat(item.unitPrice || "0")), 0
  ).toString();

  // Get status display
  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'In_Production':
        return 'In Production';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

  // Get status color classes
  const getStatusClasses = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
      case 'in_production':
        return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300';
      case 'completed':
        return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300';
      case 'cancelled':
        return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  // Get priority color classes
  const getPriorityClasses = (priority: string) => {
    switch (priority) {
      case 'Critical':
        return 'bg-red-200 text-red-900 dark:bg-red-800 dark:text-red-100';
      case 'High':
        return 'bg-orange-200 text-orange-900 dark:bg-orange-800 dark:text-orange-100';
      default:
        return 'bg-green-200 text-green-900 dark:bg-green-800 dark:text-green-100';
    }
  };

  // Mock progress (in real app, this would come from order data)
  const progress = 65;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
        version={appConfig.version}
        isStaging={appConfig.isStaging}
      />
      <div className="max-w-[1920px] mx-auto">
        {/* Custom breadcrumb bar with buttons */}
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/" },
            { label: "Orders", href: "/orders" },
            { label: order.orderNumber }
          ]} />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" className="bg-green-600 hover:bg-green-700">
              Update Status
            </Button>
            <Button variant="primary" className="bg-blue-600 hover:bg-blue-700">
              Edit Order
            </Button>
          </div>
        </div>
        
        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">

          {/* Notice Bar */}
          {showNotice && daysUntilShip && daysUntilShip <= 7 && (
            <div className="relative bg-yellow-100 dark:bg-yellow-900/50 border-2 border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
              <button
                onClick={() => setShowNotice(false)}
                className="absolute top-2 right-2 text-yellow-600 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-200"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
              <p className="font-semibold text-yellow-800 dark:text-yellow-200">
                Attention: This order is approaching its due date ({daysUntilShip} days remaining)
              </p>
            </div>
          )}

          {/* Status Cards - Always at top */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            {/* Order Status Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Order Status</h3>
              <div className={`px-4 py-3 rounded-full text-center font-semibold ${getStatusClasses(order.status)}`}>
                {getStatusDisplay(order.status)}
              </div>
            </div>

            {/* Priority Level Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Priority Level</h3>
              <div className={`px-4 py-3 rounded-full text-center font-semibold ${getPriorityClasses(priority)}`}>
                {priority} Priority
              </div>
            </div>

            {/* Order Value Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Order Value</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {formatCurrency(calculatedTotalPrice)}
              </p>
            </div>

            {/* Progress Card */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6 transform transition-all hover:scale-105">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Progress</h3>
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
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Order Information</h3>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Order Number</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{order.orderNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Order Date</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{formatDate(order.createdAt)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Ship Date</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{formatDate(order.shipDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Lead Time</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">
                      {order.leadTime ? `${order.leadTime} Business Days` : "--"}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Customer Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Customer Information</h3>
              </div>
              <div className="p-6">
                {customer ? (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Company</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.displayName}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Customer ID</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">CUST-{customer.id.toString().padStart(5, '0')}</p>
                    </div>
                    {customer.email && (
                      <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-4">
                        <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Primary Contact</p>
                        <p className="text-gray-900 dark:text-gray-100">{customer.email}</p>
                        {customer.phone && <p className="text-gray-900 dark:text-gray-100">{customer.phone}</p>}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-gray-500 dark:text-gray-400">No customer information available</p>
                )}
              </div>
            </div>
          </div>

          {/* Line Items Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Line Items</h3>
              <Button onClick={handleAddLineItem}>Add Line Item</Button>
            </div>
            <div className="p-6">
              {lineItems && lineItems.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Title
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Description
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Quantity
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Unit Price
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Total
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {lineItems.map((lineItem: OrderLineItem) => {
                        const total = lineItem.quantity * parseFloat(lineItem.unitPrice || "0");
                        return (
                          <tr key={lineItem.id}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {lineItem.name || "--"}
                            </td>
                            <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                              {lineItem.description || "--"}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {lineItem.quantity}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                              {formatCurrency(lineItem.unitPrice)}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                              {formatCurrency(total.toString())}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                              <button
                                onClick={() => handleEditLineItem(lineItem)}
                                className="text-indigo-600 hover:text-indigo-900 dark:text-indigo-400 dark:hover:text-indigo-300 mr-3"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => handleDeleteLineItem(lineItem.id)}
                                className="text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <td colSpan={4} className="px-6 py-3 text-right text-sm font-medium text-gray-900 dark:text-gray-100">
                          Subtotal:
                        </td>
                        <td className="px-6 py-3 whitespace-nowrap text-sm font-bold text-gray-900 dark:text-gray-100">
                          {formatCurrency(calculatedTotalPrice)}
                        </td>
                        <td></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No line items added yet.
                </p>
              )}
            </div>
          </div>

          {/* Notes Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Order Notes</h3>
            </div>
            <div className="p-6">
              <Notes 
                entityType="order" 
                entityId={order.id.toString()} 
                initialNotes={notes}
                currentUserId={user.id || user.email}
                currentUserName={userDetails?.name || user.email}
              />
            </div>
          </div>

          {/* Vendor Information */}
          {vendor && (
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Vendor Information</h3>
              </div>
              <div className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Vendor</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.displayName}</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Company</p>
                    <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.companyName || "--"}</p>
                  </div>
                  {vendor.contactName && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Contact</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.contactName}</p>
                    </div>
                  )}
                  {vendor.email && (
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.email}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Attachments Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Attachments</h3>
              <Button onClick={handleFileUpload}>Upload File</Button>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                style={{ display: 'none' }}
                accept="*/*"
              />
            </div>
            <div className="p-6">
              {order.attachments && order.attachments.length > 0 ? (
                <div className="space-y-3">
                  {order.attachments.map((attachment: Attachment) => (
                    <div 
                      key={attachment.id} 
                      className={`
                        flex items-center justify-between p-4 rounded-lg
                        transition-all duration-300 ease-out
                        ${isViewableFile(attachment.fileName, attachment.contentType) 
                          ? 'bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 cursor-pointer hover:scale-[1.02] hover:shadow-md focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:outline-none' 
                          : 'bg-gray-50 dark:bg-gray-700'
                        }
                      `}
                      onClick={isViewableFile(attachment.fileName, attachment.contentType) ? () => handleViewFile(attachment) : undefined}
                      onKeyDown={isViewableFile(attachment.fileName, attachment.contentType) ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleViewFile(attachment);
                        }
                      } : undefined}
                      role={isViewableFile(attachment.fileName, attachment.contentType) ? "button" : undefined}
                      tabIndex={isViewableFile(attachment.fileName, attachment.contentType) ? 0 : undefined}
                    >
                      <div className="flex-1 pointer-events-none">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{attachment.fileName}</p>
                          {isViewableFile(attachment.fileName, attachment.contentType) && (
                            <span className="text-xs bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 px-2 py-0.5 rounded-full">
                              {getFileType(attachment.fileName, attachment.contentType).type.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {formatFileSize(attachment.fileSize || 0)} • Uploaded {formatDate(attachment.createdAt)}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <a
                          href={`/attachments/${attachment.id}/download`}
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/50 rounded transition-colors"
                          title="Download"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/>
                            <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708l3 3z"/>
                          </svg>
                        </a>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAttachment(attachment.id);
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/50 rounded transition-colors"
                          title="Delete"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            viewBox="0 0 16 16"
                          >
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fillRule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No attachments uploaded yet.
                </p>
              )}
            </div>
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
        />
      )}
      
      {/* Line Item Modal */}
      <LineItemModal
        isOpen={lineItemModalOpen}
        onClose={() => setLineItemModalOpen(false)}
        onSubmit={handleLineItemSubmit}
        lineItem={selectedLineItem}
        mode={lineItemMode}
      />
    </div>
  );
}