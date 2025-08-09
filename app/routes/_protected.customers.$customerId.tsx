import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { useLoaderData, Link, useFetcher } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import { getCustomer, updateCustomer, archiveCustomer, getCustomerOrders, getCustomerStats, getCustomerWithAttachments } from "~/lib/customers";
import { getAttachment, createAttachment, deleteAttachment, linkAttachmentToCustomer, unlinkAttachmentFromCustomer, type Attachment } from "~/lib/attachments";
import type { Vendor } from "~/lib/db/schema";
import { getNotes, createNote, updateNote, archiveNote } from "~/lib/notes";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { uploadFile, generateFileKey, deleteFile, getDownloadUrl } from "~/lib/s3.server";
import Navbar from "~/components/Navbar";
import Breadcrumbs from "~/components/Breadcrumbs";
import Button from "~/components/shared/Button";
import { InputField as FormField } from "~/components/shared/FormField";
import { Notes } from "~/components/shared/Notes";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { isViewableFile, getFileType, formatFileSize } from "~/lib/file-utils";
import ToggleSlider from "~/components/shared/ToggleSlider";

type CustomerOrder = {
  id: number;
  orderNumber: string;
  customerId: number | null;
  vendorId: number | null;
  status: string;
  totalPrice: string | null;
  vendorPay: string | null;
  shipDate: Date | null;
  createdAt: Date;
  vendor: Vendor | null;
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  const customerId = params.customerId;
  if (!customerId) {
    throw new Response("Customer ID is required", { status: 400 });
  }

  const customer = await getCustomerWithAttachments(parseInt(customerId));
  if (!customer) {
    throw new Response("Customer not found", { status: 404 });
  }

  // Get customer data in parallel
  const [orders, stats, notes] = await Promise.all([
    getCustomerOrders(customer.id),
    getCustomerStats(customer.id),
    getNotes("customer", customer.id.toString())
  ]);

  return withAuthHeaders(
    json({ customer, orders, stats, notes, user, userDetails, appConfig }),
    headers
  );
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { headers } = await requireAuth(request);
  
  const customerId = params.customerId;
  if (!customerId) {
    return json({ error: "Customer ID is required" }, { status: 400 });
  }

  const customer = await getCustomer(parseInt(customerId));
  if (!customer) {
    return json({ error: "Customer not found" }, { status: 404 });
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
      const key = generateFileKey(customer.id, file.name);

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

      // Link to customer
      await linkAttachmentToCustomer(customer.id, attachment.id);

      // Return a redirect to refresh the page
      return redirect(`/customers/${customerId}`);
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
      case "updateCustomer": {
        const displayName = formData.get("displayName") as string;
        const email = formData.get("email") as string;
        const phone = formData.get("phone") as string;

        const updated = await updateCustomer(customer.id, {
          displayName,
          email: email || null,
          phone: phone || null
        });

        return withAuthHeaders(json({ customer: updated }), headers);
      }

      case "archiveCustomer": {
        await archiveCustomer(customer.id);
        return redirect("/customers");
      }

      case "getNotes": {
        const notes = await getNotes("customer", customer.id.toString());
        return withAuthHeaders(json({ notes }), headers);
      }

      case "createNote": {
        const content = formData.get("content") as string;
        const createdBy = formData.get("createdBy") as string;

        if (!content || !createdBy) {
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        const note = await createNote({
          entityType: "customer",
          entityId: customer.id.toString(),
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

        // Unlink from customer first
        await unlinkAttachmentFromCustomer(customer.id, attachmentId);

        // Delete from S3
        await deleteFile(attachment.s3Key);

        // Delete database record
        await deleteAttachment(attachmentId);

        // Return a redirect to refresh the page
        return redirect(`/customers/${customerId}`);
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

      default:
        return json({ error: "Invalid intent" }, { status: 400 });
    }
  } catch (error) {
    console.error("Action error:", error);
    return json({ error: "Failed to process request" }, { status: 500 });
  }
}

export default function CustomerDetails() {
  const { customer, orders, stats, notes, user, userDetails, appConfig } = useLoaderData<typeof loader>();
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ url: string; fileName: string; contentType?: string; fileSize?: number } | null>(null);
  const [showCompletedOrders, setShowCompletedOrders] = useState(true);
  const updateFetcher = useFetcher();
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveInfo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateCustomer");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingInfo(false);
  };

  const handleSaveContact = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateCustomer");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingContact(false);
  };

  // Add keyboard shortcuts for editing forms
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if we're in an editing mode
      if (!isEditingInfo && !isEditingContact) return;
      
      // Handle Escape key to cancel
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsEditingInfo(false);
        setIsEditingContact(false);
      }
      
      // Handle Enter key to save
      // For textareas, require Ctrl+Enter or Cmd+Enter
      // For other elements (inputs, buttons, etc.), just Enter works
      if (event.key === 'Enter') {
        const isTextarea = event.target instanceof HTMLTextAreaElement;
        
        // If it's a textarea, require Ctrl or Cmd to be pressed
        if (isTextarea && !event.ctrlKey && !event.metaKey) {
          return;
        }
        
        event.preventDefault();
        
        if (isEditingInfo) {
          const form = document.querySelector('form[data-editing="info"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateCustomer");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingInfo(false);
          }
        }
        
        if (isEditingContact) {
          const form = document.querySelector('form[data-editing="contact"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateCustomer");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingContact(false);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditingInfo, isEditingContact, updateFetcher]);

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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "--";
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    });
  };

  const getStatusDisplay = (status: string) => {
    switch (status) {
      case 'In_Production':
        return 'In Production';
      default:
        return status.charAt(0).toUpperCase() + status.slice(1);
    }
  };

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
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/" },
            { label: "Customers", href: "/customers" },
            { label: customer.displayName }
          ]} />
        </div>
        
        <div className="px-4 sm:px-6 lg:px-10 py-6 space-y-6">
          {/* Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Total Orders</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{stats.totalOrders}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Active Orders</h3>
              <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{stats.activeOrders}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Completed Orders</h3>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{stats.completedOrders}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Total Spent</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">{formatCurrency(stats.totalSpent)}</p>
            </div>
          </div>

          {/* Information Sections */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Customer Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Customer Information</h3>
                {!isEditingInfo && (
                  <Button variant="secondary" size="sm" onClick={() => setIsEditingInfo(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingInfo ? (
                  <updateFetcher.Form onSubmit={handleSaveInfo} data-editing="info">
                    <div className="space-y-4">
                      <FormField
                        label="Display Name"
                        name="displayName"
                        defaultValue={customer.displayName}
                        required
                      />
                      <input type="hidden" name="email" value={customer.email || ""} />
                      <input type="hidden" name="phone" value={customer.phone || ""} />
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" size="sm">Save</Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingInfo(false)}>Cancel</Button>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Press Enter to save, Esc to cancel</span>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Display Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.displayName}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Customer ID</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">CUST-{customer.id.toString().padStart(5, '0')}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Status</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.isArchived ? 'Inactive' : 'Active'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Created Date</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{formatDate(customer.createdAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Contact Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Contact Information</h3>
                {!isEditingContact && (
                  <Button variant="secondary" size="sm" onClick={() => setIsEditingContact(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingContact ? (
                  <updateFetcher.Form onSubmit={handleSaveContact} data-editing="contact">
                    <div className="space-y-4">
                      <input type="hidden" name="displayName" value={customer.displayName} />
                      <FormField
                        label="Email"
                        name="email"
                        type="email"
                        defaultValue={customer.email || ""}
                      />
                      <FormField
                        label="Phone"
                        name="phone"
                        type="tel"
                        defaultValue={customer.phone || ""}
                      />
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" size="sm">Save</Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingContact(false)}>Cancel</Button>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Press Enter to save, Esc to cancel</span>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email (Primary)</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.email || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Phone (Primary)</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.phone || "--"}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Order History */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Order History</h3>
              <ToggleSlider
                checked={showCompletedOrders}
                onChange={setShowCompletedOrders}
                label="Show completed"
              />
            </div>
            <div className="p-6">
              {orders.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead>
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Order Number
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Total
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(orders as CustomerOrder[])
                        .filter(order => showCompletedOrders || order.status.toLowerCase() !== 'completed')
                        .map(order => (
                        <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                            {order.orderNumber}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {formatDate(order.createdAt)}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap">
                            <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusClasses(order.status)}`}>
                              {getStatusDisplay(order.status)}
                            </span>
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {formatCurrency(parseFloat(order.totalPrice || '0'))}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm">
                            <Link
                              to={`/orders/${order.orderNumber}`}
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-900 dark:hover:text-blue-300"
                            >
                              View
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No orders found for this customer.
                </p>
              )}
            </div>
          </div>

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
              {customer.attachments && customer.attachments.length > 0 ? (
                <div className="space-y-3">
                  {customer.attachments.map((attachment: Attachment) => (
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

          {/* Notes Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Notes</h3>
            </div>
            <div className="p-6">
              <Notes 
                entityType="customer" 
                entityId={customer.id.toString()} 
                initialNotes={notes}
                currentUserId={user.id || user.email}
                currentUserName={userDetails?.name || user.email}
              />
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
    </div>
  );
}