import {
  getDeveloperSetting,
  JOB_BOARD_SETTINGS,
  setDeveloperSetting,
} from "../developerSettings";
import {
  maskJobBoardWebhookUrl,
  validateJobBoardNotifyRoleId,
  validateJobBoardWebhookUrl,
} from "./webhook";

export async function getJobBoardWebhookSetting() {
  const settings = await getJobBoardSettings();
  return settings.webhook;
}

export async function getJobBoardSettings() {
  const [url, notifyRoleId] = await Promise.all([
    getDeveloperSetting(JOB_BOARD_SETTINGS.WEBHOOK_URL),
    getDeveloperSetting(JOB_BOARD_SETTINGS.NOTIFY_ROLE_ID),
  ]);
  const webhookUrl = url ?? "";
  const roleId = notifyRoleId?.trim() || null;
  return {
    webhook: {
      configured: Boolean(webhookUrl),
      maskedUrl: maskJobBoardWebhookUrl(webhookUrl),
      url: webhookUrl,
    },
    notifyRoleId: roleId,
  };
}

export async function saveJobBoardWebhookSetting(
  rawUrl: string,
  updatedBy: string,
): Promise<{ ok: true; maskedUrl: string } | { ok: false; error: string }> {
  const validation = validateJobBoardWebhookUrl(rawUrl);
  if (!validation.ok) return validation;
  const saved = await setDeveloperSetting(
    JOB_BOARD_SETTINGS.WEBHOOK_URL,
    validation.url || null,
    updatedBy,
  );
  if (!saved) {
    return { ok: false, error: "Could not save webhook URL" };
  }
  return { ok: true, maskedUrl: maskJobBoardWebhookUrl(validation.url) };
}

export async function saveJobBoardNotifyRoleIdSetting(
  rawRoleId: string,
  updatedBy: string,
): Promise<{ ok: true; roleId: string | null } | { ok: false; error: string }> {
  const validation = validateJobBoardNotifyRoleId(rawRoleId);
  if (!validation.ok) return validation;
  const saved = await setDeveloperSetting(
    JOB_BOARD_SETTINGS.NOTIFY_ROLE_ID,
    validation.roleId || null,
    updatedBy,
  );
  if (!saved) {
    return { ok: false, error: "Could not save notification role ID" };
  }
  return { ok: true, roleId: validation.roleId || null };
}

export async function saveJobBoardSettings(
  input: { webhookUrl: string; notifyRoleId: string },
  updatedBy: string,
): Promise<
  | {
      ok: true;
      maskedUrl: string;
      notifyRoleId: string | null;
    }
  | { ok: false; error: string }
> {
  const webhookValidation = validateJobBoardWebhookUrl(input.webhookUrl);
  if (!webhookValidation.ok) return webhookValidation;

  const roleValidation = validateJobBoardNotifyRoleId(input.notifyRoleId);
  if (!roleValidation.ok) return roleValidation;

  const [webhookSaved, roleSaved] = await Promise.all([
    setDeveloperSetting(
      JOB_BOARD_SETTINGS.WEBHOOK_URL,
      webhookValidation.url || null,
      updatedBy,
    ),
    setDeveloperSetting(
      JOB_BOARD_SETTINGS.NOTIFY_ROLE_ID,
      roleValidation.roleId || null,
      updatedBy,
    ),
  ]);

  if (!webhookSaved || !roleSaved) {
    return { ok: false, error: "Could not save Job Board settings" };
  }

  return {
    ok: true,
    maskedUrl: maskJobBoardWebhookUrl(webhookValidation.url),
    notifyRoleId: roleValidation.roleId || null,
  };
}
