import {
  getDeveloperSetting,
  JOB_BOARD_SETTINGS,
  setDeveloperSetting,
} from "../developerSettings";
import {
  maskJobBoardWebhookUrl,
  validateJobBoardWebhookUrl,
} from "./webhook";

export async function getJobBoardWebhookSetting() {
  const url =
    (await getDeveloperSetting(JOB_BOARD_SETTINGS.WEBHOOK_URL)) ?? "";
  return {
    configured: Boolean(url),
    maskedUrl: maskJobBoardWebhookUrl(url),
    url,
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
