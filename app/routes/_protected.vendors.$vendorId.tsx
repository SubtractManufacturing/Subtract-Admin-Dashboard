import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { useLoaderData, useFetcher, Link } from "@remix-run/react";
import { getVendor, updateVendor, archiveVendor, getVendorOrders, getVendorStats, getVendorWithAttachments } from "~/lib/vendors";
import { authorizeAttachmentDeletion, getAttachment, createAttachment, deleteAttachment, linkAttachmentToAccount, unlinkAttachmentFromAccount, type AttachmentEventContext } from "~/lib/attachments";
import {
  accountIdForLegacyId,
  listOrganizationAddresses,
  listOrganizationContacts,
  resolveFinalAccountId,
  siblingAccounts,
} from "~/lib/organizations/accounts.server";
import { handleOrganizationIntent, isOrganizationIntent } from "~/lib/organizations/page-actions.server";
import { profileInputFromForm } from "~/lib/organizations/profile";
import { isUuid } from "~/lib/organizations/types";
import { authorize } from "~/lib/authorization/authorize";
import { findDuplicateContacts } from "~/lib/customer-merge.server";
import { createCustomer } from "~/lib/customers";
import { ContactsSection } from "~/components/organizations/ContactsSection";
import { AddressesSection } from "~/components/organizations/AddressesSection";
import type { Customer } from "~/lib/organizations/types";
import { getNotes, createNote, updateNote, archiveNote, type NoteEventContext } from "~/lib/notes";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { uploadFile, generateFileKey, deleteFile, getDownloadUrl } from "~/lib/s3.server";
import Button from "~/components/shared/Button";
import Breadcrumbs from "~/components/Breadcrumbs";
import { Notes } from "~/components/shared/Notes";
import { InputField as FormField, PhoneInputField, SelectField } from "~/components/shared/FormField";
import { AttachmentsSection } from "~/components/shared/AttachmentsSection";
import ToggleSlider from "~/components/shared/ToggleSlider";
import { EventTimeline } from "~/components/EventTimeline";
import { getEventsByEntity } from "~/lib/events";
import {
  extractBillingAddress,
  extractShippingAddress,
  formatAddress,
  isAddressComplete
} from "~/lib/address-utils";

type VendorOrder = {
  id: number;
  orderNumber: string;
  customerAccountId: string | null;
  vendorAccountId: string | null;
  status: string;
  totalPrice: string | null;
  vendorPay: string | null;
  deliveryDate: Date | null;
  createdAt: Date;
  customer: Customer | null;
};
import { useState, useEffect } from "react";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, actor, headers } = await requireAuth(request);
  
  const vendorId = params.vendorId;
  if (!vendorId) {
    throw new Response("Vendor ID is required", { status: 400 });
  }

  // Links from before ADR-0013 used the integer Vendor id.
  if (/^\d+$/.test(vendorId)) {
    const accountId = await accountIdForLegacyId("vendor", Number(vendorId));
    if (accountId) throw redirect(`/vendors/${accountId}`, { status: 301, headers });
    throw new Response("Vendor not found", { status: 404 });
  }
  if (!isUuid(vendorId)) {
    throw new Response("Vendor not found", { status: 404 });
  }

  const vendor = await getVendorWithAttachments(vendorId);
  if (!vendor) {
    throw new Response("Vendor not found", { status: 404 });
  }

  // A Vendor whose Organization was merged away leads to the survivor's Vendor page.
  if (vendor.isArchived && vendor.mergedIntoOrganizationId) {
    const survivorId = await resolveFinalAccountId(vendor.id);
    if (survivorId && survivorId !== vendor.id) {
      throw redirect(`/vendors/${survivorId}`, { headers });
    }
  }

  const canMerge = authorize(actor, "organization.merge").allowed;
  const [orders, stats, notes, events, contacts, addresses, siblings, duplicateContacts] = await Promise.all([
    getVendorOrders(vendor.id),
    getVendorStats(vendor.id),
    getNotes("vendor", vendor.id),
    getEventsByEntity("vendor", vendor.id, 10),
    listOrganizationContacts(vendor.organizationId),
    listOrganizationAddresses(vendor.organizationId),
    siblingAccounts(vendor.organizationId),
    canMerge ? findDuplicateContacts(vendor.organizationId) : Promise.resolve([]),
  ]);
  const customerAccount = siblings.find((account) => account.type === "customer" && !account.isArchived) ?? null;

  return withAuthHeaders(
    json({
      vendor,
      orders,
      stats,
      notes,
      user,
      userDetails,
      events,
      contacts,
      addresses,
      customerAccountId: customerAccount?.id ?? null,
      duplicateContacts,
      canMerge,
    }),
    headers
  );
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
  const vendorId = params.vendorId;
  if (!vendorId) {
    return json({ error: "Vendor ID is required" }, { status: 400 });
  }

  const vendor = await getVendor(vendorId);
  if (!vendor) {
    return json({ error: "Vendor not found" }, { status: 404 });
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
      return json({ error: "File size exceeds 10MB limit" }, { status: 400 });
    }

    try {
      // Convert File to Buffer
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Generate S3 key
      const key = generateFileKey(vendor.id, file.name);

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
        source: "user_upload",
      }, eventContext);

      // Files belong to the Organization (ADR-0013).
      await linkAttachmentToAccount(vendor, attachment.id, eventContext);

      if (formData.get("_noRedirect")) {
        return json({ success: true, attachmentId: attachment.id });
      }

      // Return a redirect to refresh the page
      return redirect(`/vendors/${vendorId}`);
    } catch (error) {
      console.error('Upload error:', error);
      return json({ error: "Failed to upload file" }, { status: 500 });
    }
  }

  // Handle other form submissions
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (isOrganizationIntent(intent)) {
      return withAuthHeaders(
        await handleOrganizationIntent(intent, formData, vendor, {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        }),
        headers,
      );
    }

    switch (intent) {
      case "addCustomerAccount": {
        // The same Organization also buys from us (ADR-0013).
        const customer = await createCustomer(
          {},
          { userId: user?.id, userEmail: user?.email || userDetails?.name || undefined },
          { organizationId: vendor.organizationId },
        );
        return redirect(`/customers/${customer.id}`);
      }

      case "updateVendor": {
        const eventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        // Only the fields the form posted change (ADR-0013 partial writes).
        const updated = await updateVendor(vendor.id, profileInputFromForm(formData), eventContext);

        return withAuthHeaders(json({ vendor: updated }), headers);
      }

      case "archiveVendor": {
        const eventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await archiveVendor(vendor.id, eventContext);
        return redirect("/vendors");
      }

      case "getNotes": {
        const notes = await getNotes("vendor", vendor.id);
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
          entityType: "vendor",
          entityId: vendor.id,
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

        const note = await archiveNote(noteId, noteEventContext);
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

        const eventContext: AttachmentEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
          canDeleteProtected:
            userDetails.role === "Admin" || userDetails.role === "Dev",
        };
        const authorizedAttachment = await authorizeAttachmentDeletion({
          attachmentId,
          entityType: "organization",
          entityId: vendor.organizationId,
          eventContext,
        });
        if (!authorizedAttachment) {
          return json({ error: "Attachment not found on this Vendor" }, { status: 404 });
        }

        // Unlink from vendor first
        await unlinkAttachmentFromAccount(vendor, attachmentId, eventContext);

        // Delete from S3
        await deleteFile(authorizedAttachment.s3Key);

        // Delete database record
        await deleteAttachment(attachmentId, eventContext);

        // Return a redirect to refresh the page
        return redirect(`/vendors/${vendorId}`);
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

export default function VendorDetails() {
  const { vendor, orders, stats, notes, user, userDetails, events, contacts, addresses, customerAccountId, duplicateContacts, canMerge } = useLoaderData<typeof loader>();
  const [isEditingCompanyInfo, setIsEditingCompanyInfo] = useState(false);
  const [isEditingContactInfo, setIsEditingContactInfo] = useState(false);
  const [isEditingBillingAddress, setIsEditingBillingAddress] = useState(false);
  const [isEditingShippingAddress, setIsEditingShippingAddress] = useState(false);
  const [showCompletedOrders, setShowCompletedOrders] = useState(true);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const updateFetcher = useFetcher();

  const handleSaveCompanyInfo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateVendor");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingCompanyInfo(false);
  };

  const handleSaveContactInfo = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateVendor");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingContactInfo(false);
  };

  const handleSaveBillingAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateVendor");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingBillingAddress(false);
  };

  const handleSaveShippingAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateVendor");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingShippingAddress(false);
  };

  const handleCopyBillingToShipping = () => {
    const billingAddress = extractBillingAddress(vendor);
    const formData = new FormData();
    formData.append("intent", "updateVendor");
    formData.append("contactName", vendor.contactName || "");
    formData.append("title", vendor.title || "");
    formData.append("email", vendor.email || "");
    formData.append("phone", vendor.phone || "");
    formData.append("paymentTerms", vendor.paymentTerms || "");
    formData.append("discordId", vendor.discordId || "");
    formData.append("address", vendor.address || "");
    formData.append("notes", vendor.notes || "");
    formData.append("billingAddressLine1", vendor.billingAddressLine1 || "");
    formData.append("billingAddressLine2", vendor.billingAddressLine2 || "");
    formData.append("billingCity", vendor.billingCity || "");
    formData.append("billingState", vendor.billingState || "");
    formData.append("billingPostalCode", vendor.billingPostalCode || "");
    formData.append("billingCountry", vendor.billingCountry || "");
    formData.append("shippingAddressLine1", billingAddress.line1 || "");
    formData.append("shippingAddressLine2", billingAddress.line2 || "");
    formData.append("shippingCity", billingAddress.city || "");
    formData.append("shippingState", billingAddress.state || "");
    formData.append("shippingPostalCode", billingAddress.postalCode || "");
    formData.append("shippingCountry", billingAddress.country || "");
    updateFetcher.submit(formData, { method: "post" });
  };

  const handleCopyShippingToBilling = () => {
    const shippingAddress = extractShippingAddress(vendor);
    const formData = new FormData();
    formData.append("intent", "updateVendor");
    formData.append("contactName", vendor.contactName || "");
    formData.append("title", vendor.title || "");
    formData.append("email", vendor.email || "");
    formData.append("phone", vendor.phone || "");
    formData.append("paymentTerms", vendor.paymentTerms || "");
    formData.append("discordId", vendor.discordId || "");
    formData.append("address", vendor.address || "");
    formData.append("notes", vendor.notes || "");
    formData.append("billingAddressLine1", shippingAddress.line1 || "");
    formData.append("billingAddressLine2", shippingAddress.line2 || "");
    formData.append("billingCity", shippingAddress.city || "");
    formData.append("billingState", shippingAddress.state || "");
    formData.append("billingPostalCode", shippingAddress.postalCode || "");
    formData.append("billingCountry", shippingAddress.country || "");
    formData.append("shippingAddressLine1", vendor.shippingAddressLine1 || "");
    formData.append("shippingAddressLine2", vendor.shippingAddressLine2 || "");
    formData.append("shippingCity", vendor.shippingCity || "");
    formData.append("shippingState", vendor.shippingState || "");
    formData.append("shippingPostalCode", vendor.shippingPostalCode || "");
    formData.append("shippingCountry", vendor.shippingCountry || "");
    updateFetcher.submit(formData, { method: "post" });
  };

  // Add keyboard shortcuts for editing forms
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if we're in an editing mode
      if (!isEditingCompanyInfo && !isEditingContactInfo && !isEditingBillingAddress && !isEditingShippingAddress) return;

      // Handle Escape key to cancel
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsEditingCompanyInfo(false);
        setIsEditingContactInfo(false);
        setIsEditingBillingAddress(false);
        setIsEditingShippingAddress(false);
      }

      // Handle Enter key to save
      if (event.key === 'Enter') {
        const isTextarea = event.target instanceof HTMLTextAreaElement;
        if (isTextarea && !event.ctrlKey && !event.metaKey) {
          return;
        }

        event.preventDefault();

        if (isEditingCompanyInfo) {
          const form = document.querySelector('form[data-editing="company-info"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateVendor");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingCompanyInfo(false);
          }
        }

        if (isEditingContactInfo) {
          const form = document.querySelector('form[data-editing="contact-info"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateVendor");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingContactInfo(false);
          }
        }

        if (isEditingBillingAddress) {
          const form = document.querySelector('form[data-editing="billing-address"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateVendor");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingBillingAddress(false);
          }
        }

        if (isEditingShippingAddress) {
          const form = document.querySelector('form[data-editing="shipping-address"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateVendor");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingShippingAddress(false);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditingCompanyInfo, isEditingContactInfo, isEditingBillingAddress, isEditingShippingAddress, updateFetcher]);

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
      <div className="max-w-[1920px] mx-auto">
        <div className="flex justify-between items-center px-10 py-2.5">
          <Breadcrumbs items={[
            { label: "Dashboard", href: "/" },
            { label: "Vendors", href: "/vendors" },
            { label: vendor.displayName }
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
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Total Earnings</h3>
              <p className="text-3xl font-bold text-green-600 dark:text-green-400">{formatCurrency(stats.totalEarnings)}</p>
            </div>
            
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 p-6">
              <h3 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-2">Avg Lead Time</h3>
              <p className="text-3xl font-bold text-gray-900 dark:text-gray-100">
                {stats.averageLeadTime ? `${stats.averageLeadTime} days` : "--"}
              </p>
            </div>
          </div>

          {/* Information Sections - 4-column grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Company Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Organization</h3>
                {!isEditingCompanyInfo && (
                  <Button size="sm" onClick={() => setIsEditingCompanyInfo(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingCompanyInfo ? (
                  <updateFetcher.Form onSubmit={handleSaveCompanyInfo} data-editing="company-info">
                    <div className="space-y-4">
                      <FormField
                        label="Name"
                        name="name"
                        defaultValue={vendor.name}
                        required
                      />
                      <SelectField label="Type" name="kind" defaultValue={vendor.kind}>
                        <option value="business">Business</option>
                        <option value="individual">Individual (one-person shop)</option>
                      </SelectField>
                      <FormField
                        label="Website"
                        name="website"
                        defaultValue={vendor.website || ""}
                      />
                      <FormField
                        label="Payment Terms"
                        name="paymentTerms"
                        defaultValue={vendor.paymentTerms || ""}
                      />
                      <FormField
                        label="Discord ID"
                        name="discordId"
                        defaultValue={vendor.discordId || ""}
                      />
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" size="sm">Save</Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingCompanyInfo(false)}>Cancel</Button>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Press Enter to save, Esc to cancel</span>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.name}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Type</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.kind === "business" ? "Business" : "Individual"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Payment Terms</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.paymentTerms || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Discord ID</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.discordId || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Customer</p>
                      {customerAccountId ? (
                        <Link to={`/customers/${customerAccountId}`} className="text-blue-600 hover:underline dark:text-blue-400">
                          Also a Customer: view Customer page
                        </Link>
                      ) : (
                        <updateFetcher.Form method="post">
                          <input type="hidden" name="intent" value="addCustomerAccount" />
                          <Button type="submit" size="sm" variant="secondary">
                            Make this a Customer too
                          </Button>
                        </updateFetcher.Form>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Status</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.isArchived ? 'Inactive' : 'Active'}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Created Date</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{formatDate(vendor.createdAt)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Contact Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Primary Contact</h3>
                {!isEditingContactInfo && (
                  <Button size="sm" onClick={() => setIsEditingContactInfo(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingContactInfo ? (
                  <updateFetcher.Form onSubmit={handleSaveContactInfo} data-editing="contact-info">
                    <div className="space-y-4">
                      <FormField
                        label="Contact Name"
                        name="contactName"
                        defaultValue={vendor.contactName || ""}
                      />
                      <FormField
                        label="Job Title"
                        name="title"
                        defaultValue={vendor.title || ""}
                      />
                      <FormField
                        label="Email"
                        name="email"
                        type="email"
                        defaultValue={vendor.email || ""}
                      />
                      <PhoneInputField
                        label="Phone"
                        name="phone"
                        defaultValue={vendor.phone || ""}
                      />
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" size="sm">Save</Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingContactInfo(false)}>Cancel</Button>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Press Enter to save, Esc to cancel</span>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Contact Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.contactName || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Job Title</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.title || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.email || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Phone</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{vendor.phone || "--"}</p>
                    </div>

                  </div>
                )}
              </div>
            </div>

            {/* Billing Address */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Billing Address</h3>
                <div className="flex gap-2">
                  {!isEditingBillingAddress && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleCopyShippingToBilling}
                      title="Copy shipping address to billing"
                    >
                      Copy from Shipping
                    </Button>
                  )}
                  {!isEditingBillingAddress && (
                    <Button size="sm" onClick={() => setIsEditingBillingAddress(true)}>
                      Edit
                    </Button>
                  )}
                </div>
              </div>
              <div className="p-6">
                {isEditingBillingAddress ? (
                  <updateFetcher.Form onSubmit={handleSaveBillingAddress} data-editing="billing-address">
                    <div className="space-y-4">
                      <FormField
                        label="Address Line 1"
                        name="billingAddressLine1"
                        defaultValue={vendor.billingAddressLine1 || ""}
                      />
                      <FormField
                        label="Address Line 2"
                        name="billingAddressLine2"
                        defaultValue={vendor.billingAddressLine2 || ""}
                      />
                      <FormField
                        label="City"
                        name="billingCity"
                        defaultValue={vendor.billingCity || ""}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label="State"
                          name="billingState"
                          defaultValue={vendor.billingState || ""}
                        />
                        <FormField
                          label="Postal Code"
                          name="billingPostalCode"
                          defaultValue={vendor.billingPostalCode || ""}
                        />
                      </div>
                      <FormField
                        label="Country"
                        name="billingCountry"
                        defaultValue={vendor.billingCountry || "US"}
                      />
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" size="sm">Save</Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingBillingAddress(false)}>Cancel</Button>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Press Enter to save, Esc to cancel</span>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    {isAddressComplete(extractBillingAddress(vendor)) ? (
                      <div className="whitespace-pre-line text-gray-900 dark:text-gray-100">
                        {formatAddress(extractBillingAddress(vendor))}
                      </div>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400 italic">No billing address provided</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Shipping Address */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Default Shipping Address</h3>
                {!isEditingShippingAddress && (
                  <Button size="sm" onClick={() => setIsEditingShippingAddress(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingShippingAddress ? (
                  <updateFetcher.Form onSubmit={handleSaveShippingAddress} data-editing="shipping-address">
                    <div className="space-y-4">
                      {isAddressComplete(extractBillingAddress(vendor)) && (
                        <div className="mb-4">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={handleCopyBillingToShipping}
                          >
                            Copy from Billing Address
                          </Button>
                        </div>
                      )}
                      <FormField
                        label="Address Line 1"
                        name="shippingAddressLine1"
                        defaultValue={vendor.shippingAddressLine1 || ""}
                      />
                      <FormField
                        label="Address Line 2"
                        name="shippingAddressLine2"
                        defaultValue={vendor.shippingAddressLine2 || ""}
                      />
                      <FormField
                        label="City"
                        name="shippingCity"
                        defaultValue={vendor.shippingCity || ""}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label="State"
                          name="shippingState"
                          defaultValue={vendor.shippingState || ""}
                        />
                        <FormField
                          label="Postal Code"
                          name="shippingPostalCode"
                          defaultValue={vendor.shippingPostalCode || ""}
                        />
                      </div>
                      <FormField
                        label="Country"
                        name="shippingCountry"
                        defaultValue={vendor.shippingCountry || "US"}
                      />
                      <div className="flex justify-between items-center">
                        <div className="flex gap-2">
                          <Button type="submit" variant="primary" size="sm">Save</Button>
                          <Button type="button" variant="secondary" size="sm" onClick={() => setIsEditingShippingAddress(false)}>Cancel</Button>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Press Enter to save, Esc to cancel</span>
                      </div>
                    </div>
                  </updateFetcher.Form>
                ) : (
                  <div className="space-y-4">
                    {isAddressComplete(extractShippingAddress(vendor)) ? (
                      <div className="whitespace-pre-line text-gray-900 dark:text-gray-100">
                        {formatAddress(extractShippingAddress(vendor))}
                      </div>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400 italic">No shipping address provided</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Contacts and addresses of the Organization (ADR-0013) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ContactsSection
              contacts={contacts}
              duplicatePairs={duplicateContacts}
              canMerge={canMerge}
              returnTo={`/vendors/${vendor.id}`}
            />
            <AddressesSection
              addresses={addresses}
              billingAddressId={vendor.billingAddressId}
              accountLabel="Vendor"
            />
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
                          Customer
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Order Total
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Vendor Pay
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {(orders as VendorOrder[])
                        .filter(order => showCompletedOrders || order.status.toLowerCase() !== 'completed')
                        .map(order => (
                        <tr key={order.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                          <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100">
                            {order.orderNumber}
                          </td>
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {order.customer?.displayName || "--"}
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
                          <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                            {formatCurrency(parseFloat(order.vendorPay || '0'))}
                            <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                              ({parseFloat(order.totalPrice || '0') > 0
                                ? ((parseFloat(order.vendorPay || '0') / parseFloat(order.totalPrice || '1')) * 100).toFixed(1)
                                : '0'}%)
                            </span>
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
                  No orders found for this vendor.
                </p>
              )}
            </div>
          </div>

          <AttachmentsSection
            attachments={vendor.attachments || []}
            entityType="vendor"
            entityId={vendor.id}
          />

          {/* Notes and Event Log Section - Side by Side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Notes */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Notes</h3>
                {!isAddingNote && (
                  <Button size="sm" onClick={() => setIsAddingNote(true)}>
                    Add Note
                  </Button>
                )}
              </div>
              <div className="p-6">
                <Notes
                  entityType="vendor"
                  entityId={vendor.id.toString()}
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

            {/* Event Log */}
            <EventTimeline
              entityType="vendor"
              entityId={vendor.id.toString()}
              entityName={vendor.displayName}
              initialEvents={events}
            />
          </div>
        </div>
      </div>

    </div>
  );
}
