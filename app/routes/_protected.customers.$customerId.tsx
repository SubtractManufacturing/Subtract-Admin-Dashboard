import { json, LoaderFunctionArgs, ActionFunctionArgs, redirect, unstable_parseMultipartFormData, unstable_createMemoryUploadHandler } from "@remix-run/node";
import { useLoaderData, Link, useFetcher, useRevalidator } from "@remix-run/react";
import { useState, useRef, useEffect } from "react";
import { getCustomer, updateCustomer, archiveCustomer, getCustomerOrders, getCustomerStats, getCustomerWithAttachments, type CustomerEventContext } from "~/lib/customers";
import { getAttachment, createAttachment, deleteAttachment, deleteAttachmentByS3Key, linkAttachmentToCustomer, unlinkAttachmentFromCustomer, linkAttachmentToPart, type Attachment, type AttachmentEventContext } from "~/lib/attachments";
import type { Vendor, Part, Customer } from "~/lib/db/schema";
import { getNotes, createNote, updateNote, archiveNote, type NoteEventContext } from "~/lib/notes";
import { getPartsByCustomerId, createPart, updatePart, archivePart, getPart, type PartInput, type PartEventContext } from "~/lib/parts";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { canUserUploadMesh, canUserUploadCadRevision, isFeatureEnabled, FEATURE_FLAGS } from "~/lib/featureFlags";
import { getBananaModelUrls } from "~/lib/developerSettings";
import { uploadFile, generateFileKey, deleteFile, getDownloadUrl, getDownloadUrl as getS3DownloadUrl } from "~/lib/s3.server";
import { formatAddress, extractBillingAddress, extractShippingAddress } from "~/lib/address-utils";
import Breadcrumbs from "~/components/Breadcrumbs";
import Button from "~/components/shared/Button";
import { InputField as FormField, PhoneInputField } from "~/components/shared/FormField";
import { Notes } from "~/components/shared/Notes";
import FileViewerModal from "~/components/shared/FileViewerModal";
import { isViewableFile, getFileType, formatFileSize } from "~/lib/file-utils";
import ToggleSlider from "~/components/shared/ToggleSlider";
import PartsModal from "~/components/PartsModal";
import { Part3DViewerModal } from "~/components/shared/Part3DViewerModal";
import { HiddenThumbnailGenerator } from "~/components/HiddenThumbnailGenerator";
import { EventTimeline } from "~/components/EventTimeline";
import { getEventsByEntity } from "~/lib/events";

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
  
  const customerId = params.customerId;
  if (!customerId) {
    throw new Response("Customer ID is required", { status: 400 });
  }

  const customer = await getCustomerWithAttachments(parseInt(customerId));
  if (!customer) {
    throw new Response("Customer not found", { status: 404 });
  }

  // Get customer data in parallel
  const [orders, stats, notes, rawParts, canUploadMesh, events, canRevise, bananaEnabled] = await Promise.all([
    getCustomerOrders(customer.id),
    getCustomerStats(customer.id),
    getNotes("customer", customer.id.toString()),
    getPartsByCustomerId(customer.id),
    canUserUploadMesh(userDetails.role),
    getEventsByEntity("customer", customer.id.toString(), 10),
    canUserUploadCadRevision(userDetails?.role),
    isFeatureEnabled(FEATURE_FLAGS.BANANA_FOR_SCALE),
  ]);

  // Get banana model URL if feature is enabled
  let bananaModelUrl: string | null = null;
  if (bananaEnabled) {
    const bananaUrls = await getBananaModelUrls();
    if (bananaUrls.meshUrl && bananaUrls.conversionStatus === "completed") {
      bananaModelUrl = await getS3DownloadUrl(bananaUrls.meshUrl);
    }
  }

  // Hydrate thumbnails and mesh URLs for customer parts (convert S3 keys to signed URLs)
  const partsWithSignedUrls = await Promise.all(
    rawParts.map(async (part) => {
      let signedMeshUrl = undefined;
      let signedThumbnailUrl = undefined;

      // Get signed mesh URL if mesh exists and conversion is completed
      if (part.partMeshUrl && part.meshConversionStatus === "completed") {
        try {
          const { getDownloadUrl } = await import('~/lib/s3.server');
          let meshKey: string;

          // Extract S3 key from the URL - handle both formats:
          // 1. Full S3 URLs from mesh conversion: https://...supabase.co/.../testing-bucket/parts/xxx/mesh/file.glb
          // 2. Relative paths from manual uploads: /attachments/s3/parts/xxx/mesh/file.glb
          if (part.partMeshUrl.startsWith('http')) {
            // For full URLs, just extract everything starting from 'parts/'
            // This works for Supabase URLs like: https://.../storage/v1/s3/testing-bucket/parts/...
            const partsIndex = part.partMeshUrl.indexOf('parts/');
            if (partsIndex >= 0) {
              meshKey = part.partMeshUrl.substring(partsIndex);

              // Check if the key contains duplicated paths (from old buggy URLs)
              // e.g., "parts/.../.../parts/..." - fix by taking only the last occurrence
              const secondPartsIndex = meshKey.indexOf('parts/', 1);
              if (secondPartsIndex > 0) {
                console.warn(`Found duplicated 'parts/' in mesh URL for part ${part.id}, using last occurrence`);
                meshKey = meshKey.substring(secondPartsIndex);
              }
            } else {
              console.error(`Could not find 'parts/' in URL for part ${part.id}: ${part.partMeshUrl}`);
              // Skip this part's mesh URL
              return { ...part, signedMeshUrl: undefined, thumbnailUrl: signedThumbnailUrl };
            }
          } else if (part.partMeshUrl.startsWith('/attachments/s3/')) {
            meshKey = part.partMeshUrl.replace('/attachments/s3/', '');
          } else {
            // Assume it's already just the key
            meshKey = part.partMeshUrl;
          }

          signedMeshUrl = await getDownloadUrl(meshKey, 3600);
        } catch (error) {
          console.error(`Failed to generate mesh URL for part ${part.id}:`, error);
          // Continue without mesh URL for this part
        }
      }

      // Get signed thumbnail URL
      if (part.thumbnailUrl && !part.thumbnailUrl.startsWith('http')) {
        try {
          const { getDownloadUrl } = await import('~/lib/s3.server');
          signedThumbnailUrl = await getDownloadUrl(part.thumbnailUrl, 3600);
        } catch (error) {
          console.error(`Failed to generate thumbnail URL for part ${part.id}:`, error);
          signedThumbnailUrl = null;
        }
      } else {
        signedThumbnailUrl = part.thumbnailUrl;
      }

      return {
        ...part,
        signedMeshUrl,
        thumbnailUrl: signedThumbnailUrl,
      };
    })
  );

  return withAuthHeaders(
    json({ customer, orders, stats, notes, parts: partsWithSignedUrls, user, userDetails, canUploadMesh, events, canRevise, bananaEnabled, bananaModelUrl }),
    headers
  );
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

async function handlePartsAction(
  formData: FormData,
  intent: string,
  customer: Customer,
  customerId: string,
  user: { id?: string; email?: string } | null,
  userDetails: { name?: string | null } | null
) {
  try {
    if (intent === "createPart") {
      const partName = formData.get("partName") as string;
      const material = formData.get("material") as string;
      const tolerance = formData.get("tolerance") as string;
      const finishing = formData.get("finishing") as string;
      const notes = formData.get("notes") as string;
      const modelFile = formData.get("modelFile") as File | null;
      const meshFile = formData.get("meshFile") as File | null; // TEMPORARY
      const thumbnailFile = formData.get("thumbnailFile") as File | null;

      if (!partName) {
        return json({ error: "Part name is required" }, { status: 400 });
      }

      let thumbnailUrl: string | null = null;

      // Handle thumbnail upload first if provided
      if (thumbnailFile && thumbnailFile.size > 0) {
        try {
          const arrayBuffer = await thumbnailFile.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const key = generateFileKey(customer.id, `part-thumbnail-${Date.now()}-${thumbnailFile.name}`);

          // Upload thumbnail to S3
          const uploadResult = await uploadFile({
            key,
            buffer,
            contentType: thumbnailFile.type || 'image/jpeg',
            fileName: thumbnailFile.name,
          });

          // Store just the S3 key (not a URL)
          // Loaders will generate signed URLs on-demand
          thumbnailUrl = uploadResult.key;
        } catch (error) {
          console.error('Thumbnail upload error:', error);
          // Continue without thumbnail on error
        }
      }

      // Create the part with thumbnail URL
      const eventContext: PartEventContext = {
        userId: user?.id,
        userEmail: user?.email || userDetails?.name || undefined,
      };

      const part = await createPart({
        customerId: customer.id,
        partName,
        material: material || null,
        tolerance: tolerance || null,
        finishing: finishing || null,
        notes: notes || null,
        thumbnailUrl,
      }, eventContext);

      // Handle 3D model file upload if provided
      if (modelFile && modelFile.size > 0) {
        try {
          const arrayBuffer = await modelFile.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const key = generateFileKey(customer.id, `part-${part.id}-${modelFile.name}`);

          // Upload to S3
          const uploadResult = await uploadFile({
            key,
            buffer,
            contentType: modelFile.type || 'application/octet-stream',
            fileName: modelFile.name,
          });

          // Create attachment record
          const attachmentEventContext: AttachmentEventContext = {
            userId: user?.id,
            userEmail: user?.email || userDetails?.name || undefined,
          };
          const attachment = await createAttachment({
            s3Bucket: uploadResult.bucket,
            s3Key: uploadResult.key,
            fileName: uploadResult.fileName,
            contentType: uploadResult.contentType,
            fileSize: uploadResult.size,
          }, attachmentEventContext);

          // Link to part as a 3D model
          await linkAttachmentToPart(part.id, attachment.id);
          
          // Store the file URL in partFileUrl (CAD files only)
          const fileUrl = `/attachments/s3/${uploadResult.key}`;
          await updatePart(part.id.toString(), { partFileUrl: fileUrl }, eventContext);
        } catch (error) {
          console.error('Failed to upload 3D model:', error);
        }
      }
      
      // TEMPORARY: Handle mesh file upload separately
      if (meshFile && meshFile.size > 0) {
        try {
          const arrayBuffer = await meshFile.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const key = generateFileKey(customer.id, `part-mesh-${part.id}-${meshFile.name}`);

          // Upload to S3
          const uploadResult = await uploadFile({
            key,
            buffer,
            contentType: meshFile.type || 'model/stl',
            fileName: meshFile.name,
          });

          // Store the mesh URL in partMeshUrl
          const meshUrl = `/attachments/s3/${uploadResult.key}`;
          await updatePart(part.id.toString(), { partMeshUrl: meshUrl }, eventContext);
        } catch (error) {
          console.error('Failed to upload mesh file:', error);
        }
      }

      return redirect(`/customers/${customerId}`);
    }

    if (intent === "updatePart") {
      const partId = formData.get("partId") as string;
      const partName = formData.get("partName") as string;
      const material = formData.get("material") as string;
      const tolerance = formData.get("tolerance") as string;
      const finishing = formData.get("finishing") as string;
      const notes = formData.get("notes") as string;
      const meshFile = formData.get("meshFile") as File | null; // TEMPORARY
      const thumbnailFile = formData.get("thumbnailFile") as File | null;
      const deleteThumbnail = formData.get("deleteThumbnail") === "true";

      if (!partId || !partName) {
        return json({ error: "Missing required fields" }, { status: 400 });
      }

      let thumbnailUrl: string | null | undefined = undefined;
      
      // Handle thumbnail deletion
      if (deleteThumbnail) {
        // Get the existing part to find the thumbnail URL
        const existingPart = await getPart(partId);
        if (existingPart?.thumbnailUrl) {
          try {
            // Extract S3 key from the thumbnail URL
            const match = existingPart.thumbnailUrl.match(/part-thumbnails\/[^?]+/);
            if (match) {
              const s3Key = match[0];
              // Delete from S3
              await deleteFile(s3Key);
              // Delete attachment record
              const attachmentEventContext: AttachmentEventContext = {
                userId: user?.id,
                userEmail: user?.email || userDetails?.name || undefined,
              };
              await deleteAttachmentByS3Key(s3Key, attachmentEventContext);
            }
          } catch (error) {
            console.error('Failed to delete old thumbnail:', error);
          }
        }
        // Set thumbnailUrl to null to clear it from the part
        thumbnailUrl = null;
      }

      // Handle thumbnail upload if provided
      if (thumbnailFile && thumbnailFile.size > 0) {
        try {
          const arrayBuffer = await thumbnailFile.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const key = generateFileKey(customer.id, `part-thumbnail-${Date.now()}-${thumbnailFile.name}`);

          // Upload thumbnail to S3
          const uploadResult = await uploadFile({
            key,
            buffer,
            contentType: thumbnailFile.type || 'image/jpeg',
            fileName: thumbnailFile.name,
          });

          // Create public URL for the thumbnail
          thumbnailUrl = `/attachments/s3/${uploadResult.key}`;
        } catch (error) {
          console.error('Thumbnail upload error:', error);
          // Continue without updating thumbnail on error
        }
      }

      const updateData: Partial<PartInput> = {
        partName,
        material: material || null,
        tolerance: tolerance || null,
        finishing: finishing || null,
        notes: notes || null,
      };

      // Only update thumbnailUrl if a new one was uploaded
      if (thumbnailUrl !== undefined) {
        updateData.thumbnailUrl = thumbnailUrl;
      }

      const eventContext: PartEventContext = {
        userId: user?.id,
        userEmail: user?.email || userDetails?.name || undefined,
      };

      await updatePart(partId, updateData, eventContext);

      // TEMPORARY: Handle mesh file upload separately for updates
      if (meshFile && meshFile.size > 0) {
        try {
          const arrayBuffer = await meshFile.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          const key = generateFileKey(customer.id, `part-mesh-${partId}-${meshFile.name}`);

          // Upload to S3
          const uploadResult = await uploadFile({
            key,
            buffer,
            contentType: meshFile.type || 'model/stl',
            fileName: meshFile.name,
          });

          // Store the mesh URL in partMeshUrl
          const meshUrl = `/attachments/s3/${uploadResult.key}`;
          await updatePart(partId, { partMeshUrl: meshUrl }, eventContext);
        } catch (error) {
          console.error('Failed to upload mesh file:', error);
        }
      }

      return redirect(`/customers/${customerId}`);
    }

    return json({ error: "Invalid intent" }, { status: 400 });
  } catch (error) {
    return json({ error: `Failed to process part: ${error}` }, { status: 500 });
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  
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
    const intent = formData.get("intent") as string;
    
    // Check if this is a parts-related action
    if (intent === "createPart" || intent === "updatePart") {
      // Handle parts actions with multipart data
      return handlePartsAction(formData, intent, customer, customerId, user, userDetails);
    }
    
    // Otherwise, it's a regular file upload
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
      const key = generateFileKey(customer.id, file.name);

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

      // Link to customer
      await linkAttachmentToCustomer(customer.id, attachment.id, eventContext);

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
        const companyName = formData.get("companyName") as string;
        const contactName = formData.get("contactName") as string;
        const title = formData.get("title") as string;
        const email = formData.get("email") as string;
        const phone = formData.get("phone") as string;
        const isPrimaryContact = formData.get("isPrimaryContact") === "true";

        // Billing address
        const billingAddressLine1 = formData.get("billingAddressLine1") as string;
        const billingAddressLine2 = formData.get("billingAddressLine2") as string;
        const billingCity = formData.get("billingCity") as string;
        const billingState = formData.get("billingState") as string;
        const billingPostalCode = formData.get("billingPostalCode") as string;
        const billingCountry = formData.get("billingCountry") as string;

        // Shipping address
        const shippingAddressLine1 = formData.get("shippingAddressLine1") as string;
        const shippingAddressLine2 = formData.get("shippingAddressLine2") as string;
        const shippingCity = formData.get("shippingCity") as string;
        const shippingState = formData.get("shippingState") as string;
        const shippingPostalCode = formData.get("shippingPostalCode") as string;
        const shippingCountry = formData.get("shippingCountry") as string;

        // Business terms
        const paymentTerms = formData.get("paymentTerms") as string;

        const eventContext: CustomerEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const updated = await updateCustomer(customer.id, {
          displayName,
          companyName: companyName || null,
          contactName: contactName || null,
          title: title || null,
          email: email || null,
          phone: phone || null,
          isPrimaryContact,
          billingAddressLine1: billingAddressLine1 || null,
          billingAddressLine2: billingAddressLine2 || null,
          billingCity: billingCity || null,
          billingState: billingState || null,
          billingPostalCode: billingPostalCode || null,
          billingCountry: billingCountry || "US",
          shippingAddressLine1: shippingAddressLine1 || null,
          shippingAddressLine2: shippingAddressLine2 || null,
          shippingCity: shippingCity || null,
          shippingState: shippingState || null,
          shippingPostalCode: shippingPostalCode || null,
          shippingCountry: shippingCountry || "US",
          paymentTerms: paymentTerms || null,
        }, eventContext);

        return withAuthHeaders(json({ customer: updated }), headers);
      }

      case "archiveCustomer": {
        const eventContext: CustomerEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await archiveCustomer(customer.id, eventContext);
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

        const noteEventContext: NoteEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        const note = await createNote({
          entityType: "customer",
          entityId: customer.id.toString(),
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
        };

        // Unlink from customer first
        await unlinkAttachmentFromCustomer(customer.id, attachmentId, eventContext);

        // Delete from S3
        await deleteFile(attachment.s3Key);

        // Delete database record
        await deleteAttachment(attachmentId, eventContext);

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

      // Parts actions are now handled in the multipart section above
      // since they include file uploads

      case "deletePart": {
        const partId = formData.get("partId") as string;

        if (!partId) {
          return json({ error: "Missing part ID" }, { status: 400 });
        }

        const eventContext: PartEventContext = {
          userId: user?.id,
          userEmail: user?.email || userDetails?.name || undefined,
        };

        await archivePart(partId, eventContext);
        // Return a redirect to refresh the page
        return redirect(`/customers/${customerId}`);
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
  const { customer, orders, stats, notes, parts, user, userDetails, canUploadMesh, events, canRevise, bananaEnabled, bananaModelUrl } = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [isEditingContact, setIsEditingContact] = useState(false);
  const [isEditingBillingAddress, setIsEditingBillingAddress] = useState(false);
  const [isEditingShippingAddress, setIsEditingShippingAddress] = useState(false);
  const [fileModalOpen, setFileModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{ url: string; fileName: string; contentType?: string; fileSize?: number } | null>(null);
  const [showCompletedOrders, setShowCompletedOrders] = useState(true);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [partsModalOpen, setPartsModalOpen] = useState(false);
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [partsMode, setPartsMode] = useState<"create" | "edit">("create");
  const [part3DViewerOpen, setPart3DViewerOpen] = useState(false);
  const [selected3DPart, setSelected3DPart] = useState<Part | null>(null);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  const updateFetcher = useFetcher();
  const uploadFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  const partsFetcher = useFetcher();

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if any parts are currently converting
  const hasConvertingParts = parts?.some(
    (part: Part) =>
      part.meshConversionStatus === "in_progress" ||
      part.meshConversionStatus === "queued" ||
      part.meshConversionStatus === "pending"
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

  const handleSaveBillingAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateCustomer");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingBillingAddress(false);
  };

  const handleSaveShippingAddress = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    formData.append("intent", "updateCustomer");
    updateFetcher.submit(formData, { method: "post" });
    setIsEditingShippingAddress(false);
  };

  const handleCopyBillingToShipping = () => {
    // This will be handled by setting form values in the shipping address form
    const billingFields = {
      shippingAddressLine1: customer.billingAddressLine1 || '',
      shippingAddressLine2: customer.billingAddressLine2 || '',
      shippingCity: customer.billingCity || '',
      shippingState: customer.billingState || '',
      shippingPostalCode: customer.billingPostalCode || '',
      shippingCountry: customer.billingCountry || 'US',
    };

    // Submit the update
    const formData = new FormData();
    formData.append("intent", "updateCustomer");
    formData.append("displayName", customer.displayName);
    formData.append("companyName", customer.companyName || '');
    formData.append("contactName", customer.contactName || '');
    formData.append("title", customer.title || '');
    formData.append("email", customer.email || '');
    formData.append("phone", customer.phone || '');
    formData.append("isPrimaryContact", customer.isPrimaryContact ? 'true' : 'false');

    // Billing address
    formData.append("billingAddressLine1", customer.billingAddressLine1 || '');
    formData.append("billingAddressLine2", customer.billingAddressLine2 || '');
    formData.append("billingCity", customer.billingCity || '');
    formData.append("billingState", customer.billingState || '');
    formData.append("billingPostalCode", customer.billingPostalCode || '');
    formData.append("billingCountry", customer.billingCountry || 'US');

    // Shipping address (copied from billing)
    Object.entries(billingFields).forEach(([key, value]) => {
      formData.append(key, value);
    });

    formData.append("paymentTerms", customer.paymentTerms || '');

    updateFetcher.submit(formData, { method: "post" });
  };

  const handleCopyShippingToBilling = () => {
    // Copy shipping address fields to billing
    const formData = new FormData();
    formData.append("intent", "updateCustomer");
    formData.append("displayName", customer.displayName);
    formData.append("companyName", customer.companyName || '');
    formData.append("contactName", customer.contactName || '');
    formData.append("title", customer.title || '');
    formData.append("email", customer.email || '');
    formData.append("phone", customer.phone || '');
    formData.append("isPrimaryContact", customer.isPrimaryContact ? 'true' : 'false');
    formData.append("paymentTerms", customer.paymentTerms || '');

    // Billing address (copied from shipping)
    formData.append("billingAddressLine1", customer.shippingAddressLine1 || '');
    formData.append("billingAddressLine2", customer.shippingAddressLine2 || '');
    formData.append("billingCity", customer.shippingCity || '');
    formData.append("billingState", customer.shippingState || '');
    formData.append("billingPostalCode", customer.shippingPostalCode || '');
    formData.append("billingCountry", customer.shippingCountry || 'US');

    // Keep shipping address as is
    formData.append("shippingAddressLine1", customer.shippingAddressLine1 || '');
    formData.append("shippingAddressLine2", customer.shippingAddressLine2 || '');
    formData.append("shippingCity", customer.shippingCity || '');
    formData.append("shippingState", customer.shippingState || '');
    formData.append("shippingPostalCode", customer.shippingPostalCode || '');
    formData.append("shippingCountry", customer.shippingCountry || 'US');

    updateFetcher.submit(formData, { method: "post" });
  };

  // Add keyboard shortcuts for editing forms
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if we're in an editing mode
      if (!isEditingInfo && !isEditingContact && !isEditingBillingAddress && !isEditingShippingAddress) return;

      // Handle Escape key to cancel
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsEditingInfo(false);
        setIsEditingContact(false);
        setIsEditingBillingAddress(false);
        setIsEditingShippingAddress(false);
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

        if (isEditingBillingAddress) {
          const form = document.querySelector('form[data-editing="billing"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateCustomer");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingBillingAddress(false);
          }
        }

        if (isEditingShippingAddress) {
          const form = document.querySelector('form[data-editing="shipping"]') as HTMLFormElement;
          if (form) {
            const formData = new FormData(form);
            formData.append("intent", "updateCustomer");
            updateFetcher.submit(formData, { method: "post" });
            setIsEditingShippingAddress(false);
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isEditingInfo, isEditingContact, isEditingBillingAddress, isEditingShippingAddress, updateFetcher]);

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

  const handleAddPart = () => {
    setSelectedPart(null);
    setPartsMode("create");
    setPartsModalOpen(true);
  };

  const handleEditPart = (part: Part) => {
    setSelectedPart(part);
    setPartsMode("edit");
    setPartsModalOpen(true);
  };

  const handleView3DPart = (part: Part) => {
    setSelected3DPart(part);
    setPart3DViewerOpen(true);
  };

  const handleDeletePart = (partId: string) => {
    if (confirm("Are you sure you want to delete this part?")) {
      const formData = new FormData();
      formData.append("intent", "deletePart");
      formData.append("partId", partId);
      
      partsFetcher.submit(formData, {
        method: "post",
      });
    }
  };

  const handlePartSubmit = (data: {
    partName: string;
    material: string;
    tolerance: string;
    finishing: string;
    notes: string;
    modelFile?: File;
    meshFile?: File; // TEMPORARY
    thumbnailFile?: File;
    deleteThumbnail?: boolean;
  }) => {
    const formData = new FormData();
    const intent = partsMode === "create" ? "createPart" : "updatePart";
    formData.append("intent", intent);
    formData.append("partName", data.partName);
    formData.append("material", data.material);
    formData.append("tolerance", data.tolerance);
    formData.append("finishing", data.finishing);
    formData.append("notes", data.notes);
    
    if (partsMode === "edit" && selectedPart) {
      formData.append("partId", selectedPart.id);
    }
    
    if (data.modelFile) {
      formData.append("modelFile", data.modelFile);
    }
    
    if (data.meshFile) {
      formData.append("meshFile", data.meshFile); // TEMPORARY
    }
    
    if (data.thumbnailFile) {
      formData.append("thumbnailFile", data.thumbnailFile);
    }
    
    if (data.deleteThumbnail) {
      formData.append("deleteThumbnail", "true");
    }
    
    partsFetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
    
    setPartsModalOpen(false);
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

          {/* Information Sections - 2x2 Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Company Information */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Company Information</h3>
                {!isEditingInfo && (
                  <Button size="sm" onClick={() => setIsEditingInfo(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingInfo ? (
                  <updateFetcher.Form onSubmit={handleSaveInfo} data-editing="info">
                    <div className="space-y-4">
                      <input type="hidden" name="displayName" value={customer.displayName} />
                      <input type="hidden" name="email" value={customer.email || ""} />
                      <input type="hidden" name="phone" value={customer.phone || ""} />
                      <input type="hidden" name="title" value={customer.title || ""} />
                      <input type="hidden" name="isPrimaryContact" value={customer.isPrimaryContact ? "true" : "false"} />
                      <input type="hidden" name="billingAddressLine1" value={customer.billingAddressLine1 || ""} />
                      <input type="hidden" name="billingAddressLine2" value={customer.billingAddressLine2 || ""} />
                      <input type="hidden" name="billingCity" value={customer.billingCity || ""} />
                      <input type="hidden" name="billingState" value={customer.billingState || ""} />
                      <input type="hidden" name="billingPostalCode" value={customer.billingPostalCode || ""} />
                      <input type="hidden" name="billingCountry" value={customer.billingCountry || "US"} />
                      <input type="hidden" name="shippingAddressLine1" value={customer.shippingAddressLine1 || ""} />
                      <input type="hidden" name="shippingAddressLine2" value={customer.shippingAddressLine2 || ""} />
                      <input type="hidden" name="shippingCity" value={customer.shippingCity || ""} />
                      <input type="hidden" name="shippingState" value={customer.shippingState || ""} />
                      <input type="hidden" name="shippingPostalCode" value={customer.shippingPostalCode || ""} />
                      <input type="hidden" name="shippingCountry" value={customer.shippingCountry || "US"} />

                      <FormField
                        label="Company Name"
                        name="companyName"
                        defaultValue={customer.companyName || ""}
                        placeholder="Acme Manufacturing"
                      />
                      <FormField
                        label="Payment Terms"
                        name="paymentTerms"
                        defaultValue={customer.paymentTerms || ""}
                        placeholder="NET 30, Due on Receipt, etc."
                      />
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
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Company Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.companyName || customer.displayName}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Customer ID</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">CUST-{customer.id.toString().padStart(5, '0')}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Payment Terms</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.paymentTerms || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Status</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.isArchived ? 'Inactive' : 'Active'}</p>
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
                  <Button size="sm" onClick={() => setIsEditingContact(true)}>
                    Edit
                  </Button>
                )}
              </div>
              <div className="p-6">
                {isEditingContact ? (
                  <updateFetcher.Form onSubmit={handleSaveContact} data-editing="contact">
                    <div className="space-y-4">
                      <input type="hidden" name="displayName" value={customer.displayName} />
                      <input type="hidden" name="companyName" value={customer.companyName || ""} />
                      <input type="hidden" name="paymentTerms" value={customer.paymentTerms || ""} />
                      <input type="hidden" name="billingAddressLine1" value={customer.billingAddressLine1 || ""} />
                      <input type="hidden" name="billingAddressLine2" value={customer.billingAddressLine2 || ""} />
                      <input type="hidden" name="billingCity" value={customer.billingCity || ""} />
                      <input type="hidden" name="billingState" value={customer.billingState || ""} />
                      <input type="hidden" name="billingPostalCode" value={customer.billingPostalCode || ""} />
                      <input type="hidden" name="billingCountry" value={customer.billingCountry || "US"} />
                      <input type="hidden" name="shippingAddressLine1" value={customer.shippingAddressLine1 || ""} />
                      <input type="hidden" name="shippingAddressLine2" value={customer.shippingAddressLine2 || ""} />
                      <input type="hidden" name="shippingCity" value={customer.shippingCity || ""} />
                      <input type="hidden" name="shippingState" value={customer.shippingState || ""} />
                      <input type="hidden" name="shippingPostalCode" value={customer.shippingPostalCode || ""} />
                      <input type="hidden" name="shippingCountry" value={customer.shippingCountry || "US"} />

                      <FormField
                        label="Contact Name"
                        name="contactName"
                        defaultValue={customer.contactName || ""}
                        placeholder="John Smith"
                      />
                      <FormField
                        label="Job Title"
                        name="title"
                        defaultValue={customer.title || ""}
                        placeholder="Purchasing Manager"
                      />
                      <FormField
                        label="Email"
                        name="email"
                        type="email"
                        defaultValue={customer.email || ""}
                        placeholder="john@company.com"
                      />
                      <PhoneInputField
                        label="Phone"
                        name="phone"
                        defaultValue={customer.phone || ""}
                      />
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          id="isPrimaryContact"
                          name="isPrimaryContact"
                          defaultChecked={customer.isPrimaryContact}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                        <label htmlFor="isPrimaryContact" className="ml-2 block text-sm text-gray-900 dark:text-gray-100">
                          Primary Contact
                        </label>
                      </div>
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
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Contact Name</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.contactName || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Job Title</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.title || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Email</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.email || "--"}</p>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">Phone</p>
                      <p className="text-lg text-gray-900 dark:text-gray-100">{customer.phone || "--"}</p>
                    </div>
                    {customer.isPrimaryContact && (
                      <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
                        <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm font-medium">Primary Contact</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Address Sections - 2x2 Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
                  <updateFetcher.Form onSubmit={handleSaveBillingAddress} data-editing="billing">
                    <div className="space-y-4">
                      <input type="hidden" name="displayName" value={customer.displayName} />
                      <input type="hidden" name="companyName" value={customer.companyName || ""} />
                      <input type="hidden" name="contactName" value={customer.contactName || ""} />
                      <input type="hidden" name="title" value={customer.title || ""} />
                      <input type="hidden" name="email" value={customer.email || ""} />
                      <input type="hidden" name="phone" value={customer.phone || ""} />
                      <input type="hidden" name="isPrimaryContact" value={customer.isPrimaryContact ? "true" : "false"} />
                      <input type="hidden" name="paymentTerms" value={customer.paymentTerms || ""} />
                      <input type="hidden" name="shippingAddressLine1" value={customer.shippingAddressLine1 || ""} />
                      <input type="hidden" name="shippingAddressLine2" value={customer.shippingAddressLine2 || ""} />
                      <input type="hidden" name="shippingCity" value={customer.shippingCity || ""} />
                      <input type="hidden" name="shippingState" value={customer.shippingState || ""} />
                      <input type="hidden" name="shippingPostalCode" value={customer.shippingPostalCode || ""} />
                      <input type="hidden" name="shippingCountry" value={customer.shippingCountry || "US"} />

                      <FormField
                        label="Address Line 1"
                        name="billingAddressLine1"
                        defaultValue={customer.billingAddressLine1 || ""}
                        placeholder="123 Main Street"
                      />
                      <FormField
                        label="Address Line 2"
                        name="billingAddressLine2"
                        defaultValue={customer.billingAddressLine2 || ""}
                        placeholder="Suite 100 (optional)"
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label="City"
                          name="billingCity"
                          defaultValue={customer.billingCity || ""}
                          placeholder="San Francisco"
                        />
                        <FormField
                          label="State"
                          name="billingState"
                          defaultValue={customer.billingState || ""}
                          placeholder="CA"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label="ZIP Code"
                          name="billingPostalCode"
                          defaultValue={customer.billingPostalCode || ""}
                          placeholder="94102"
                        />
                        <FormField
                          label="Country"
                          name="billingCountry"
                          defaultValue={customer.billingCountry || "US"}
                          placeholder="US"
                        />
                      </div>
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
                  <div className="space-y-2">
                    {extractBillingAddress(customer).line1 ? (
                      <div className="whitespace-pre-line text-gray-900 dark:text-gray-100">
                        {formatAddress(extractBillingAddress(customer))}
                      </div>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400">No billing address set</p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Shipping Address */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Shipping Address</h3>
                <div className="flex gap-2">
                  {extractBillingAddress(customer).line1 && !isEditingShippingAddress && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleCopyBillingToShipping}
                      title="Copy billing address to shipping"
                    >
                      Copy from Billing
                    </Button>
                  )}
                  {!isEditingShippingAddress && (
                    <Button size="sm" onClick={() => setIsEditingShippingAddress(true)}>
                      Edit
                    </Button>
                  )}
                </div>
              </div>
              <div className="p-6">
                {isEditingShippingAddress ? (
                  <updateFetcher.Form onSubmit={handleSaveShippingAddress} data-editing="shipping">
                    <div className="space-y-4">
                      <input type="hidden" name="displayName" value={customer.displayName} />
                      <input type="hidden" name="companyName" value={customer.companyName || ""} />
                      <input type="hidden" name="contactName" value={customer.contactName || ""} />
                      <input type="hidden" name="title" value={customer.title || ""} />
                      <input type="hidden" name="email" value={customer.email || ""} />
                      <input type="hidden" name="phone" value={customer.phone || ""} />
                      <input type="hidden" name="isPrimaryContact" value={customer.isPrimaryContact ? "true" : "false"} />
                      <input type="hidden" name="paymentTerms" value={customer.paymentTerms || ""} />
                      <input type="hidden" name="billingAddressLine1" value={customer.billingAddressLine1 || ""} />
                      <input type="hidden" name="billingAddressLine2" value={customer.billingAddressLine2 || ""} />
                      <input type="hidden" name="billingCity" value={customer.billingCity || ""} />
                      <input type="hidden" name="billingState" value={customer.billingState || ""} />
                      <input type="hidden" name="billingPostalCode" value={customer.billingPostalCode || ""} />
                      <input type="hidden" name="billingCountry" value={customer.billingCountry || "US"} />

                      <FormField
                        label="Address Line 1"
                        name="shippingAddressLine1"
                        defaultValue={customer.shippingAddressLine1 || ""}
                        placeholder="123 Main Street"
                      />
                      <FormField
                        label="Address Line 2"
                        name="shippingAddressLine2"
                        defaultValue={customer.shippingAddressLine2 || ""}
                        placeholder="Suite 100 (optional)"
                      />
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label="City"
                          name="shippingCity"
                          defaultValue={customer.shippingCity || ""}
                          placeholder="San Francisco"
                        />
                        <FormField
                          label="State"
                          name="shippingState"
                          defaultValue={customer.shippingState || ""}
                          placeholder="CA"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <FormField
                          label="ZIP Code"
                          name="shippingPostalCode"
                          defaultValue={customer.shippingPostalCode || ""}
                          placeholder="94102"
                        />
                        <FormField
                          label="Country"
                          name="shippingCountry"
                          defaultValue={customer.shippingCountry || "US"}
                          placeholder="US"
                        />
                      </div>
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
                  <div className="space-y-2">
                    {extractShippingAddress(customer).line1 ? (
                      <div className="whitespace-pre-line text-gray-900 dark:text-gray-100">
                        {formatAddress(extractShippingAddress(customer))}
                      </div>
                    ) : (
                      <p className="text-gray-500 dark:text-gray-400">No shipping address set</p>
                    )}
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
                  entityType="customer"
                  entityId={customer.id.toString()}
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
              entityType="customer"
              entityId={customer.id.toString()}
              entityName={customer.displayName}
              initialEvents={events}
            />
          </div>

          {/* Attachments Card */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Attachments</h3>
              <Button size="sm" onClick={handleFileUpload}>Upload File</Button>
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

          {/* Parts Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700">
            <div className="bg-gray-100 dark:bg-gray-700 px-6 py-4 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">Parts</h3>
              <Button size="sm" onClick={handleAddPart}>Add Part</Button>
            </div>
            <div className="p-6">
              {parts && parts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                    <thead className="bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Part
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Material
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Tolerance
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Finishing
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
                          Created
                        </th>
                        <th className="px-6 py-3 w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                      {parts.map((part: Part & { signedMeshUrl?: string }) => {
                        // Show spinner if:
                        // 1. Conversion is in progress
                        // 2. Conversion completed but thumbnail not generated yet
                        // 3. Thumbnail exists but signed URL not loaded yet
                        // 4. Part has file but no conversion status
                        const isProcessing =
                          part.meshConversionStatus === "in_progress" ||
                          part.meshConversionStatus === "queued" ||
                          part.meshConversionStatus === "pending" ||
                          (part.meshConversionStatus === "completed" && !part.thumbnailUrl) ||
                          (part.partFileUrl && !part.meshConversionStatus);

                        return (
                          <tr key={part.id}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                {part.thumbnailUrl ? (
                                  <button
                                    onClick={() => handleView3DPart(part)}
                                    className="h-10 w-10 p-0 border-2 border-gray-300 dark:border-blue-500 bg-white dark:bg-gray-800 rounded-lg cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition-all"
                                    title="View 3D model"
                                    type="button"
                                  >
                                    <img
                                      src={part.thumbnailUrl}
                                      alt={`${part.partName} thumbnail`}
                                      className="h-full w-full object-cover rounded-lg hover:opacity-90 transition-opacity"
                                    />
                                  </button>
                                ) : (
                                  <div className="h-10 w-10 bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center flex-shrink-0">
                                    {isProcessing ? (
                                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
                                    ) : (
                                      <button
                                        onClick={() => handleView3DPart(part)}
                                        className="h-full w-full flex items-center justify-center cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors rounded-lg border-0 p-0"
                                        title="View 3D model"
                                        type="button"
                                      >
                                        <svg
                                          className="h-5 w-5 text-gray-400 dark:text-gray-500"
                                          fill="none"
                                          stroke="currentColor"
                                          viewBox="0 0 24 24"
                                        >
                                          <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                          />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                )}
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {part.partName || "--"}
                                </span>
                              </div>
                            </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {part.material || "--"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {part.tolerance || "--"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {part.finishing || "--"}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                            {new Date(part.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <button
                                onClick={() => handleEditPart(part)}
                                className="p-1.5 text-white bg-blue-600 rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 transition-colors duration-150"
                                title="Edit"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  fill="currentColor"
                                  viewBox="0 0 16 16"
                                >
                                  <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z"/>
                                </svg>
                              </button>
                              <button
                                onClick={() => handleDeletePart(part.id)}
                                className="p-1.5 text-white bg-red-600 rounded hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 transition-colors duration-150"
                                title="Delete"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  width="16"
                                  height="16"
                                  fill="currentColor"
                                  viewBox="0 0 16 16"
                                >
                                  <path d="M12.643 15C13.979 15 15 13.845 15 12.5V5H1v7.5C1 13.845 2.021 15 3.357 15h9.286zM5.5 7h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1 0-1zM.8 1a.8.8 0 0 0-.8.8V3a.8.8 0 0 0 .8.8h14.4A.8.8 0 0 0 16 3V1.8a.8.8 0 0 0-.8-.8H.8z"/>
                                </svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                  No parts added yet.
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
      
      {/* Parts Modal */}
      <PartsModal
        isOpen={partsModalOpen}
        onClose={() => setPartsModalOpen(false)}
        onSubmit={handlePartSubmit}
        part={selectedPart}
        mode={partsMode}
        canUploadMesh={canUploadMesh}
      />
      
      {/* 3D Viewer Modal */}
      <Part3DViewerModal
        isOpen={part3DViewerOpen}
        onClose={() => {
          setPart3DViewerOpen(false);
          setSelected3DPart(null);
        }}
        partName={selected3DPart?.partName || undefined}
        modelUrl={selected3DPart?.partMeshUrl || undefined}
        solidModelUrl={selected3DPart?.partFileUrl || undefined}
        partId={selected3DPart?.id}
        entityType="part"
        cadFileUrl={selected3DPart?.partFileUrl || undefined}
        canRevise={canRevise}
        onThumbnailUpdate={() => {
          revalidator.revalidate();
        }}
        onRevisionComplete={() => {
          revalidator.revalidate();
        }}
        autoGenerateThumbnail={true}
        existingThumbnailUrl={selected3DPart?.thumbnailUrl || undefined}
        bananaEnabled={bananaEnabled}
        bananaModelUrl={bananaModelUrl || undefined}
      />

      {/* Hidden Thumbnail Generators for parts without thumbnails */}
      {parts?.map((part: Part & { signedMeshUrl?: string }) => {
        if (
          part.signedMeshUrl &&
          part.meshConversionStatus === "completed" &&
          !part.thumbnailUrl
        ) {
          return (
            <HiddenThumbnailGenerator
              key={part.id}
              modelUrl={part.signedMeshUrl}
              partId={part.id}
              entityType="part"
              onComplete={() => {
                revalidator.revalidate();
              }}
            />
          );
        }
        return null;
      })}
    </div>
  );
}