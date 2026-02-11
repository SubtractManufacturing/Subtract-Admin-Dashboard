import { useState, useEffect, useCallback } from "react";
import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { createServerClient } from "~/lib/supabase";
import Button from "~/components/shared/Button";
import { InputField } from "~/components/shared/FormField";
import {
  getAllFeatureFlags,
  updateFeatureFlag,
  initializeFeatureFlags,
  isFeatureEnabled,
  FEATURE_FLAGS,
} from "~/lib/featureFlags";
import { getBananaModelUrls, setBananaModelUrls, getReconciliationTaskConfig } from "~/lib/developerSettings";
import {
  getAllSendAsAddresses,
  addSendAsAddress,
  deleteSendAsAddress,
  setDefaultSendAsAddress,
  sendAsAddressExists,
} from "~/lib/emailSendAsAddresses";
import { ReconciliationTaskRegistry } from "~/lib/reconciliation/types";
import type { FeatureFlag, EmailSendAsAddress } from "~/lib/db/schema";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();

  // Initialize feature flags if needed
  await initializeFeatureFlags();

  // Get feature flags for developer and admin users
  const featureFlags =
    userDetails.role === "Dev" || userDetails.role === "Admin"
      ? await getAllFeatureFlags()
      : [];

  // Check for success message in URL
  const url = new URL(request.url);
  const message = url.searchParams.get("message");

  // Get banana model status for Dev users
  const bananaForScaleEnabled =
    userDetails.role === "Dev"
      ? await isFeatureEnabled(FEATURE_FLAGS.BANANA_FOR_SCALE)
      : false;
  const bananaModelStatus =
    bananaForScaleEnabled && userDetails.role === "Dev"
      ? await getBananaModelUrls()
      : null;

  // Get email integration status and addresses for Admin/Dev users
  const emailIntegrationEnabled =
    (userDetails.role === "Admin" || userDetails.role === "Dev")
      ? await isFeatureEnabled(FEATURE_FLAGS.EMAIL_SEND_DEV)
      : false;
  const emailSendAsAddresses =
    emailIntegrationEnabled ? await getAllSendAsAddresses() : [];
  
  // Get email configuration (for Postmark)
  const { 
    getEmailReplyToAddress, 
    getEmailOutboundBccAddress,
    getEmailInboundForwardAddress 
  } = await import("~/lib/developerSettings");
  
  const emailReplyToAddress =
    emailIntegrationEnabled ? await getEmailReplyToAddress() : null;
  const emailOutboundBccAddress =
    emailIntegrationEnabled ? await getEmailOutboundBccAddress() : null;
  const emailInboundForwardAddress =
    emailIntegrationEnabled ? await getEmailInboundForwardAddress() : null;

  // Get reconciliation tasks config for Dev users
  const reconciliationTasks =
    userDetails.role === "Dev"
      ? await Promise.all(
          ReconciliationTaskRegistry.getAll().map(async (task) => {
            const config = await getReconciliationTaskConfig(task.id);
            return {
              id: task.id,
              name: task.name,
              description: task.description,
              enabled: config.enabled,
              cron: config.cron,
              windowHours: config.windowHours,
            };
          })
        )
      : [];

  return withAuthHeaders(
    json({
      user,
      userDetails,
      message,
      appConfig,
      featureFlags,
      bananaForScaleEnabled,
      bananaModelStatus,
      emailIntegrationEnabled,
      emailSendAsAddresses,
      emailReplyToAddress,
      emailOutboundBccAddress,
      emailInboundForwardAddress,
      reconciliationTasks,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const { supabase, headers } = createServerClient(request);

  // Handle banana model upload (multipart form data)
  // MUST come before request.formData() which consumes the body
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    const uploadHandler = unstable_createMemoryUploadHandler({
      maxPartSize: 50 * 1024 * 1024, // 50MB for CAD files
    });

    const formData = await unstable_parseMultipartFormData(request, uploadHandler);
    const intent = formData.get("intent");

    if (intent === "uploadBananaModel" && userDetails.role === "Dev") {
      const file = formData.get("file") as File;

      if (!file) {
        return withAuthHeaders(
          json({ error: "No file provided" }, { status: 400 }),
          headers
        );
      }

      try {
        const {
          detectFileFormat,
          getRecommendedOutputFormat,
          validateFileSize,
          isConversionEnabled,
          submitConversion,
          pollForCompletion,
          downloadConversionResult,
        } = await import("~/lib/conversion-service.server");

        const { uploadFile, uploadToS3 } = await import("~/lib/s3.server");

        // Validate file type
        const format = detectFileFormat(file.name);
        if (format !== "brep") {
          return withAuthHeaders(
            json({
              error: "Invalid file format. Please upload a STEP (.step, .stp) or IGES (.iges, .igs) file"
            }, { status: 400 }),
            headers
          );
        }

        // Convert File to Buffer
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Validate file size
        const sizeCheck = validateFileSize(buffer.length);
        if (!sizeCheck.valid) {
          return withAuthHeaders(
            json({ error: sizeCheck.message }, { status: 400 }),
            headers
          );
        }

        // Update status to uploading
        await setBananaModelUrls({ conversionStatus: "uploading" }, user.email);

        // Upload CAD file to S3
        const timestamp = Date.now();
        const sanitizedFileName = file.name.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9._-]/g, "");
        const cadKey = `developer/banana/source/${timestamp}-${sanitizedFileName}`;

        await uploadFile({
          key: cadKey,
          buffer,
          contentType: "application/octet-stream",
          fileName: sanitizedFileName,
        });

        // Save CAD URL
        await setBananaModelUrls({
          cadUrl: cadKey,
          conversionStatus: "converting"
        }, user.email);

        // Check if conversion service is available
        if (!isConversionEnabled()) {
          await setBananaModelUrls({ conversionStatus: "conversion_unavailable" }, user.email);
          return withAuthHeaders(
            json({
              success: true,
              cadUrl: cadKey,
              message: "CAD file uploaded, but conversion service is not available"
            }),
            headers
          );
        }

        // Submit for conversion
        const conversionOptions = {
          output_format: getRecommendedOutputFormat(),
          deflection: 0.1,
          angular_deflection: 0.5,
          async_processing: true,
        };

        const conversionJob = await submitConversion(buffer, sanitizedFileName, conversionOptions);

        if (!conversionJob) {
          await setBananaModelUrls({ conversionStatus: "conversion_failed" }, user.email);
          return withAuthHeaders(
            json({
              success: false,
              error: "Failed to submit file for conversion"
            }, { status: 500 }),
            headers
          );
        }

        // Poll for completion
        const completedJob = await pollForCompletion(conversionJob.job_id);

        if (!completedJob || completedJob.status === "failed") {
          const error = completedJob?.error || "Conversion failed";
          await setBananaModelUrls({ conversionStatus: "conversion_failed" }, user.email);
          return withAuthHeaders(
            json({
              success: false,
              error: `Conversion failed: ${error}`
            }, { status: 500 }),
            headers
          );
        }

        // Download converted mesh
        const result = await downloadConversionResult(conversionJob.job_id);

        if (!result) {
          await setBananaModelUrls({ conversionStatus: "conversion_failed" }, user.email);
          return withAuthHeaders(
            json({
              success: false,
              error: "Failed to download converted mesh"
            }, { status: 500 }),
            headers
          );
        }

        // Upload mesh to S3
        const sanitizedMeshFilename = result.filename
          .replace(/\s+/g, "-")
          .replace(/[^a-zA-Z0-9._-]/g, "");
        const meshKey = `developer/banana/mesh/${timestamp}-${sanitizedMeshFilename}`;

        const meshContentType = result.filename.endsWith(".glb")
          ? "model/gltf-binary"
          : result.filename.endsWith(".gltf")
          ? "model/gltf+json"
          : "application/octet-stream";

        const meshUrl = await uploadToS3(result.buffer, meshKey, meshContentType);

        if (!meshUrl) {
          await setBananaModelUrls({ conversionStatus: "upload_failed" }, user.email);
          return withAuthHeaders(
            json({
              success: false,
              error: "Failed to upload converted mesh"
            }, { status: 500 }),
            headers
          );
        }

        // Save mesh URL
        await setBananaModelUrls({
          meshUrl: meshKey,
          conversionStatus: "completed"
        }, user.email);

        return withAuthHeaders(
          json({
            success: true,
            cadUrl: cadKey,
            meshUrl: meshKey,
            message: "Banana model uploaded and converted successfully"
          }),
          headers
        );

      } catch (error) {
        console.error("Error uploading banana model:", error);
        await setBananaModelUrls({ conversionStatus: "error" }, user?.email);
        return withAuthHeaders(
          json({
            error: error instanceof Error ? error.message : "Failed to upload banana model"
          }, { status: 500 }),
          headers
        );
      }
    }

    // Unrecognized multipart intent
    return withAuthHeaders(
      json({ error: "Invalid multipart intent" }, { status: 400 }),
      headers
    );
  }

  // Regular form data handling (existing logic)
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (
    intent === "saveFeatureFlags" &&
    (userDetails.role === "Dev" || userDetails.role === "Admin")
  ) {
    const flagsJson = formData.get("flags") as string;

    try {
      const flags = JSON.parse(flagsJson);

      // Update all flags
      for (const flag of flags) {
        await updateFeatureFlag(flag.key, flag.enabled, user.id);
      }

      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to update feature flags" }, { status: 400 }),
        headers
      );
    }
  }

  if (intent === "updateProfile") {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;

    try {
      // Check if anything actually changed
      const emailChanged = email !== user.email;
      const nameChanged = name !== userDetails.name;

      if (!emailChanged && !nameChanged) {
        return withAuthHeaders(
          json({ success: true, message: "No changes to save" }),
          headers
        );
      }

      // Build updates object
      const updates: { data?: { name: string; full_name: string } } = {};

      // Always update metadata if name changed
      if (nameChanged) {
        updates.data = {
          name,
          full_name: name, // This will show in Supabase Dashboard's "Display Name"
        };
      }

      // Simplify: just try to update and handle the response
      const { data: updatedUser, error: updateError } =
        await supabase.auth.updateUser(updates);

      if (updateError) {
        // Check if this is an email change that requires confirmation
        // Supabase may return success even when email confirmation is required
        if (
          emailChanged &&
          (updateError.message.includes("Email") ||
            updateError.message.includes("email"))
        ) {
          return withAuthHeaders(
            json({
              success: true,
              message:
                "A confirmation email has been sent to your new email address. Please check your inbox to confirm the change.",
            }),
            headers
          );
        }

        return withAuthHeaders(
          json(
            { error: `Failed to update profile: ${updateError.message}` },
            { status: 400 }
          ),
          headers
        );
      }

      // Check if email change is pending confirmation
      // Supabase doesn't always return an error for email changes that require confirmation
      if (emailChanged) {
        // Check if the email actually changed in the response
        const emailActuallyChanged = updatedUser?.user?.email === email;

        if (!emailActuallyChanged) {
          // Email didn't change immediately, so confirmation is required
          return withAuthHeaders(
            json({
              success: true,
              message:
                "A confirmation email has been sent to verify your new email address. Please check your inbox.",
            }),
            headers
          );
        }
      }

      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to update profile" }, { status: 400 }),
        headers
      );
    }
  }

  if (intent === "resetPassword") {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email!, {
        redirectTo: `${
          new URL(request.url).origin
        }/auth/callback?type=recovery`,
      });

      if (error) {
        return withAuthHeaders(
          json(
            { error: `Failed to send reset email: ${error.message}` },
            { status: 400 }
          ),
          headers
        );
      }

      return withAuthHeaders(
        json({
          success: true,
          message: "Password reset email sent! Check your inbox.",
        }),
        headers
      );
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to send password reset email" }, { status: 400 }),
        headers
      );
    }
  }

  // Email "Send As" address management (Dev only)
  if (intent === "addEmailSendAs" && userDetails.role === "Dev") {
    const email = formData.get("email") as string;
    const label = formData.get("label") as string;

    if (!email || !label) {
      return withAuthHeaders(
        json({ error: "Email and label are required" }, { status: 400 }),
        headers
      );
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return withAuthHeaders(
        json({ error: "Invalid email format" }, { status: 400 }),
        headers
      );
    }

    // Check if address already exists in our database
    const exists = await sendAsAddressExists(email);
    if (exists) {
      return withAuthHeaders(
        json({ error: "This email address already exists" }, { status: 400 }),
        headers
      );
    }

    // Validate that the address is properly formatted for Postmark
    try {
      const { validateSenderAddress } = await import(
        "~/lib/postmark/postmark-client.server"
      );
      const validation = validateSenderAddress(email);

      if (!validation.valid) {
        return withAuthHeaders(
          json({
            error: validation.warning || "Invalid email address format",
          }, { status: 400 }),
          headers
        );
      }
      // Log a reminder about Postmark Sender Signatures
      if (validation.warning) {
        console.log("Postmark reminder:", validation.warning);
      }
    } catch (validationError) {
      // If validation fails, still allow adding but warn
      console.error("Email validation failed:", validationError);
      // Continue without blocking - the address might still work
    }

    try {
      await addSendAsAddress(email, label, user.id);
      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to add email address" }, { status: 500 }),
        headers
      );
    }
  }

  if (intent === "deleteEmailSendAs" && userDetails.role === "Dev") {
    const id = formData.get("id") as string;

    if (!id) {
      return withAuthHeaders(
        json({ error: "Address ID is required" }, { status: 400 }),
        headers
      );
    }

    try {
      const result = await deleteSendAsAddress(parseInt(id));
      if (!result.success) {
        return withAuthHeaders(
          json({ error: result.error }, { status: 400 }),
          headers
        );
      }
      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to delete email address" }, { status: 500 }),
        headers
      );
    }
  }

  // Update email reply-to address (for Postmark inbound routing)
  if (intent === "updateEmailReplyTo" && userDetails.role === "Dev") {
    const replyToAddress = formData.get("replyToAddress") as string;

    try {
      // Basic email validation
      if (replyToAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToAddress)) {
        return withAuthHeaders(
          json({ error: "Invalid email address format" }, { status: 400 }),
          headers
        );
      }

      const { setEmailReplyToAddress } = await import("~/lib/developerSettings");
      await setEmailReplyToAddress(replyToAddress || null, user.id);
      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to update reply-to address" }, { status: 500 }),
        headers
      );
    }
  }

  // Update outbound BCC address (Gmail mirroring for sent emails)
  if (intent === "updateOutboundBcc" && userDetails.role === "Dev") {
    const bccAddress = formData.get("bccAddress") as string;

    try {
      // Basic email validation
      if (bccAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bccAddress)) {
        return withAuthHeaders(
          json({ error: "Invalid email address format" }, { status: 400 }),
          headers
        );
      }

      const { setEmailOutboundBccAddress } = await import("~/lib/developerSettings");
      await setEmailOutboundBccAddress(bccAddress || null, user.id);
      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to update outbound BCC address" }, { status: 500 }),
        headers
      );
    }
  }

  // Update inbound forward address (Gmail mirroring for received emails)
  if (intent === "updateInboundForward" && userDetails.role === "Dev") {
    const forwardAddress = formData.get("forwardAddress") as string;

    try {
      // Basic email validation
      if (forwardAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(forwardAddress)) {
        return withAuthHeaders(
          json({ error: "Invalid email address format" }, { status: 400 }),
          headers
        );
      }

      const { setEmailInboundForwardAddress } = await import("~/lib/developerSettings");
      await setEmailInboundForwardAddress(forwardAddress || null, user.id);
      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to update inbound forward address" }, { status: 500 }),
        headers
      );
    }
  }

  if (intent === "setDefaultEmailSendAs" && userDetails.role === "Dev") {
    const id = formData.get("id") as string;

    if (!id) {
      return withAuthHeaders(
        json({ error: "Address ID is required" }, { status: 400 }),
        headers
      );
    }

    try {
      await setDefaultSendAsAddress(parseInt(id));
      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to set default address" }, { status: 500 }),
        headers
      );
    }
  }

  // Update Reply-To for a specific Send As address
  if (intent === "updateSendAsReplyTo" && userDetails.role === "Dev") {
    const id = formData.get("id") as string;
    const replyToAddress = formData.get("replyToAddress") as string;

    if (!id) {
      return withAuthHeaders(
        json({ error: "Address ID is required" }, { status: 400 }),
        headers
      );
    }

    // Basic email validation (allow empty to clear)
    if (replyToAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyToAddress)) {
      return withAuthHeaders(
        json({ error: "Invalid email address format" }, { status: 400 }),
        headers
      );
    }

    try {
      const { updateSendAsAddress } = await import("~/lib/emailSendAsAddresses");
      await updateSendAsAddress(parseInt(id), {
        replyToAddress: replyToAddress || null,
      });
      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to update reply-to address" }, { status: 500 }),
        headers
      );
    }
  }

  // Update reconciliation task settings
  if (intent === "updateReconciliationTask" && userDetails.role === "Dev") {
    const taskId = formData.get("taskId") as string;
    const enabled = formData.get("enabled") === "true";
    const cronSchedule = formData.get("cron") as string;
    const windowHours = formData.get("windowHours") as string;

    if (!taskId) {
      return withAuthHeaders(
        json({ error: "Task ID is required" }, { status: 400 }),
        headers
      );
    }

    // Validate cron syntax
    const cron = await import("node-cron");
    if (cronSchedule && !cron.validate(cronSchedule)) {
      return withAuthHeaders(
        json({ error: "Invalid cron syntax. Use format like '0 */6 * * *'" }, { status: 400 }),
        headers
      );
    }

    try {
      // Save settings
      const { setReconciliationTaskConfig } = await import("~/lib/developerSettings");
      await setReconciliationTaskConfig(
        taskId,
        {
          enabled,
          cron: cronSchedule,
          windowHours: parseInt(windowHours) || 72,
        },
        user.id
      );

      // Restart scheduler with new config
      const { ReconciliationScheduler } = await import("~/lib/reconciliation/scheduler.server");
      await ReconciliationScheduler.getInstance().restartTask(taskId);

      return withAuthHeaders(json({ success: true }), headers);
    } catch (error) {
      return withAuthHeaders(
        json({ 
          error: `Failed to update settings: ${error instanceof Error ? error.message : "Unknown error"}` 
        }, { status: 500 }),
        headers
      );
    }
  }

  // Trigger manual reconciliation
  if (intent === "triggerReconciliation" && userDetails.role === "Dev") {
    const taskId = formData.get("taskId") as string;

    if (!taskId) {
      return withAuthHeaders(
        json({ error: "Task ID is required" }, { status: 400 }),
        headers
      );
    }

    try {
      const { ReconciliationScheduler } = await import("~/lib/reconciliation/scheduler.server");
      
      // Execute task asynchronously (don't wait for completion)
      ReconciliationScheduler.getInstance()
        .executeTask(taskId, "manual", user.id)
        .catch((error) => {
          console.error(`Manual reconciliation failed for ${taskId}:`, error);
        });

      return withAuthHeaders(
        json({ success: true, message: "Reconciliation started" }),
        headers
      );
    } catch (error) {
      return withAuthHeaders(
        json({ 
          error: `Failed to trigger reconciliation: ${error instanceof Error ? error.message : "Unknown error"}` 
        }, { status: 500 }),
        headers
      );
    }
  }

  return withAuthHeaders(
    json({ error: "Invalid intent" }, { status: 400 }),
    headers
  );
}

type Tab =
  | "profile"
  | "security"
  | "notifications"
  | "preferences"
  | "email"
  | "admin"
  | "developer";

function FeatureFlagItem({
  flag,
  onToggle,
  disabled,
}: {
  flag: FeatureFlag;
  onToggle: (key: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
      <button
        type="button"
        onClick={() => onToggle(flag.key)}
        disabled={disabled}
        className={`
          relative inline-flex h-5 w-9 items-center rounded-full transition-colors
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1
          ${flag.enabled ? "bg-blue-600" : "bg-gray-200 dark:bg-gray-700"}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        `}
      >
        <span
          className={`
            inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform
            ${flag.enabled ? "translate-x-[18px]" : "translate-x-1"}
          `}
        />
      </button>
      <div className="group relative flex-1">
        <h5 className="text-sm text-gray-900 dark:text-white cursor-help">
          {flag.name}
        </h5>
        <div className="absolute left-0 bottom-full mb-2 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-200 z-10 w-80 max-w-sm pointer-events-none">
          <div className="bg-gray-900 dark:bg-gray-950 text-white text-xs rounded-lg p-3 shadow-lg">
            <p className="mb-2">{flag.description}</p>
            <p className="text-gray-400">
              Key: <code className="bg-gray-800 px-1 rounded">{flag.key}</code>
            </p>
            <div className="absolute bottom-0 left-8 transform translate-y-1/2 rotate-45 w-2 h-2 bg-gray-900 dark:bg-gray-950"></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function BananaModelUploadSection({
  bananaModelStatus,
}: {
  bananaModelStatus: { cadUrl: string | null; meshUrl: string | null; conversionStatus: string | null } | null;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fetcher = useFetcher<{ success?: boolean; error?: string; message?: string }>();

  // Loading state from fetcher
  const isUploading = fetcher.state !== "idle";

  // Result from fetcher data
  const uploadResult = fetcher.data;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
    }
  };

  const handleUpload = () => {
    if (!selectedFile) return;

    const formData = new FormData();
    formData.append("intent", "uploadBananaModel");
    formData.append("file", selectedFile);

    // Uses Remix fetcher - automatic JSON parsing, revalidation, loading states
    fetcher.submit(formData, {
      method: "post",
      encType: "multipart/form-data",
    });
  };

  // Clear file input on successful upload
  useEffect(() => {
    if (fetcher.data?.success) {
      setSelectedFile(null);
      const fileInput = document.getElementById("banana-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    }
  }, [fetcher.data]);

  const getStatusDisplay = () => {
    if (!bananaModelStatus) return null;
    
    const { conversionStatus, meshUrl } = bananaModelStatus;
    
    if (meshUrl && conversionStatus === "completed") {
      return (
        <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="text-sm">Banana model ready</span>
        </div>
      );
    }
    
    if (conversionStatus === "converting" || conversionStatus === "uploading") {
      return (
        <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
          <span className="text-sm">
            {conversionStatus === "converting" ? "Converting..." : "Uploading..."}
          </span>
        </div>
      );
    }
    
    if (conversionStatus === "conversion_failed" || conversionStatus === "error") {
      return (
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
          <span className="text-sm">Conversion failed - try again</span>
        </div>
      );
    }
    
    return (
      <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
        <span className="text-sm">No banana model uploaded</span>
      </div>
    );
  };

  return (
    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
        <span>🍌</span>
        Banana for Scale Settings
      </h4>
      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
        Upload a banana CAD model (STEP file) to use as a scale reference in 3D part viewers.
      </p>

      {/* Current Status */}
      <div className="bg-white dark:bg-gray-800 rounded p-3 mb-4">
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-600 dark:text-gray-400">Current Status:</span>
          {getStatusDisplay()}
        </div>
      </div>

      {/* Upload Section */}
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
              Upload Banana Model
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
              Select a STEP file (.step, .stp) of a banana to use for scale reference
            </p>
            
            <div className="flex items-center gap-2">
              <input
                id="banana-file-input"
                type="file"
                accept=".step,.stp,.iges,.igs"
                onChange={handleFileSelect}
                className="block w-full text-sm text-gray-500 dark:text-gray-400
                  file:mr-4 file:py-1.5 file:px-3
                  file:rounded file:border-0
                  file:text-sm file:font-medium
                  file:bg-blue-50 dark:file:bg-blue-900/30 file:text-blue-700 dark:file:text-blue-300
                  hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50
                  file:cursor-pointer"
              />
            </div>
            
            {selectedFile && (
              <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">
                Selected: {selectedFile.name} ({(selectedFile.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        </div>

        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={handleUpload}
          disabled={!selectedFile || isUploading}
        >
          {isUploading ? "Uploading & Converting..." : "Upload & Convert"}
        </Button>

        {/* Result Messages */}
        {uploadResult && (
          <div className={`mt-3 p-3 rounded ${
            uploadResult.success
              ? "bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700"
              : "bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700"
          }`}>
            <p className={`text-sm font-medium ${
              uploadResult.success
                ? "text-green-800 dark:text-green-200"
                : "text-red-800 dark:text-red-200"
            }`}>
              {uploadResult.success ? uploadResult.message : uploadResult.error}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Settings() {
  const {
    user,
    userDetails,
    message,
    appConfig,
    featureFlags: initialFeatureFlags,
    bananaForScaleEnabled,
    bananaModelStatus,
    emailIntegrationEnabled,
    emailSendAsAddresses,
    emailReplyToAddress,
    emailOutboundBccAddress,
    emailInboundForwardAddress,
    reconciliationTasks,
  } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const fetcher = useFetcher<typeof action>();
  const passwordResetFetcher = useFetcher<typeof action>();
  const featureFlagsFetcher = useFetcher<typeof action>();
  const emailAddressFetcher = useFetcher<typeof action>();
  const emailReplyToFetcher = useFetcher<typeof action>();
  const emailOutboundBccFetcher = useFetcher<typeof action>();
  const emailInboundForwardFetcher = useFetcher<typeof action>();
  const reconciliationFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

  // State for adding new email address
  const [newEmailAddress, setNewEmailAddress] = useState({ email: "", label: "" });

  // Local state for feature flags
  const [localFeatureFlags, setLocalFeatureFlags] = useState(
    initialFeatureFlags || []
  );
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Update local flags when initial data changes (but not during saves)
  useEffect(() => {
    if (!isSaving && !hasUnsavedChanges) {
      setLocalFeatureFlags(initialFeatureFlags || []);
    }
  }, [initialFeatureFlags, isSaving, hasUnsavedChanges]);

  // Revalidate data after successful update
  useEffect(() => {
    if (fetcher.data && "success" in fetcher.data) {
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  // Revalidate after email address changes - only when transitioning from submitting to idle with success
  useEffect(() => {
    if (
      emailAddressFetcher.state === "idle" &&
      emailAddressFetcher.data &&
      "success" in emailAddressFetcher.data
    ) {
      setNewEmailAddress({ email: "", label: "" });
      // Only revalidate once by clearing the fetcher data reference check
      revalidator.revalidate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emailAddressFetcher.state]); // Intentionally only depend on state to prevent multiple revalidations

  // Handle successful feature flags save
  useEffect(() => {
    if (featureFlagsFetcher.state === "submitting") {
      setIsSaving(true);
    } else if (featureFlagsFetcher.state === "idle" && isSaving) {
      setIsSaving(false);
      if (featureFlagsFetcher.data && "success" in featureFlagsFetcher.data) {
        setHasUnsavedChanges(false);
        // Don't revalidate immediately to prevent flickering
        setTimeout(() => {
          revalidator.revalidate();
        }, 100);
      }
    }
  }, [
    featureFlagsFetcher.state,
    featureFlagsFetcher.data,
    isSaving,
    revalidator,
  ]);

  const handleFeatureFlagToggle = useCallback(
    (key: string) => {
      // Prevent toggling while saving
      if (isSaving) return;

      setLocalFeatureFlags((flags: FeatureFlag[]) =>
        flags.map((flag: FeatureFlag) =>
          flag.key === key ? { ...flag, enabled: !flag.enabled } : flag
        )
      );
      setHasUnsavedChanges(true);
    },
    [isSaving]
  );

  const handleSaveFeatureFlags = useCallback(() => {
    featureFlagsFetcher.submit(
      {
        intent: "saveFeatureFlags",
        flags: JSON.stringify(localFeatureFlags),
      },
      { method: "post" }
    );
  }, [localFeatureFlags, featureFlagsFetcher]);

  // Build tabs based on user role and feature flags
  const baseTabs: { id: Tab; label: string }[] = [
    { id: "profile", label: "Your Profile" },
    { id: "security", label: "Security" },
    { id: "notifications", label: "Notifications" },
    { id: "preferences", label: "Preferences" },
  ];

  const tabs = [...baseTabs];

  // Add Email tab for Admin/Dev users when email integration is enabled
  if (emailIntegrationEnabled && (userDetails?.role === "Admin" || userDetails?.role === "Dev")) {
    tabs.push({ id: "email", label: "Email" });
  }

  // Add Admin tab for Admin and Dev users
  if (userDetails?.role === "Admin" || userDetails?.role === "Dev") {
    tabs.push({ id: "admin", label: "Admin" });
  }

  // Add Developer tab only for Dev users
  if (userDetails?.role === "Dev") {
    tabs.push({ id: "developer", label: "Developer" });
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
          Settings
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Manage your account settings and preferences
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="border-b border-gray-200 dark:border-gray-700">
            <nav className="-mb-px flex space-x-8 px-6" aria-label="Tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                  py-4 px-1 border-b-2 font-medium text-sm transition-colors
                  ${
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-600 dark:text-blue-400"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300"
                  }
                `}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6 relative">
            {activeTab === "profile" && (
              <div className="max-w-2xl">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                  Profile Information
                </h3>

                {message && (
                  <div className="mb-6 p-3 bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 rounded text-green-700 dark:text-green-300">
                    {message}
                  </div>
                )}

                <fetcher.Form method="post" className="space-y-6">
                  <input type="hidden" name="intent" value="updateProfile" />

                  <InputField
                    label="Name"
                    name="name"
                    type="text"
                    defaultValue={userDetails?.name || ""}
                    placeholder="Enter your name"
                    required
                  />

                  <div>
                    <InputField
                      label="Email"
                      name="email"
                      type="email"
                      defaultValue={userDetails?.email || user.email}
                      placeholder="Enter your email"
                      required
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Changing your email requires confirmation via email
                    </p>
                  </div>

                  <div className="flex items-center space-x-4">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={fetcher.state === "submitting"}
                    >
                      {fetcher.state === "submitting"
                        ? "Saving..."
                        : "Save Changes"}
                    </Button>

                    {fetcher.data && "success" in fetcher.data && (
                      <span className="text-green-600 dark:text-green-400 text-sm">
                        {fetcher.data.message || "Profile updated successfully"}
                      </span>
                    )}

                    {fetcher.data && "error" in fetcher.data && (
                      <span className="text-red-600 dark:text-red-400 text-sm">
                        {fetcher.data.error}
                      </span>
                    )}
                  </div>
                </fetcher.Form>

                <div className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <h4 className="text-md font-medium text-gray-900 dark:text-white mb-4">
                    Password
                  </h4>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    To reset your password, we&apos;ll send you an email with
                    instructions.
                  </p>
                  <passwordResetFetcher.Form
                    method="post"
                    className="inline-block"
                  >
                    <input type="hidden" name="intent" value="resetPassword" />
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={passwordResetFetcher.state === "submitting"}
                    >
                      {passwordResetFetcher.state === "submitting"
                        ? "Sending..."
                        : "Send Password Reset Email"}
                    </Button>
                  </passwordResetFetcher.Form>

                  {passwordResetFetcher.data &&
                    "success" in passwordResetFetcher.data &&
                    "message" in passwordResetFetcher.data && (
                      <p className="text-green-600 dark:text-green-400 text-sm mt-2">
                        {passwordResetFetcher.data.message}
                      </p>
                    )}

                  {passwordResetFetcher.data &&
                    "error" in passwordResetFetcher.data && (
                      <p className="text-red-600 dark:text-red-400 text-sm mt-2">
                        {passwordResetFetcher.data.error}
                      </p>
                    )}
                </div>
              </div>
            )}

            {activeTab === "security" && (
              <div className="max-w-2xl">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                  Security Settings
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Security settings coming soon...
                </p>
              </div>
            )}

            {activeTab === "notifications" && (
              <div className="max-w-2xl">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                  Notification Preferences
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Notification preferences coming soon...
                </p>
              </div>
            )}

            {activeTab === "preferences" && (
              <div className="max-w-2xl">
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                  Application Preferences
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  Application preferences coming soon...
                </p>
              </div>
            )}

            {activeTab === "email" &&
              emailIntegrationEnabled &&
              (userDetails?.role === "Admin" || userDetails?.role === "Dev") && (
                <div className="max-w-2xl">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                    Email Settings
                  </h3>

                  <div className="space-y-6">
                    {/* Send As Addresses */}
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">
                        &quot;Send As&quot; Addresses
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Configure email addresses that can be used to send emails from quotes.
                        Addresses are validated against Gmail&apos;s &quot;Send mail as&quot; settings before being added.
                      </p>

                      {/* Existing addresses list */}
                      {emailSendAsAddresses && emailSendAsAddresses.length > 0 ? (
                        <div className="space-y-3 mb-4">
                          {emailSendAsAddresses.map((addr: EmailSendAsAddress) => (
                            <div
                              key={addr.id}
                              className="bg-white dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700"
                            >
                              {/* Address header row */}
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-3">
                                  {addr.isDefault && (
                                    <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded">
                                      Default
                                    </span>
                                  )}
                                  <div>
                                    <span className="font-medium text-gray-900 dark:text-white">
                                      {addr.label}
                                    </span>
                                    <span className="text-gray-500 dark:text-gray-400 ml-2 text-sm">
                                      &lt;{addr.email}&gt;
                                    </span>
                                  </div>
                                  {!addr.isActive && (
                                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded">
                                      Inactive
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {!addr.isDefault && (
                                    <emailAddressFetcher.Form method="post" className="inline">
                                      <input type="hidden" name="intent" value="setDefaultEmailSendAs" />
                                      <input type="hidden" name="id" value={addr.id} />
                                      <button
                                        type="submit"
                                        className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                        disabled={emailAddressFetcher.state === "submitting"}
                                      >
                                        Set Default
                                      </button>
                                    </emailAddressFetcher.Form>
                                  )}
                                  <emailAddressFetcher.Form method="post" className="inline">
                                    <input type="hidden" name="intent" value="deleteEmailSendAs" />
                                    <input type="hidden" name="id" value={addr.id} />
                                    <button
                                      type="submit"
                                      className="text-xs text-red-600 dark:text-red-400 hover:underline"
                                      disabled={emailAddressFetcher.state === "submitting"}
                                    >
                                      Remove
                                    </button>
                                  </emailAddressFetcher.Form>
                                </div>
                              </div>
                              
                              {/* Reply-To address for this Send As */}
                              <emailAddressFetcher.Form method="post" className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                <input type="hidden" name="intent" value="updateSendAsReplyTo" />
                                <input type="hidden" name="id" value={addr.id} />
                                <label htmlFor={`reply-to-${addr.id}`} className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">Reply-To:</label>
                                <input
                                  id={`reply-to-${addr.id}`}
                                  type="email"
                                  name="replyToAddress"
                                  defaultValue={addr.replyToAddress || ""}
                                  placeholder="inbound@yourdomain.com (uses default if empty)"
                                  className="flex-1 px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                                />
                                <button
                                  type="submit"
                                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
                                  disabled={emailAddressFetcher.state === "submitting"}
                                >
                                  Save
                                </button>
                              </emailAddressFetcher.Form>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-gray-500 dark:text-gray-400 mb-4 italic">
                          No email addresses configured. Add one below.
                        </div>
                      )}

                      {/* Add new address form */}
                      <div className="space-y-2">
                        <emailAddressFetcher.Form method="post" className="flex flex-col sm:flex-row gap-2">
                          <input type="hidden" name="intent" value="addEmailSendAs" />
                          <div className="flex-1">
                            <input
                              type="text"
                              name="label"
                              placeholder="Display name (e.g., RFQ)"
                              value={newEmailAddress.label}
                              onChange={(e) => setNewEmailAddress((prev) => ({ ...prev, label: e.target.value }))}
                              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500"
                              required
                            />
                          </div>
                          <div className="flex-1">
                            <input
                              type="email"
                              name="email"
                              placeholder="email@domain.com"
                              value={newEmailAddress.email}
                              onChange={(e) => setNewEmailAddress((prev) => ({ ...prev, email: e.target.value }))}
                              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500"
                              required
                            />
                          </div>
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            disabled={emailAddressFetcher.state === "submitting" || !newEmailAddress.email || !newEmailAddress.label}
                          >
                            {emailAddressFetcher.state === "submitting" ? "Validating..." : "Add Address"}
                          </Button>
                        </emailAddressFetcher.Form>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          The display name is shown in the dropdown when composing emails (e.g., &quot;RFQ&quot; or &quot;Sales&quot;).
                        </p>
                      </div>

                      {emailAddressFetcher.data && "error" in emailAddressFetcher.data && (
                        <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                          {emailAddressFetcher.data.error}
                        </p>
                      )}
                    </div>

                    {/* Reply-To Address Configuration */}
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mt-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">
                        Reply-To Address
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Configure the reply-to address for outbound emails. This should be your Postmark inbound address
                        (e.g., inbound@yourdomain.com) to ensure replies are captured via webhook.
                      </p>

                      <emailReplyToFetcher.Form method="post" className="space-y-3">
                        <input type="hidden" name="intent" value="updateEmailReplyTo" />
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="email"
                            name="replyToAddress"
                            defaultValue={emailReplyToAddress || ""}
                            placeholder="inbound@yourdomain.com"
                            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500"
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            disabled={emailReplyToFetcher.state === "submitting"}
                          >
                            {emailReplyToFetcher.state === "submitting" ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </emailReplyToFetcher.Form>

                      {emailReplyToAddress && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                          Current: {emailReplyToAddress}
                        </p>
                      )}

                      {emailReplyToFetcher.data && "error" in emailReplyToFetcher.data && (
                        <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                          {emailReplyToFetcher.data.error}
                        </p>
                      )}
                      {emailReplyToFetcher.data && "success" in emailReplyToFetcher.data && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                          Reply-to address saved successfully!
                        </p>
                      )}
                    </div>

                    {/* Outbound BCC Address (Gmail Mirroring for Sent Emails) */}
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mt-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">
                        Outbound Email BCC (Gmail Mirroring)
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        BCC a copy of all outbound emails to this address so your team can see sent emails in Gmail.
                        This requires the &quot;Enable Outbound Email BCC&quot; feature flag to be enabled.
                      </p>

                      <emailOutboundBccFetcher.Form method="post" className="space-y-3">
                        <input type="hidden" name="intent" value="updateOutboundBcc" />
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="email"
                            name="bccAddress"
                            defaultValue={emailOutboundBccAddress || ""}
                            placeholder="archive@yourdomain.com"
                            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500"
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            disabled={emailOutboundBccFetcher.state === "submitting"}
                          >
                            {emailOutboundBccFetcher.state === "submitting" ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </emailOutboundBccFetcher.Form>

                      {emailOutboundBccAddress && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                          Current: {emailOutboundBccAddress}
                        </p>
                      )}

                      {emailOutboundBccFetcher.data && "error" in emailOutboundBccFetcher.data && (
                        <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                          {emailOutboundBccFetcher.data.error}
                        </p>
                      )}
                      {emailOutboundBccFetcher.data && "success" in emailOutboundBccFetcher.data && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                          Outbound BCC address saved successfully!
                        </p>
                      )}
                    </div>

                    {/* Inbound Forward Address (Gmail Mirroring for Received Emails) */}
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 mt-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">
                        Inbound Email Forwarding (Gmail Mirroring)
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        Forward inbound emails to this address so your team can see customer replies in Gmail.
                        This requires the &quot;Enable Inbound Email Forwarding&quot; feature flag to be enabled.
                      </p>

                      <emailInboundForwardFetcher.Form method="post" className="space-y-3">
                        <input type="hidden" name="intent" value="updateInboundForward" />
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="email"
                            name="forwardAddress"
                            defaultValue={emailInboundForwardAddress || ""}
                            placeholder="team@yourdomain.com"
                            className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500"
                          />
                          <Button
                            type="submit"
                            variant="secondary"
                            size="sm"
                            disabled={emailInboundForwardFetcher.state === "submitting"}
                          >
                            {emailInboundForwardFetcher.state === "submitting" ? "Saving..." : "Save"}
                          </Button>
                        </div>
                      </emailInboundForwardFetcher.Form>

                      {emailInboundForwardAddress && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                          Current: {emailInboundForwardAddress}
                        </p>
                      )}

                      {emailInboundForwardFetcher.data && "error" in emailInboundForwardFetcher.data && (
                        <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                          {emailInboundForwardFetcher.data.error}
                        </p>
                      )}
                      {emailInboundForwardFetcher.data && "success" in emailInboundForwardFetcher.data && (
                        <p className="text-sm text-green-600 dark:text-green-400 mt-2">
                          Inbound forward address saved successfully!
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

            {activeTab === "admin" &&
              (userDetails?.role === "Admin" ||
                userDetails?.role === "Dev") && (
                <div className="max-w-2xl">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-6">
                    Admin Settings
                  </h3>
                  <div className="space-y-6">
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">
                        System Information
                      </h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Application Version:
                          </span>
                          <span className="text-gray-900 dark:text-white font-mono">
                            {appConfig.version}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Environment:
                          </span>
                          <span className="text-gray-900 dark:text-white">
                            {appConfig.environment}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Current User Role:
                          </span>
                          <span className="text-gray-900 dark:text-white font-medium">
                            {userDetails?.role}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2">
                        Admin Actions
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Administrative functions and system management tools.
                      </p>
                      <div className="space-y-2">
                        <Button variant="secondary" size="sm" disabled className="mr-2">
                          User Management (Coming Soon)
                        </Button>
                        <a href="/events" className="block mr-2">
                          <Button variant="secondary" size="sm">System Logs</Button>
                        </a>
                        <Button variant="secondary" size="sm" disabled className="mr-2">
                          Backup & Restore (Coming Soon)
                        </Button>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-4">
                        Feature Flags
                      </h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Control application features and behavior for all users.
                      </p>
                      <div>
                        {localFeatureFlags
                          ?.filter((flag: FeatureFlag) =>
                            flag.key === 'events_access_all' ||
                            flag.key === 'events_nav_visible' ||
                            flag.key === 'pdf_auto_download' ||
                            flag.key === 'quote_rejection_reason_required' ||
                            flag.key === 'email_auto_assign_replied'
                          )
                          .sort((a: FeatureFlag, b: FeatureFlag) =>
                            a.key.localeCompare(b.key)
                          )
                          .map((flag: FeatureFlag) => (
                            <FeatureFlagItem
                              key={flag.id}
                              flag={flag}
                              onToggle={handleFeatureFlagToggle}
                              disabled={isSaving}
                            />
                          ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            {activeTab === "developer" && userDetails?.role === "Dev" && (
              <div className="max-w-2xl">
                <div className="flex items-center gap-3 mb-6">
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    Developer Tools
                  </h3>
                  <span className="text-xs text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 px-2 py-1 rounded">
                    ⚠️ Dev mode active
                  </span>
                </div>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-md font-medium text-gray-900 dark:text-white mb-4">
                      Developer Feature Flags
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                      Advanced features and experimental functionality for developers.
                    </p>
                    <div>
                      {localFeatureFlags
                        ?.filter((flag: FeatureFlag) =>
                          flag.key === 'display_version_header' ||
                          flag.key === 'email_send_dev' ||
                          flag.key === 'mesh_uploads_dev' ||
                          flag.key === 'mesh_uploads_all' ||
                          flag.key === 'price_calculator_dev' ||
                          flag.key === 'price_calculator_all' ||
                          flag.key === 'cad_revisions_dev' ||
                          flag.key === 'cad_revisions_admin' ||
                          flag.key === 'cad_revisions_all' ||
                          flag.key === 'banana_for_scale'
                        )
                        .sort((a: FeatureFlag, b: FeatureFlag) =>
                          a.key.localeCompare(b.key)
                        )
                        .map((flag: FeatureFlag) => (
                          <FeatureFlagItem
                            key={flag.id}
                            flag={flag}
                            onToggle={handleFeatureFlagToggle}
                            disabled={isSaving}
                          />
                        ))}
                    </div>
                  </div>

                  {/* Banana for Scale Settings */}
                  {bananaForScaleEnabled && (
                    <BananaModelUploadSection 
                      bananaModelStatus={bananaModelStatus} 
                    />
                  )}

                  {/* Reconciliation Settings */}
                  {reconciliationTasks && reconciliationTasks.length > 0 && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-700 rounded-lg p-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                        <span>🔄</span>
                        Data Reconciliation
                      </h4>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                        Configure scheduled reconciliation tasks to sync data with external services. 
                        Reconciliation ensures local data stays in sync with the source of truth (e.g., Postmark APIs).
                      </p>

                      <div className="space-y-4">
                        {reconciliationTasks.map((task: {
                          id: string;
                          name: string;
                          description: string;
                          enabled: boolean;
                          cron: string;
                          windowHours: number;
                        }) => (
                          <div 
                            key={task.id} 
                            className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
                          >
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h5 className="text-sm font-medium text-gray-900 dark:text-white">
                                  {task.name}
                                </h5>
                                <p className="text-xs text-gray-600 dark:text-gray-400">
                                  {task.description}
                                </p>
                              </div>
                              <span className={`text-xs px-2 py-1 rounded ${
                                task.enabled 
                                  ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300" 
                                  : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                              }`}>
                                {task.enabled ? "Enabled" : "Disabled"}
                              </span>
                            </div>

                            <reconciliationFetcher.Form method="post" className="space-y-3">
                              <input type="hidden" name="intent" value="updateReconciliationTask" />
                              <input type="hidden" name="taskId" value={task.id} />
                              
                              <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  name="enabled"
                                  value="true"
                                  defaultChecked={task.enabled}
                                  className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700 dark:text-gray-300">
                                  Enable automatic reconciliation
                                </span>
                              </label>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                  <label 
                                    htmlFor={`cron-${task.id}`}
                                    className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                                  >
                                    Schedule (Cron Syntax)
                                  </label>
                                  <input
                                    id={`cron-${task.id}`}
                                    type="text"
                                    name="cron"
                                    defaultValue={task.cron}
                                    placeholder="0 */6 * * *"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500"
                                  />
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    <a 
                                      href="https://crontab.guru" 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-blue-600 dark:text-blue-400 hover:underline"
                                    >
                                      Cron syntax help
                                    </a>
                                    {" • Default: every 6 hours"}
                                  </p>
                                </div>

                                <div>
                                  <label 
                                    htmlFor={`windowHours-${task.id}`}
                                    className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1"
                                  >
                                    Lookback Window (hours)
                                  </label>
                                  <input
                                    id={`windowHours-${task.id}`}
                                    type="number"
                                    name="windowHours"
                                    defaultValue={task.windowHours}
                                    min="1"
                                    max="720"
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                                  />
                                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    How far back to reconcile (default: 72h)
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 pt-2">
                                <Button
                                  type="submit"
                                  variant="secondary"
                                  size="sm"
                                  disabled={reconciliationFetcher.state === "submitting"}
                                >
                                  {reconciliationFetcher.state === "submitting" 
                                    ? "Saving..." 
                                    : "Save Settings"}
                                </Button>
                              </div>
                            </reconciliationFetcher.Form>

                            {/* Manual Trigger */}
                            <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                              <reconciliationFetcher.Form method="post" className="flex items-center gap-3">
                                <input type="hidden" name="intent" value="triggerReconciliation" />
                                <input type="hidden" name="taskId" value={task.id} />
                                <Button
                                  type="submit"
                                  variant="primary"
                                  size="sm"
                                  disabled={reconciliationFetcher.state === "submitting"}
                                >
                                  Run Now
                                </Button>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  Trigger manual reconciliation
                                </span>
                              </reconciliationFetcher.Form>
                            </div>

                            {/* Result messages */}
                            {reconciliationFetcher.data && "success" in reconciliationFetcher.data && (
                              <div className="mt-3 p-2 bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700 rounded text-sm text-green-700 dark:text-green-300">
                                {reconciliationFetcher.data.message || "Settings saved successfully!"}
                              </div>
                            )}
                            {reconciliationFetcher.data && "error" in reconciliationFetcher.data && (
                              <div className="mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded text-sm text-red-700 dark:text-red-300">
                                {reconciliationFetcher.data.error}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-4">
                        Reconciliation runs in the background. Check the Events log for results.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Save button and indicator - positioned absolute to parent container */}
            {((activeTab === "developer" && userDetails?.role === "Dev") ||
              (activeTab === "admin" &&
                (userDetails?.role === "Admin" ||
                  userDetails?.role === "Dev"))) && (
              <div className="absolute bottom-6 right-6 flex items-center gap-3">
                {featureFlagsFetcher.state === "submitting" && (
                  <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400">
                    <svg
                      className="animate-spin h-4 w-4"
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
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    <span className="text-sm">Saving...</span>
                  </div>
                )}
                <Button
                  onClick={handleSaveFeatureFlags}
                  variant={hasUnsavedChanges ? "primary" : "secondary"}
                  disabled={
                    !hasUnsavedChanges ||
                    featureFlagsFetcher.state === "submitting"
                  }
                >
                  Save Changes
                </Button>
              </div>
            )}
          </div>
      </div>
    </div>
  );
}
