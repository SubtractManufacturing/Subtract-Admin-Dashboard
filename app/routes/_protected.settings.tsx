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
  pruneStaleFeatureFlags,
} from "~/lib/featureFlags";
import { getBananaModelUrls, setBananaModelUrls, pruneStaleDeveloperSettings } from "~/lib/developerSettings";
import type { FeatureFlag } from "~/lib/db/schema";

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

  return withAuthHeaders(
    json({
      user,
      userDetails,
      message,
      appConfig,
      featureFlags,
      bananaForScaleEnabled,
      bananaModelStatus,
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
  } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const fetcher = useFetcher<typeof action>();
  const passwordResetFetcher = useFetcher<typeof action>();
  const featureFlagsFetcher = useFetcher<typeof action>();
  const pruneFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();

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
                          flag.key === 'display_version_header' ||
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
