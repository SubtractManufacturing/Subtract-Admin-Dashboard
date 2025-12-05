import { useState, useEffect, useCallback } from "react";
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { createServerClient } from "~/lib/supabase";
import Button from "~/components/shared/Button";
import { InputField } from "~/components/shared/FormField";
import Navbar from "~/components/Navbar";
import {
  getAllFeatureFlags,
  updateFeatureFlag,
  initializeFeatureFlags,
  shouldShowEventsInNav,
  isFeatureEnabled,
  FEATURE_FLAGS,
} from "~/lib/featureFlags";
import {
  consolidateQuoteFiles,
  cleanupDeprecatedQuotesFolder,
  getMigrationStatus,
} from "~/lib/s3-migration.server";
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

  // Get events nav visibility
  const showEventsLink = await shouldShowEventsInNav();

  // Get S3 migration status for Dev users
  const s3MigrationEnabled =
    userDetails.role === "Dev"
      ? await isFeatureEnabled(FEATURE_FLAGS.S3_MIGRATION_ENABLED)
      : false;
  const s3MigrationStatus =
    s3MigrationEnabled && userDetails.role === "Dev"
      ? await getMigrationStatus()
      : null;

  return withAuthHeaders(
    json({
      user,
      userDetails,
      message,
      appConfig,
      featureFlags,
      showEventsLink,
      s3MigrationEnabled,
      s3MigrationStatus,
    }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const { supabase, headers } = createServerClient(request);
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

  // S3 Migration actions (Dev only)
  if (intent === "s3ConsolidateMigration" && userDetails.role === "Dev") {
    try {
      const migrationEnabled = await isFeatureEnabled(
        FEATURE_FLAGS.S3_MIGRATION_ENABLED
      );
      if (!migrationEnabled) {
        return withAuthHeaders(
          json(
            { error: "S3 migration is not enabled. Enable the feature flag first." },
            { status: 403 }
          ),
          headers
        );
      }

      const result = await consolidateQuoteFiles();

      return withAuthHeaders(
        json({
          success: result.success,
          message: result.success
            ? `Migration completed! Moved ${result.filesMoved} files, skipped ${result.filesSkipped}`
            : "Migration failed. Check details for errors.",
          result,
        }),
        headers
      );
    } catch (error) {
      return withAuthHeaders(
        json(
          {
            error: `Migration failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
          { status: 500 }
        ),
        headers
      );
    }
  }

  if (intent === "s3CleanupMigration" && userDetails.role === "Dev") {
    try {
      const migrationEnabled = await isFeatureEnabled(
        FEATURE_FLAGS.S3_MIGRATION_ENABLED
      );
      if (!migrationEnabled) {
        return withAuthHeaders(
          json(
            { error: "S3 migration is not enabled. Enable the feature flag first." },
            { status: 403 }
          ),
          headers
        );
      }

      const result = await cleanupDeprecatedQuotesFolder();

      return withAuthHeaders(
        json({
          success: result.success,
          message: result.success
            ? `Cleanup completed! Deleted ${result.filesMoved} files`
            : "Cleanup failed. Check details for errors.",
          result,
        }),
        headers
      );
    } catch (error) {
      return withAuthHeaders(
        json(
          {
            error: `Cleanup failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          },
          { status: 500 }
        ),
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

export default function Settings() {
  const {
    user,
    userDetails,
    message,
    appConfig,
    featureFlags: initialFeatureFlags,
    showEventsLink,
    s3MigrationEnabled,
    s3MigrationStatus,
  } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const fetcher = useFetcher<typeof action>();
  const passwordResetFetcher = useFetcher<typeof action>();
  const featureFlagsFetcher = useFetcher<typeof action>();
  const s3ConsolidateFetcher = useFetcher<typeof action>();
  const s3CleanupFetcher = useFetcher<typeof action>();
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

  // Build tabs based on user role
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
    <div>
      <Navbar
        userName={userDetails?.name || user.email}
        userEmail={user.email}
        userInitials={(userDetails?.name || user.email).charAt(0).toUpperCase()}
        version={appConfig.version}
        isStaging={appConfig.isStaging}
        showEventsLink={showEventsLink}
      />
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
                            {appConfig.isStaging ? "Staging" : "Production"}
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
                          flag.key === 'mesh_uploads_dev' ||
                          flag.key === 'mesh_uploads_all' ||
                          flag.key === 'price_calculator_dev' ||
                          flag.key === 'price_calculator_all' ||
                          flag.key === 's3_migration_enabled' ||
                          flag.key === 'cad_revisions_dev' ||
                          flag.key === 'cad_revisions_admin' ||
                          flag.key === 'cad_revisions_all'
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

                  {s3MigrationEnabled && (
                    <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-700 rounded-lg p-4">
                      <h4 className="text-md font-medium text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                        <span>⚠️</span>
                        S3 Storage Migration Tools
                      </h4>
                      <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                        Consolidate S3 storage from old &quot;quotes/&quot; structure to organized &quot;quote-parts/&quot; structure.
                      </p>

                      {s3MigrationStatus && (
                        <div className="bg-white dark:bg-gray-800 rounded p-3 mb-4 text-sm space-y-2">
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Deprecated files in quotes/:
                            </span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {s3MigrationStatus.deprecatedFilesCount} files
                              ({(s3MigrationStatus.deprecatedFilesSize / 1024 / 1024).toFixed(2)} MB)
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Parts with old paths:
                            </span>
                            <span className="font-medium text-gray-900 dark:text-white">
                              {s3MigrationStatus.quotesPartsWithOldPaths} parts
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                              1. Consolidate Files
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                              Move files from quotes/ to quote-parts/[id]/source/ and update database
                            </p>
                            <s3ConsolidateFetcher.Form method="post">
                              <input type="hidden" name="intent" value="s3ConsolidateMigration" />
                              <Button
                                type="submit"
                                variant="secondary"
                                size="sm"
                                disabled={s3ConsolidateFetcher.state === "submitting"}
                              >
                                {s3ConsolidateFetcher.state === "submitting"
                                  ? "Migrating..."
                                  : "Run Consolidation"}
                              </Button>
                            </s3ConsolidateFetcher.Form>
                          </div>
                        </div>

                        <div className="flex items-start gap-3">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-white mb-1">
                              2. Clean Up Orphaned Files
                            </p>
                            <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">
                              Delete any remaining orphaned files in the quotes/ folder (consolidation already deletes referenced files)
                            </p>
                            <s3CleanupFetcher.Form method="post">
                              <input type="hidden" name="intent" value="s3CleanupMigration" />
                              <Button
                                type="submit"
                                variant="danger"
                                size="sm"
                                disabled={
                                  s3CleanupFetcher.state === "submitting" ||
                                  (s3MigrationStatus?.quotesPartsWithOldPaths ?? 0) > 0
                                }
                              >
                                {s3CleanupFetcher.state === "submitting"
                                  ? "Deleting..."
                                  : "Delete Old Folder"}
                              </Button>
                            </s3CleanupFetcher.Form>
                            {(s3MigrationStatus?.quotesPartsWithOldPaths ?? 0) > 0 && (
                              <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                Run consolidation first before deleting
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      {s3ConsolidateFetcher.data && "success" in s3ConsolidateFetcher.data && (
                        <div className={`mt-4 p-3 rounded ${
                          s3ConsolidateFetcher.data.success
                            ? "bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700"
                            : "bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700"
                        }`}>
                          <p className={`text-sm font-medium ${
                            s3ConsolidateFetcher.data.success
                              ? "text-green-800 dark:text-green-200"
                              : "text-red-800 dark:text-red-200"
                          }`}>
                            {s3ConsolidateFetcher.data.message}
                          </p>
                          {s3ConsolidateFetcher.data.result && s3ConsolidateFetcher.data.result.details && (
                            <details className="mt-2">
                              <summary className="text-xs cursor-pointer text-gray-600 dark:text-gray-400">
                                View details
                              </summary>
                              <div className="mt-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                                {s3ConsolidateFetcher.data.result.details.map((detail: string, i: number) => (
                                  <div key={i} className="font-mono text-gray-700 dark:text-gray-300">
                                    {detail}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                          {s3ConsolidateFetcher.data.result && s3ConsolidateFetcher.data.result.errors.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs cursor-pointer text-red-700 dark:text-red-300">
                                View errors ({s3ConsolidateFetcher.data.result.errors.length})
                              </summary>
                              <div className="mt-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                                {s3ConsolidateFetcher.data.result.errors.map((error: string, i: number) => (
                                  <div key={i} className="font-mono text-red-700 dark:text-red-300">
                                    {error}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      )}

                      {s3ConsolidateFetcher.data && "error" in s3ConsolidateFetcher.data && (
                        <div className="mt-4 p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700">
                          <p className="text-sm font-medium text-red-800 dark:text-red-200">
                            {s3ConsolidateFetcher.data.error}
                          </p>
                        </div>
                      )}

                      {s3CleanupFetcher.data && "success" in s3CleanupFetcher.data && (
                        <div className={`mt-4 p-3 rounded ${
                          s3CleanupFetcher.data.success
                            ? "bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700"
                            : "bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700"
                        }`}>
                          <p className={`text-sm font-medium ${
                            s3CleanupFetcher.data.success
                              ? "text-green-800 dark:text-green-200"
                              : "text-red-800 dark:text-red-200"
                          }`}>
                            {s3CleanupFetcher.data.message}
                          </p>
                          {s3CleanupFetcher.data.result && s3CleanupFetcher.data.result.details && (
                            <details className="mt-2">
                              <summary className="text-xs cursor-pointer text-gray-600 dark:text-gray-400">
                                View details
                              </summary>
                              <div className="mt-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                                {s3CleanupFetcher.data.result.details.map((detail: string, i: number) => (
                                  <div key={i} className="font-mono text-gray-700 dark:text-gray-300">
                                    {detail}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                          {s3CleanupFetcher.data.result && s3CleanupFetcher.data.result.errors.length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs cursor-pointer text-red-700 dark:text-red-300">
                                View errors ({s3CleanupFetcher.data.result.errors.length})
                              </summary>
                              <div className="mt-2 text-xs space-y-1 max-h-40 overflow-y-auto">
                                {s3CleanupFetcher.data.result.errors.map((error: string, i: number) => (
                                  <div key={i} className="font-mono text-red-700 dark:text-red-300">
                                    {error}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      )}

                      {s3CleanupFetcher.data && "error" in s3CleanupFetcher.data && (
                        <div className="mt-4 p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-300 dark:border-red-700">
                          <p className="text-sm font-medium text-red-800 dark:text-red-200">
                            {s3CleanupFetcher.data.error}
                          </p>
                        </div>
                      )}
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
    </div>
  );
}
