import { useState, useEffect } from "react";
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher, useRevalidator } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getAppConfig } from "~/lib/config.server";
import { createServerClient } from "~/lib/supabase";
import Button from "~/components/shared/Button";
import { InputField } from "~/components/shared/FormField";
import Navbar from "~/components/Navbar";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  const appConfig = getAppConfig();
  
  // Check for success message in URL
  const url = new URL(request.url);
  const message = url.searchParams.get("message");
  
  return withAuthHeaders(
    json({ user, userDetails, message, appConfig }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails } = await requireAuth(request);
  const { supabase, headers } = createServerClient(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

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
          full_name: name  // This will show in Supabase Dashboard's "Display Name"
        };
      }
      
      // Simplify: just try to update and handle the response
      const { data: updatedUser, error: updateError } = await supabase.auth.updateUser(updates);
      
      if (updateError) {
        
        // Check if this is an email change that requires confirmation
        // Supabase may return success even when email confirmation is required
        if (emailChanged && (updateError.message.includes('Email') || updateError.message.includes('email'))) {
          return withAuthHeaders(
            json({ 
              success: true, 
              message: "A confirmation email has been sent to your new email address. Please check your inbox to confirm the change." 
            }),
            headers
          );
        }
        
        return withAuthHeaders(
          json({ error: `Failed to update profile: ${updateError.message}` }, { status: 400 }),
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
              message: "A confirmation email has been sent to verify your new email address. Please check your inbox." 
            }),
            headers
          );
        }
      }
      
      return withAuthHeaders(
        json({ success: true }),
        headers
      );
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
        redirectTo: `${new URL(request.url).origin}/auth/callback?type=recovery`,
      });
      
      if (error) {
        return withAuthHeaders(
          json({ error: `Failed to send reset email: ${error.message}` }, { status: 400 }),
          headers
        );
      }
      
      return withAuthHeaders(
        json({ success: true, message: "Password reset email sent! Check your inbox." }),
        headers
      );
    } catch (error) {
      return withAuthHeaders(
        json({ error: "Failed to send password reset email" }, { status: 400 }),
        headers
      );
    }
  }

  return withAuthHeaders(
    json({ error: "Invalid intent" }, { status: 400 }),
    headers
  );
}

type Tab = "profile" | "security" | "notifications" | "preferences";

export default function Settings() {
  const { user, userDetails, message, appConfig } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const fetcher = useFetcher<typeof action>();
  const passwordResetFetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  
  // Revalidate data after successful update
  useEffect(() => {
    if (fetcher.data && 'success' in fetcher.data) {
      revalidator.revalidate();
    }
  }, [fetcher.data, revalidator]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "profile", label: "Your Profile" },
    { id: "security", label: "Security" },
    { id: "notifications", label: "Notifications" },
    { id: "preferences", label: "Preferences" },
  ];

  return (
    <div>
      <Navbar 
        userName={userDetails?.name || user.email} 
        userEmail={user.email}
        userInitials={(userDetails?.name || user.email).charAt(0).toUpperCase()}
        version={appConfig.version}
        isStaging={appConfig.isStaging}
      />
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
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

        <div className="p-6">
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
                    {fetcher.state === "submitting" ? "Saving..." : "Save Changes"}
                  </Button>
                  
                  {fetcher.data && 'success' in fetcher.data && (
                    <span className="text-green-600 dark:text-green-400 text-sm">
                      {fetcher.data.message || "Profile updated successfully"}
                    </span>
                  )}
                  
                  {fetcher.data && 'error' in fetcher.data && (
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
                  To reset your password, we&apos;ll send you an email with instructions.
                </p>
                <passwordResetFetcher.Form method="post" className="inline-block">
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
                
                {passwordResetFetcher.data && 'success' in passwordResetFetcher.data && 'message' in passwordResetFetcher.data && (
                  <p className="text-green-600 dark:text-green-400 text-sm mt-2">
                    {passwordResetFetcher.data.message}
                  </p>
                )}
                
                {passwordResetFetcher.data && 'error' in passwordResetFetcher.data && (
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
        </div>
      </div>
      </div>
    </div>
  );
}