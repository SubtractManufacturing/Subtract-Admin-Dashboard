import { json, redirect, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect, useMemo, useState } from "react";
import AdminPageHeader from "~/components/admin/PageHeader";
import Button from "~/components/admin/Button";
import Modal from "~/components/shared/Modal";
import { SelectField } from "~/components/shared/FormField";
import { EventTimeline } from "~/components/EventTimeline";
import { formStyles } from "~/utils/tw-styles";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { getEventsByEntity } from "~/lib/events";
import { deleteUser } from "~/lib/users.admin.server";
import {
  disableUser,
  enableUser,
  getUserById,
  updateUserRole,
  type UserEventContext,
} from "~/lib/users";
import type { User } from "~/lib/db/schema";

const ROLE_HIERARCHY: Record<User["role"], number> = {
  User: 0,
  Admin: 1,
  Dev: 2,
};

type ManageIntent = "updateRole" | "disableUser" | "enableUser" | "deleteUser";

function canManageUser(actorRole: User["role"], targetRole: User["role"]) {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
}

function canAssignRole(actorRole: User["role"], newRole: User["role"]) {
  return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[newRole];
}

function isAdminOrDev(role: User["role"]) {
  return role === "Admin" || role === "Dev";
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
  return new Date(date).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { user, userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const userId = params.userId;
  if (!userId) {
    throw new Response("User ID is required", { status: 400 });
  }

  const targetUser = await getUserById(userId);
  if (!targetUser || targetUser.isArchived) {
    throw new Response("User not found", { status: 404 });
  }

  const events = await getEventsByEntity("user", userId, 20);
  const isSelf = user.id === userId;
  const canManage = !isSelf && canManageUser(userDetails.role, targetUser.role);

  return withAuthHeaders(
    json({ targetUser, events, user, userDetails, isSelf, canManage }),
    headers
  );
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { user, userDetails, supabase, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(
      json({ error: "Unauthorized" }, { status: 403 }),
      headers
    );
  }

  const targetUserId = params.userId;
  if (!targetUserId) {
    return withAuthHeaders(
      json({ error: "User ID is required" }, { status: 400 }),
      headers
    );
  }

  if (user.id === targetUserId) {
    return withAuthHeaders(
      json({ error: "Cannot modify your own account" }, { status: 403 }),
      headers
    );
  }

  const targetUser = await getUserById(targetUserId);
  if (!targetUser || targetUser.isArchived) {
    return withAuthHeaders(
      json({ error: "User not found" }, { status: 404 }),
      headers
    );
  }

  if (!canManageUser(userDetails.role, targetUser.role)) {
    return withAuthHeaders(
      json({ error: "Insufficient permissions" }, { status: 403 }),
      headers
    );
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as ManageIntent | null;
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
      case "updateRole": {
        const newRole = formData.get("role") as User["role"] | null;
        if (!newRole || !["User", "Admin", "Dev"].includes(newRole)) {
          return withAuthHeaders(
            json({ error: "A valid role is required" }, { status: 400 }),
            headers
          );
        }

        if (!canAssignRole(userDetails.role, newRole)) {
          return withAuthHeaders(
            json(
              { error: "Cannot assign a role equal to or above your own" },
              { status: 403 }
            ),
            headers
          );
        }

        await updateUserRole(targetUserId, newRole, eventContext);
        return withAuthHeaders(json({ success: true }), headers);
      }
      case "disableUser":
        await disableUser(targetUserId, eventContext);
        return withAuthHeaders(json({ success: true }), headers);
      case "enableUser":
        await enableUser(targetUserId, eventContext);
        return withAuthHeaders(json({ success: true }), headers);
      case "deleteUser":
        await deleteUser(targetUserId, eventContext);
        return withAuthHeaders(redirect("/admin/users"), headers);
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

export default function UserDetailRoute() {
  const { targetUser, events, userDetails, canManage, isSelf } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ success?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const [selectedRole, setSelectedRole] = useState<User["role"]>(targetUser.role);
  const [modalIntent, setModalIntent] = useState<ManageIntent | null>(null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) {
      setModalIntent(null);
      revalidator.revalidate();
    }
  }, [fetcher.state, fetcher.data, revalidator]);

  const roleOptions = useMemo(() => {
    const options: User["role"][] = ["User", "Admin", "Dev"];
    return options.filter((role) => canAssignRole(userDetails.role, role));
  }, [userDetails.role]);

  const isManagedDisabled = isSelf || !canManage;
  const pendingAction = modalIntent === "disableUser" || modalIntent === "deleteUser" || modalIntent === "updateRole";
  const actionLabel =
    modalIntent === "updateRole"
      ? "Confirm role update"
      : modalIntent === "deleteUser"
        ? "Confirm user deletion"
        : modalIntent === "enableUser"
          ? "Confirm account re-enable"
          : "Confirm account disable";

  return (
    <div className="max-w-[1920px] mx-auto">
      <AdminPageHeader
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Users", href: "/admin/users" },
          { label: targetUser.name || targetUser.email },
        ]}
      />

      <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-8 space-y-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {targetUser.name || "Unnamed User"}
              </h2>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">{targetUser.email}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Created: {formatDate(targetUser.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs font-semibold ${roleBadgeClass(targetUser.role)}`}>
                {targetUser.role}
              </span>
              <span className={`px-2 py-1 rounded text-xs font-semibold ${statusBadgeClass(targetUser.status)}`}>
                {targetUser.status}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Access Management
          </h3>

          {isSelf && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              You cannot modify your own account from this page.
            </p>
          )}
          {!isSelf && !canManage && (
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Your role cannot manage this user.
            </p>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Update Role</h4>
              <div className="flex gap-3 items-end">
                <div className="flex-1">
                  <SelectField
                    label="Role"
                    name="role"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value as User["role"])}
                    disabled={isManagedDisabled}
                  >
                    {roleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </SelectField>
                </div>
                <Button
                  type="button"
                  onClick={() => setModalIntent("updateRole")}
                  disabled={isManagedDisabled || selectedRole === targetUser.role}
                >
                  Save Role
                </Button>
              </div>
            </div>

            <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-3">Account Actions</h4>
              <div className="flex flex-wrap gap-3">
                {targetUser.status === "disabled" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setModalIntent("enableUser")}
                    disabled={isManagedDisabled}
                  >
                    Re-enable User
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setModalIntent("disableUser")}
                    disabled={isManagedDisabled}
                  >
                    Disable User
                  </Button>
                )}
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => setModalIntent("deleteUser")}
                  disabled={isManagedDisabled}
                >
                  Delete User
                </Button>
              </div>
            </div>
          </div>

          {fetcher.data?.error && (
            <div className={`${formStyles.error} mt-4`}>{fetcher.data.error}</div>
          )}
        </div>

        <EventTimeline
          entityType="user"
          entityId={targetUser.id}
          entityName={targetUser.email}
          initialEvents={events}
        />
      </div>

      <Modal
        isOpen={modalIntent !== null}
        onClose={() => setModalIntent(null)}
        title={actionLabel}
      >
        {modalIntent && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value={modalIntent} />
            {modalIntent === "updateRole" && (
              <input type="hidden" name="role" value={selectedRole} />
            )}

            <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
              Confirm your password to continue.
            </p>
            <div className="mb-4">
              <label className={formStyles.label}>
                Password <span className="text-red-600 dark:text-red-400"> *</span>
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
                onClick={() => setModalIntent(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant={pendingAction ? "danger" : "primary"}
                disabled={fetcher.state !== "idle"}
              >
                {fetcher.state !== "idle" ? "Working..." : "Confirm"}
              </Button>
            </div>
          </fetcher.Form>
        )}
      </Modal>
    </div>
  );
}
