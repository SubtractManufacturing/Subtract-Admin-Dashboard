import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";

import type {
  JobBoardAdminActionData,
  JobBoardAdminLoaderData,
} from "~/components/admin/JobBoardSettingsPanel";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import {
  getJobBoardSettings,
  saveJobBoardNotifyRoleIdSetting,
  saveJobBoardWebhookSetting,
} from "~/lib/job-board/webhook-setting.server";

export { default } from "~/components/admin/JobBoardSettingsPanel";

function isAdminOrDev(role: string) {
  return role === "Admin" || role === "Dev";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const settings = await getJobBoardSettings();
  const data: JobBoardAdminLoaderData = {
    webhookConfigured: settings.webhook.configured,
    notifyRoleId: settings.notifyRoleId,
  };
  return withAuthHeaders(json(data), headers);
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const updatedBy = userDetails.email ?? userDetails.name ?? userDetails.id;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "clearWebhook") {
    const result = await saveJobBoardWebhookSetting("", updatedBy);
    const response: JobBoardAdminActionData = result.ok
      ? { ok: true, message: "Webhook removed." }
      : { ok: false, message: result.error };
    return withAuthHeaders(
      json(response, { status: result.ok ? 200 : 400 }),
      headers,
    );
  }

  if (intent === "clearNotifyRole") {
    const result = await saveJobBoardNotifyRoleIdSetting("", updatedBy);
    const response: JobBoardAdminActionData = result.ok
      ? { ok: true, message: "Notification role removed." }
      : { ok: false, message: result.error };
    return withAuthHeaders(
      json(response, { status: result.ok ? 200 : 400 }),
      headers,
    );
  }

  if (intent === "updateWebhook") {
    const rawUrl = formData.get("webhookUrl");
    const result = await saveJobBoardWebhookSetting(
      typeof rawUrl === "string" ? rawUrl : "",
      updatedBy,
    );
    const response: JobBoardAdminActionData = result.ok
      ? {
          ok: true,
          message: result.maskedUrl
            ? "Webhook saved."
            : "Webhook removed.",
        }
      : { ok: false, message: result.error };
    return withAuthHeaders(
      json(response, { status: result.ok ? 200 : 400 }),
      headers,
    );
  }

  if (intent === "updateNotifyRole") {
    const rawRoleId = formData.get("notifyRoleId");
    const result = await saveJobBoardNotifyRoleIdSetting(
      typeof rawRoleId === "string" ? rawRoleId : "",
      updatedBy,
    );
    const response: JobBoardAdminActionData = result.ok
      ? { ok: true, message: "Notification role saved." }
      : { ok: false, message: result.error };
    return withAuthHeaders(
      json(response, { status: result.ok ? 200 : 400 }),
      headers,
    );
  }

  const response: JobBoardAdminActionData = {
    ok: false,
    message: "Invalid action.",
  };
  return withAuthHeaders(json(response, { status: 400 }), headers);
}
