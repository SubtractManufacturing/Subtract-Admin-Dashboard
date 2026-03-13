import { useState, useEffect, useCallback } from "react";
import {
  json,
  LoaderFunctionArgs,
  ActionFunctionArgs,
  unstable_parseMultipartFormData,
  unstable_createMemoryUploadHandler,
} from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { useDownload } from "~/hooks/useDownload";
import Modal from "~/components/shared/Modal";
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
  pruneStaleFeatureFlags,
} from "~/lib/featureFlags";
import { getBananaModelUrls, setBananaModelUrls, pruneStaleDeveloperSettings } from "~/lib/developerSettings";
import type { FeatureFlag } from "~/lib/db/schema";
import { getCustomers } from "~/lib/customers";
import { getVendors } from "~/lib/vendors";
import type { BulkImportPreviewRow } from "~/lib/bulk-import";
import type { Customer, CustomerInput } from "~/lib/customers";
import type { Vendor, VendorInput } from "~/lib/vendors";

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

  // Bulk import/export: customers and vendors for Admin/Dev export UI
  const bulkCustomers =
    userDetails.role === "Admin" || userDetails.role === "Dev"
      ? await getCustomers()
      : [];
  const bulkVendors =
    userDetails.role === "Admin" || userDetails.role === "Dev"
      ? await getVendors()
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
      bulkCustomers,
      bulkVendors,
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

    if (intent === "bulkImportParse" && (userDetails.role === "Admin" || userDetails.role === "Dev")) {
      const file = formData.get("file") as File | null;
      const entityType = formData.get("entityType") as string | null;
      if (!file || !entityType || !["customers", "vendors"].includes(entityType)) {
        return withAuthHeaders(
          json({ error: "File and entity type (customers or vendors) are required" }, { status: 400 }),
          headers
        );
      }
      try {
        const { createEvent } = await import("~/lib/events");
        await createEvent({
          entityType: "system",
          entityId: "bulk_import",
          eventType: "bulk_import_started",
          eventCategory: "system",
          title: "Bulk import started",
          description: `Parsing ${entityType} import file`,
          metadata: { entityType },
          userId: user?.id,
          userEmail: user?.email ?? userDetails.name ?? undefined,
        });
        const { parseImportFile, getImportPreview } = await import("~/lib/bulk-import");
        const buffer = Buffer.from(await file.arrayBuffer());
        const { rows } = parseImportFile(buffer);
        const preview = await getImportPreview(rows, entityType as "customers" | "vendors");
        return withAuthHeaders(json({ preview, entityType }), headers);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Parse failed";
        console.error("Bulk import parse error:", err);
        const { createEvent } = await import("~/lib/events");
        await createEvent({
          entityType: "system",
          entityId: "bulk_import",
          eventType: "bulk_import_error",
          eventCategory: "system",
          title: "Bulk import failed",
          description: errorMessage,
          metadata: { entityType: entityType ?? "unknown", error: errorMessage },
          userId: user?.id,
          userEmail: user?.email ?? userDetails.name ?? undefined,
        });
        return withAuthHeaders(
          json({ error: errorMessage }, { status: 400 }),
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

  if (intent === "pruneStaleData" && userDetails.role === "Dev") {
    try {
      const [prunedFlags, prunedSettings] = await Promise.all([
        pruneStaleFeatureFlags(),
        pruneStaleDeveloperSettings(),
      ]);

      const removed = [...prunedFlags, ...prunedSettings];
      return withAuthHeaders(
        json({
          success: true,
          pruneResult: {
            flags: prunedFlags,
            settings: prunedSettings,
            total: removed.length,
          },
        }),
        headers
      );
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to prune stale data" }, { status: 500 }),
        headers
      );
    }
  }

  if (intent === "bulkImportConfirm" && (userDetails.role === "Admin" || userDetails.role === "Dev")) {
    const entityType = formData.get("entityType") as string | null;
    const rowsJson = formData.get("rows") as string | null;
    const actionsJson = formData.get("actions") as string | null;
    if (!entityType || !["customers", "vendors"].includes(entityType) || !rowsJson || !actionsJson) {
      return withAuthHeaders(
        json({ error: "entityType, rows, and actions are required" }, { status: 400 }),
        headers
      );
    }
    try {
      const { createCustomer, updateCustomer } = await import("~/lib/customers");
      const { createVendor, updateVendor } = await import("~/lib/vendors");
      const { validateCustomerRow, validateVendorRow } = await import("~/lib/bulk-import");
      const preview: BulkImportPreviewRow[] = JSON.parse(rowsJson);
      const actions: Record<string, "create" | "override" | "modify" | "skip"> = JSON.parse(actionsJson);
      const eventContext = {
        userId: user?.id,
        userEmail: user?.email ?? userDetails.name ?? undefined,
      };
      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: { row: number; message: string }[] = [];
      const validate = entityType === "customers" ? validateCustomerRow : validateVendorRow;

      for (const row of preview) {
        const actionKey = String(row.rowIndex);
        const action = actions[actionKey] ?? (row.match === "new" ? "create" : "skip");

        if (row.error) {
          errors.push({ row: row.rowIndex, message: row.error });
          continue;
        }

        if (row.match === "new") {
          const validated = validate(row.data as Record<string, unknown>, row.rowIndex);
          if (!validated.ok) {
            errors.push({ row: row.rowIndex, message: validated.error });
            continue;
          }
          try {
            if (entityType === "customers") {
              await createCustomer(validated.data as CustomerInput, eventContext);
            } else {
              await createVendor(validated.data as VendorInput, eventContext);
            }
            created++;
          } catch (e) {
            errors.push({
              row: row.rowIndex,
              message: e instanceof Error ? e.message : "Create failed",
            });
          }
          continue;
        }

        if (action === "skip" || !row.existingId) {
          skipped++;
          continue;
        }

        const validated = validate(row.data as Record<string, unknown>, row.rowIndex);
        if (!validated.ok) {
          errors.push({ row: row.rowIndex, message: validated.error });
          continue;
        }

        try {
          const fullData = validated.data;
          const updatePayload =
            action === "modify"
              ? (Object.fromEntries(
                  Object.entries(fullData).filter(
                    ([, v]) => v !== null && v !== undefined && v !== ""
                  )
                ) as Partial<CustomerInput> & Partial<VendorInput>)
              : fullData;

          if (entityType === "customers") {
            await updateCustomer(row.existingId!, updatePayload as Partial<CustomerInput>, eventContext);
          } else {
            await updateVendor(row.existingId!, updatePayload as Partial<VendorInput>, eventContext);
          }
          updated++;
        } catch (e) {
          errors.push({
            row: row.rowIndex,
            message: e instanceof Error ? e.message : "Update failed",
          });
        }
      }

      return withAuthHeaders(
        json({ created, updated, skipped, errors }),
        headers
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Import failed";
      console.error("Bulk import confirm error:", err);
      const { createEvent } = await import("~/lib/events");
      await createEvent({
        entityType: "system",
        entityId: "bulk_import",
        eventType: "bulk_import_error",
        eventCategory: "system",
        title: "Bulk import failed",
        description: errorMessage,
        metadata: { entityType: entityType ?? "unknown", error: errorMessage },
        userId: user?.id,
        userEmail: user?.email ?? userDetails.name ?? undefined,
      });
      return withAuthHeaders(
        json({ error: errorMessage }, { status: 400 }),
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
  const isUploading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.success) {
      setSelectedFile(null);
      const fileInput = document.getElementById("banana-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
    }
  }, [fetcher.data]);

  const handleUpload = () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append("intent", "uploadBananaModel");
    formData.append("file", selectedFile);
    fetcher.submit(formData, { method: "post", encType: "multipart/form-data" });
  };

  const status = bananaModelStatus?.conversionStatus;
  const hasModel = bananaModelStatus?.meshUrl && status === "completed";
  const isBusy = status === "converting" || status === "uploading";
  const hasFailed = status === "conversion_failed" || status === "error";

  return (
    <div className="flex items-center gap-3 py-2 px-3">
      <span className="text-base">🍌</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-900 dark:text-white font-medium">Banana for Scale</span>
          {hasModel && <span className="text-xs text-green-600 dark:text-green-400">Ready</span>}
          {isBusy && <span className="text-xs text-yellow-600 dark:text-yellow-400">{status === "converting" ? "Converting..." : "Uploading..."}</span>}
          {hasFailed && <span className="text-xs text-red-600 dark:text-red-400">Failed</span>}
          {!hasModel && !isBusy && !hasFailed && <span className="text-xs text-gray-400">No model</span>}
        </div>
        {selectedFile && (
          <p className="text-xs text-gray-500 truncate">{selectedFile.name}</p>
        )}
        {fetcher.data && "error" in fetcher.data && (
          <p className="text-xs text-red-600 dark:text-red-400">{fetcher.data.error}</p>
        )}
      </div>
      <input
        id="banana-file-input"
        type="file"
        accept=".step,.stp,.iges,.igs"
        onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
        className="hidden"
      />
      <label
        htmlFor="banana-file-input"
        className="text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer whitespace-nowrap"
      >
        Choose file
      </label>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleUpload}
        disabled={!selectedFile || isUploading}
      >
        {isUploading ? "Converting..." : "Upload"}
      </Button>
    </div>
  );
}

function PruneResultMessage({ data, state }: { data: unknown; state: string }) {
  if (state !== "idle" || !data || typeof data !== "object") return null;

  if ("error" in data) {
    return <span className="text-xs text-red-600 dark:text-red-400">{(data as { error: string }).error}</span>;
  }

  if ("pruneResult" in data) {
    const { total, flags, settings } = (data as { pruneResult: { total: number; flags: string[]; settings: string[] } }).pruneResult;
    if (total === 0) {
      return <span className="text-xs text-gray-500 dark:text-gray-400">Nothing to prune</span>;
    }
    return (
      <span className="text-xs text-gray-500 dark:text-gray-400">
        Removed {total}: {[...flags, ...settings].join(", ")}
      </span>
    );
  }

  return null;
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
    bulkCustomers = [],
    bulkVendors = [],
  } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const fetcher = useFetcher<typeof action>();
  const passwordResetFetcher = useFetcher<typeof action>();
  const featureFlagsFetcher = useFetcher<typeof action>();
  const pruneFetcher = useFetcher<typeof action>();
  const importParseFetcher = useFetcher<typeof action>();
  const importConfirmFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const { download: downloadFile, isDownloading } = useDownload();

  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState<"import" | "export">("export");
  const [bulkEntity, setBulkEntity] = useState<"customers" | "vendors">("customers");
  const [selectedExportIds, setSelectedExportIds] = useState<number[]>([]);
  const [importPreview, setImportPreview] = useState<{ preview: BulkImportPreviewRow[]; entityType: "customers" | "vendors" } | null>(null);
  const [importActions, setImportActions] = useState<Record<string, "create" | "override" | "modify" | "skip">>({});

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

  // When import parse returns preview, store it and default per-row actions
  useEffect(() => {
    const data = importParseFetcher.data;
    if (importParseFetcher.state !== "idle" || !data || typeof data !== "object" || "error" in data) return;
    if ("preview" in data && Array.isArray((data as { preview: BulkImportPreviewRow[] }).preview)) {
      const { preview, entityType } = data as { preview: BulkImportPreviewRow[]; entityType: "customers" | "vendors" };
      setImportPreview({ preview, entityType });
      const actions: Record<string, "create" | "override" | "modify" | "skip"> = {};
      preview.forEach((row) => {
        const key = String(row.rowIndex);
        actions[key] = row.match === "new" ? "create" : "override";
      });
      setImportActions(actions);
    }
  }, [importParseFetcher.state, importParseFetcher.data]);

  // After successful import confirm, clear preview and revalidate
  useEffect(() => {
    const data = importConfirmFetcher.data;
    if (importConfirmFetcher.state !== "idle" || !data || typeof data !== "object") return;
    if ("created" in data || "updated" in data || "skipped" in data) {
      setImportPreview(null);
      setImportActions({});
      revalidator.revalidate();
    }
  }, [importConfirmFetcher.state, importConfirmFetcher.data, revalidator]);

  // When switching entity in bulk modal, clear export selection
  useEffect(() => {
    setSelectedExportIds([]);
  }, [bulkEntity]);

  const bulkList = bulkEntity === "customers" ? bulkCustomers : bulkVendors;
  const handleSelectAllExport = () => setSelectedExportIds(bulkList.map((e: Customer | Vendor) => e.id));
  const handleDeselectAllExport = () => setSelectedExportIds([]);
  const someSelected = selectedExportIds.length > 0;

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
                      <div className="flex flex-wrap gap-2">
                        <a href="/events">
                          <Button variant="secondary" size="sm">Event Logs</Button>
                        </a>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setBulkModalOpen(true);
                            setBulkMode("export");
                            setBulkEntity("customers");
                            setImportPreview(null);
                            setImportActions({});
                            setSelectedExportIds([]);
                          }}
                        >
                          Bulk import/export
                        </Button>
                      </div>
                    </div>

                    <Modal
                      isOpen={bulkModalOpen}
                      onClose={() => {
                        setBulkModalOpen(false);
                        setImportPreview(null);
                        setImportActions({});
                      }}
                      title="Bulk import / export"
                      size="xl"
                    >
                      <div className="space-y-4">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6 border-b border-gray-200 dark:border-gray-600 pb-4">
                          <div className="flex flex-wrap gap-2">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 self-center">Action:</span>
                            <button
                              type="button"
                              onClick={() => setBulkMode("export")}
                              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                bulkMode === "export"
                                  ? "bg-blue-600 text-white dark:bg-blue-500"
                                  : "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
                              }`}
                            >
                              Export
                            </button>
                            <button
                              type="button"
                              onClick={() => setBulkMode("import")}
                              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                bulkMode === "import"
                                  ? "bg-blue-600 text-white dark:bg-blue-500"
                                  : "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
                              }`}
                            >
                              Import
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 self-center">Entity:</span>
                            <button
                              type="button"
                              onClick={() => setBulkEntity("customers")}
                              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                bulkEntity === "customers"
                                  ? "bg-blue-600 text-white dark:bg-blue-500"
                                  : "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
                              }`}
                            >
                              Customers
                            </button>
                            <button
                              type="button"
                              onClick={() => setBulkEntity("vendors")}
                              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                                bulkEntity === "vendors"
                                  ? "bg-blue-600 text-white dark:bg-blue-500"
                                  : "bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500"
                              }`}
                            >
                              Vendors
                            </button>
                          </div>
                        </div>

                        {bulkMode === "export" && (
                          <div className="space-y-3">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 flex-wrap">
                              <button
                                type="button"
                                onClick={() => downloadFile(
                                  `/download/export-${bulkEntity}?ids=template&format=csv`,
                                  `${bulkEntity}-template.csv`
                                )}
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                              >
                                Download template CSV
                              </button>
                              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                <button
                                  type="button"
                                  onClick={handleSelectAllExport}
                                  className="hover:text-gray-900 dark:hover:text-gray-200 underline"
                                >
                                  Select all
                                </button>
                                <span aria-hidden>|</span>
                                <button
                                  type="button"
                                  onClick={handleDeselectAllExport}
                                  className="hover:text-gray-900 dark:hover:text-gray-200 underline"
                                >
                                  Deselect all
                                </button>
                                {someSelected && (
                                  <span className="text-gray-500 dark:text-gray-400">
                                    ({selectedExportIds.length} selected)
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="max-h-48 sm:max-h-56 overflow-y-auto rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700/50">
                              {bulkList.length === 0 ? (
                                <p className="p-4 text-sm text-gray-500 dark:text-gray-400">No {bulkEntity} to export.</p>
                              ) : (
                                <ul className="divide-y divide-gray-200 dark:divide-gray-600">
                                  {bulkList.map((item: Customer | Vendor) => (
                                    <li key={item.id}>
                                      <label className="flex items-center gap-2 p-2 sm:p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={selectedExportIds.includes(item.id)}
                                          onChange={() =>
                                            setSelectedExportIds((ids) =>
                                              ids.includes(item.id) ? ids.filter((i) => i !== item.id) : [...ids, item.id]
                                            )
                                          }
                                          className="rounded border-gray-300 dark:border-gray-500 text-blue-600 focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-gray-900 dark:text-white truncate">{item.displayName}</span>
                                        {item.companyName && (
                                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate hidden sm:inline">({item.companyName})</span>
                                        )}
                                        {item.email && (
                                          <span className="text-xs text-gray-400 dark:text-gray-500 truncate ml-auto">{item.email}</span>
                                        )}
                                      </label>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 items-center">
                              <select
                                id="bulk-export-format"
                                className="rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm py-2 px-3"
                              >
                                <option value="csv">CSV</option>
                                <option value="json">JSON</option>
                              </select>
                              <Button
                                variant="primary"
                                size="sm"
                                disabled={selectedExportIds.length === 0 || isDownloading}
                                onClick={() => {
                                  const format = (document.getElementById("bulk-export-format") as HTMLSelectElement)?.value || "csv";
                                  const url = `/download/export-${bulkEntity}?ids=${selectedExportIds.join(",")}&format=${format}`;
                                  downloadFile(url, `${bulkEntity}.${format}`);
                                }}
                              >
                                {isDownloading ? "Downloading…" : `Export ${selectedExportIds.length} ${bulkEntity}`}
                              </Button>
                            </div>
                          </div>
                        )}

                        {bulkMode === "import" && (
                          <div className="space-y-4">
                            {!importPreview ? (
                              <>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  Upload a CSV or JSON file to import {bulkEntity}. You can use the template CSV from Export to get the correct columns.
                                </p>
                                <importParseFetcher.Form method="post" encType="multipart/form-data" className="space-y-3">
                                  <input type="hidden" name="intent" value="bulkImportParse" />
                                  <input type="hidden" name="entityType" value={bulkEntity} />
                                  <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                                    <div className="flex-1 min-w-0">
                                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">File (CSV or JSON)</label>
                                      <input
                                        type="file"
                                        name="file"
                                        accept=".csv,.json"
                                        className="block w-full text-sm text-gray-600 dark:text-gray-400 file:mr-2 file:py-2 file:px-3 file:rounded file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 dark:file:bg-blue-900/30 dark:file:text-blue-300 hover:file:bg-blue-100 dark:hover:file:bg-blue-900/50"
                                        required
                                      />
                                    </div>
                                    <Button
                                      type="submit"
                                      variant="primary"
                                      size="sm"
                                      disabled={importParseFetcher.state !== "idle"}
                                    >
                                      {importParseFetcher.state !== "idle" ? "Parsing…" : "Parse file"}
                                    </Button>
                                  </div>
                                  {importParseFetcher.data && "error" in importParseFetcher.data && (
                                    <p className="text-sm text-red-600 dark:text-red-400">
                                      {(importParseFetcher.data as { error: string }).error}
                                    </p>
                                  )}
                                </importParseFetcher.Form>
                              </>
                            ) : (
                              <div className="space-y-3">
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                  {importPreview.preview.length} row(s) — set action per row, then confirm.
                                </p>
                                <div className="overflow-x-auto max-h-60 rounded border border-gray-200 dark:border-gray-600">
                                  <table className="w-full text-sm min-w-[280px]">
                                    <thead className="bg-gray-100 dark:bg-gray-700 sticky top-0">
                                      <tr>
                                        <th className="text-left p-2 text-gray-700 dark:text-gray-300">Row</th>
                                        <th className="text-left p-2 text-gray-700 dark:text-gray-300">Display name</th>
                                        <th className="text-left p-2 text-gray-700 dark:text-gray-300">Match</th>
                                        <th className="text-left p-2 text-gray-700 dark:text-gray-300">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {importPreview.preview.map((row) => (
                                        <tr key={row.rowIndex} className="border-t border-gray-200 dark:border-gray-600">
                                          <td className="p-2 text-gray-900 dark:text-white">{row.rowIndex + 1}</td>
                                          <td className="p-2">
                                            <span className="text-gray-900 dark:text-white">{String((row.data as Record<string, unknown>).displayName ?? "")}</span>
                                            {row.error && (
                                              <span className="block text-red-600 dark:text-red-400 text-xs">{row.error}</span>
                                            )}
                                          </td>
                                          <td className="p-2">
                                            <span className={row.match === "existing" ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>
                                              {row.match}
                                            </span>
                                          </td>
                                          <td className="p-2">
                                            {row.match === "new" ? (
                                              <span className="text-gray-500 dark:text-gray-400">Create</span>
                                            ) : (
                                              <select
                                                value={importActions[String(row.rowIndex)] ?? "override"}
                                                onChange={(e) =>
                                                  setImportActions((prev) => ({
                                                    ...prev,
                                                    [String(row.rowIndex)]: e.target.value as "override" | "modify" | "skip",
                                                  }))
                                                }
                                                className="rounded border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white text-sm py-1 px-2 w-full max-w-[120px]"
                                              >
                                                <option value="override">Override</option>
                                                <option value="modify">Modify</option>
                                                <option value="skip">Skip</option>
                                              </select>
                                            )}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <importConfirmFetcher.Form method="post">
                                    <input type="hidden" name="intent" value="bulkImportConfirm" />
                                    <input type="hidden" name="entityType" value={importPreview.entityType} />
                                    <input type="hidden" name="rows" value={JSON.stringify(importPreview.preview)} />
                                    <input type="hidden" name="actions" value={JSON.stringify(importActions)} />
                                    <Button
                                      type="submit"
                                      variant="primary"
                                      size="sm"
                                      disabled={importConfirmFetcher.state !== "idle"}
                                    >
                                      {importConfirmFetcher.state !== "idle" ? "Importing…" : "Confirm import"}
                                    </Button>
                                  </importConfirmFetcher.Form>
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    onClick={() => {
                                      setImportPreview(null);
                                      setImportActions({});
                                    }}
                                  >
                                    Back
                                  </Button>
                                </div>
                                {importConfirmFetcher.data && "created" in importConfirmFetcher.data && (
                                  <p className="text-sm text-gray-700 dark:text-gray-300">
                                    Created: {(importConfirmFetcher.data as { created: number }).created}, updated: {(importConfirmFetcher.data as { updated: number }).updated}, skipped: {(importConfirmFetcher.data as { skipped: number }).skipped}
                                    {(importConfirmFetcher.data as { errors: { row: number; message: string }[] }).errors?.length > 0 && (
                                      <span className="block text-red-600 dark:text-red-400 mt-1">
                                        Errors: {(importConfirmFetcher.data as { errors: { row: number; message: string }[] }).errors.map((e) => `Row ${e.row + 1}: ${e.message}`).join("; ")}
                                      </span>
                                    )}
                                  </p>
                                )}
                                {importConfirmFetcher.data && "error" in importConfirmFetcher.data && (
                                  <p className="text-sm text-red-600 dark:text-red-400">
                                    {(importConfirmFetcher.data as { error: string }).error}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Modal>

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
                            flag.key === 'duplicate_include_attachments' ||
                            flag.key === 'events_access_all' ||
                            flag.key === 'events_nav_visible' ||
                            flag.key === 'pdf_auto_download' ||
                            flag.key === 'quote_rejection_reason_required'
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
                          flag.key === 'admin_console_access' ||
                          flag.key === 'display_version_header' ||
                          flag.key === 'mesh_uploads_dev' ||
                          flag.key === 'mesh_uploads_all' ||
                          flag.key === 'price_calculator_dev' ||
                          flag.key === 'price_calculator_all' ||
                          flag.key === 'cad_revisions_dev' ||
                          flag.key === 'cad_revisions_admin' ||
                          flag.key === 'cad_revisions_all' ||
                          flag.key === 'banana_for_scale' ||
                          flag.key === 'stripe_payment_links'
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

                  {/* Banana for Scale Model */}
                  {bananaForScaleEnabled && (
                    <div className="bg-gray-50 dark:bg-gray-900 rounded-lg overflow-hidden">
                      <BananaModelUploadSection bananaModelStatus={bananaModelStatus} />
                    </div>
                  )}

                  {/* Data Maintenance */}
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center gap-3">
                      <pruneFetcher.Form method="post">
                        <input type="hidden" name="intent" value="pruneStaleData" />
                        <Button
                          type="submit"
                          variant="secondary"
                          size="sm"
                          disabled={pruneFetcher.state === "submitting"}
                        >
                          {pruneFetcher.state === "submitting" ? "Pruning..." : "Prune stale data"}
                        </Button>
                      </pruneFetcher.Form>
                      <PruneResultMessage data={pruneFetcher.data} state={pruneFetcher.state} />
                    </div>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                      Removes feature_flags and developer_settings rows that no longer exist in code.
                    </p>
                  </div>
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
