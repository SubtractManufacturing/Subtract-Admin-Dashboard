import { useState } from "react";
import { json, LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { updateUser } from "~/lib/users";
import Button from "~/components/shared/Button";
import { InputField } from "~/components/shared/FormField";
import Navbar from "~/components/Navbar";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  return withAuthHeaders(
    json({ user, userDetails }),
    headers
  );
}

export async function action({ request }: ActionFunctionArgs) {
  const { user } = await requireAuth(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "updateProfile") {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;

    try {
      await updateUser(user.id, { name, email });
      return json({ success: true });
    } catch (error) {
      return json({ error: "Failed to update profile" }, { status: 400 });
    }
  }

  return json({ error: "Invalid intent" }, { status: 400 });
}

type Tab = "profile" | "security" | "notifications" | "preferences";

export default function Settings() {
  const { user, userDetails } = useLoaderData<typeof loader>();
  const [activeTab, setActiveTab] = useState<Tab>("profile");
  const fetcher = useFetcher<typeof action>();

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
        userInitials={userDetails?.name?.charAt(0).toUpperCase() || user.email.charAt(0).toUpperCase()}
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

                <InputField
                  label="Email"
                  name="email"
                  type="email"
                  defaultValue={userDetails?.email || user.email}
                  placeholder="Enter your email"
                  required
                />

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
                      Profile updated successfully
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
                <Button
                  variant="secondary"
                  onClick={() => {
                    // TODO: Implement password reset
                    alert("Password reset functionality coming soon!");
                  }}
                >
                  Send Password Reset Email
                </Button>
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