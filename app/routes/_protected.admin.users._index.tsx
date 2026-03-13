import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, Link } from "@remix-run/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { inviteUser } from "~/lib/users.admin.server";
import { getAllUsers, type UserEventContext } from "~/lib/users";
import type { User } from "~/lib/db/schema";
import AdminPageHeader from "~/components/admin/PageHeader";
import ViewToggle, { useViewToggle } from "~/components/admin/ViewToggle";
import Button from "~/components/admin/Button";
import { DataTable } from "~/components/shared/DataTable";
import Modal from "~/components/shared/Modal";
import { InputField } from "~/components/shared/FormField";
import { formStyles, listCardStyles } from "~/utils/tw-styles";

const allowedRoles = new Set(["Admin", "Dev"]);

function isAllowedRole(role: string) {
  return allowedRoles.has(role);
}

function getClientIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

function statusBadgeClass(status: User["status"]) {
  switch (status) {
    case "active":
      return "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20";
    case "pending":
      return "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20";
    case "disabled":
      return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20";
    default:
      return "text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700";
  }
}

function roleBadgeClass(role: User["role"]) {
  switch (role) {
    case "Dev":
      return "text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20";
    case "Admin":
      return "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20";
    case "User":
    default:
      return "text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700";
  }
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);

  if (!isAllowedRole(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const users = await getAllUsers();
  return withAuthHeaders(json({ users, user, userDetails }), headers);
}

export async function action({ request }: ActionFunctionArgs) {
  const { user, userDetails, supabase, headers } = await requireAuth(request);

  if (!isAllowedRole(userDetails.role)) {
    return withAuthHeaders(
      json({ error: "Unauthorized" }, { status: 403 }),
      headers
    );
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const password = (formData.get("password") as string | null)?.trim() || "";

  if (!password) {
    return withAuthHeaders(
      json({ error: "Password confirmation required" }, { status: 400 }),
      headers
    );
  }

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: userDetails.email,
    password,
  });
  if (authError) {
    return withAuthHeaders(
      json({ error: "Invalid password" }, { status: 403 }),
      headers
    );
  }

  const eventContext: UserEventContext = {
    userId: user.id,
    userEmail: userDetails.email,
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") || "unknown",
  };

  try {
    switch (intent) {
      case "inviteUser": {
        const email = ((formData.get("email") as string | null) || "").trim().toLowerCase();
        if (!email || !email.includes("@")) {
          return withAuthHeaders(
            json({ error: "A valid email is required" }, { status: 400 }),
            headers
          );
        }

        const redirectTo = new URL("/auth/callback", request.url).toString();
        await inviteUser(email, redirectTo, eventContext);
        return withAuthHeaders(json({ success: true, message: `Invite sent to ${email}` }), headers);
      }
      default:
        return withAuthHeaders(
          json({ error: "Invalid intent" }, { status: 400 }),
          headers
        );
    }
  } catch (error) {
    console.error(
      "User management action error:",
      error instanceof Error ? error.message : "Unknown error"
    );
    return withAuthHeaders(
      json(
        { error: error instanceof Error ? error.message : "An error occurred" },
        { status: 500 }
      ),
      headers
    );
  }
}

export default function UsersIndexRoute() {
  const { users } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; message?: string; error?: string }>();
  const [view, setView] = useViewToggle("users-view");
  const [searchQuery, setSearchQuery] = useState("");
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteStep, setInviteStep] = useState<"email" | "password">("email");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteEmailError, setInviteEmailError] = useState("");

  const resetInviteModal = useCallback(() => {
    setInviteStep("email");
    setInviteEmail("");
    setInviteEmailError("");
  }, []);

  const openInviteModal = () => {
    resetInviteModal();
    setIsInviteModalOpen(true);
  };

  const closeInviteModal = useCallback(() => {
    setIsInviteModalOpen(false);
    resetInviteModal();
  }, [resetInviteModal]);

  const handleInviteEmailSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedEmail = inviteEmail.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setInviteEmailError("Enter a valid email address");
      return;
    }

    setInviteEmail(normalizedEmail);
    setInviteEmailError("");
    setInviteStep("password");
  };

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      closeInviteModal();
    }
  }, [closeInviteModal, fetcher.data, fetcher.state]);

  const filteredUsers = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return users;
    return users.filter((row: User) =>
      row.email.toLowerCase().includes(normalized) ||
      (row.name || "").toLowerCase().includes(normalized) ||
      row.role.toLowerCase().includes(normalized) ||
      row.status.toLowerCase().includes(normalized)
    );
  }, [users, searchQuery]);

  return (
    <div className="max-w-[1920px] mx-auto">
      <AdminPageHeader
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Users" },
        ]}
        onSearch={setSearchQuery}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        <div className="flex justify-between items-center mb-5 gap-3">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 transition-colors duration-150">
            Users ({filteredUsers.length})
          </h2>
          <div className="flex items-center gap-3">
            <ViewToggle view={view} onChange={setView} />
            <Button onClick={openInviteModal}>Invite User</Button>
          </div>
        </div>

        <DataTable<User>
          data={filteredUsers}
          viewMode={view}
          getRowKey={(row) => row.id}
          rowLinkHref={(row) => `/admin/users/${row.id}`}
          emptyMessage={
            searchQuery
              ? "No users found matching your search."
              : "No users found."
          }
          columns={[
            {
              key: "email",
              header: "Email",
              render: (row) => (
                <Link
                  to={`/admin/users/${row.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                >
                  {row.email}
                </Link>
              ),
            },
            {
              key: "name",
              header: "Name",
              render: (row) => row.name || "--",
            },
            {
              key: "role",
              header: "Role",
              render: (row) => (
                <span className={`px-2 py-1 rounded text-xs font-semibold ${roleBadgeClass(row.role)}`}>
                  {row.role}
                </span>
              ),
            },
            {
              key: "status",
              header: "Status",
              render: (row) => (
                <span className={`px-2 py-1 rounded text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                  {row.status}
                </span>
              ),
            },
            {
              key: "createdAt",
              header: "Created",
              render: (row) => formatDate(row.createdAt),
            },
          ]}
          cardRender={(row) => (
            <>
              <div className={listCardStyles.header}>
                <div>
                  <div className={listCardStyles.title}>{row.name || row.email}</div>
                  <div className={listCardStyles.value}>{row.email}</div>
                </div>
              </div>
              <div className={listCardStyles.sectionGrid}>
                <div>
                  <div className={listCardStyles.label}>Role</div>
                  <div className={listCardStyles.value}>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${roleBadgeClass(row.role)}`}>
                      {row.role}
                    </span>
                  </div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Status</div>
                  <div className={listCardStyles.value}>
                    <span className={`px-2 py-1 rounded text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </div>
                </div>
                <div>
                  <div className={listCardStyles.label}>Created</div>
                  <div className={listCardStyles.value}>{formatDate(row.createdAt)}</div>
                </div>
              </div>
            </>
          )}
        />
      </div>

      <Modal
        isOpen={isInviteModalOpen}
        onClose={closeInviteModal}
        title={inviteStep === "email" ? "Invite User" : "Confirm Your Identity"}
      >
        {inviteStep === "email" ? (
          <form onSubmit={handleInviteEmailSubmit}>
            <InputField
              label="User Email"
              name="inviteEmail"
              type="email"
              required
              autoComplete="email"
              placeholder="name@company.com"
              value={inviteEmail}
              error={inviteEmailError}
              onChange={(event) => {
                setInviteEmail(event.target.value);
                if (inviteEmailError) {
                  setInviteEmailError("");
                }
              }}
            />

            <div className="flex gap-3 justify-end mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={closeInviteModal}
              >
                Cancel
              </Button>
              <Button type="submit">Continue</Button>
            </div>
          </form>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="inviteUser" />
            <input type="hidden" name="email" value={inviteEmail} />

            <div className="mb-4 space-y-2">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                You&apos;re inviting <span className="font-medium">{inviteEmail}</span>.
              </p>
              <p className="text-sm text-gray-600 dark:text-gray-300">
                We need to verify it&apos;s you before sending the invite. Enter your account password to continue.
              </p>
            </div>

            <div className="mb-4">
              <label className={formStyles.label}>
                Confirm Your Password <span className="text-red-600 dark:text-red-400"> *</span>
              </label>
              <input
                className={formStyles.input}
                type="password"
                name="password"
                required
                autoComplete="current-password"
              />
            </div>

            {fetcher.data?.error && (
              <div className={formStyles.error}>{fetcher.data.error}</div>
            )}

            <div className="flex gap-3 justify-end mt-6">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setInviteStep("email")}
              >
                Back
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={closeInviteModal}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={fetcher.state !== "idle"}>
                {fetcher.state !== "idle" ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </fetcher.Form>
        )}
      </Modal>
    </div>
  );
}
