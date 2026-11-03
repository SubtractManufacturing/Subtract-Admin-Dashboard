import {
  getDeveloperSetting,
  setDeveloperSetting,
  TWENTY_SETTINGS,
} from "../developerSettings";
import { getEnv } from "../env.server";
import {
  createTwentyClient,
  normalizeWorkspaceUrl,
  TwentyApiError,
  type TwentyClient,
} from "./client.server";

export interface TwentySettings {
  enabled: boolean;
  workspaceUrl: string;
  syncStartedAt: Date | null;
  lastRunAt: string | null;
}

export function isTwentyApiKeyConfigured(): boolean {
  return Boolean(getEnv("TWENTY_API_KEY")?.trim());
}

export async function getTwentySettings(): Promise<TwentySettings> {
  const [enabled, workspaceUrl, syncStartedAt, lastRunAt] = await Promise.all([
    getDeveloperSetting(TWENTY_SETTINGS.ENABLED),
    getDeveloperSetting(TWENTY_SETTINGS.WORKSPACE_URL),
    getDeveloperSetting(TWENTY_SETTINGS.SYNC_STARTED_AT),
    getDeveloperSetting(TWENTY_SETTINGS.LAST_RUN_AT),
  ]);
  return {
    enabled: enabled === "true",
    workspaceUrl: workspaceUrl ?? "",
    syncStartedAt: syncStartedAt ? new Date(syncStartedAt) : null,
    lastRunAt,
  };
}

export function buildTwentyClient(workspaceUrl: string): TwentyClient | null {
  const apiKey = getEnv("TWENTY_API_KEY")?.trim();
  if (!apiKey || !workspaceUrl) return null;
  return createTwentyClient({ baseUrl: workspaceUrl, apiKey });
}

export async function testTwentyConnection(
  workspaceUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const client = buildTwentyClient(workspaceUrl);
  if (!client) {
    return { ok: false, error: "Set the workspace URL and TWENTY_API_KEY first." };
  }
  try {
    await client.checkConnection();
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof TwentyApiError ? error.message : "Could not reach Twenty.",
    };
  }
}

export async function saveTwentyWorkspaceUrl(
  rawUrl: string,
  updatedBy: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const normalized = normalizeWorkspaceUrl(rawUrl);
  if (!normalized.ok) return normalized;
  const saved = await setDeveloperSetting(
    TWENTY_SETTINGS.WORKSPACE_URL,
    normalized.url || null,
    updatedBy,
  );
  return saved ? normalized : { ok: false, error: "Could not save the Twenty URL." };
}

/** Enabling requires a passing connection test, so a bad setup never starts syncing. */
export async function enableTwentySync(
  updatedBy: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const settings = await getTwentySettings();
  const connection = await testTwentyConnection(settings.workspaceUrl);
  if (!connection.ok) return connection;

  // The first enable fixes the start date; re-enabling keeps it so gaps catch up.
  if (!settings.syncStartedAt) {
    await setDeveloperSetting(
      TWENTY_SETTINGS.SYNC_STARTED_AT,
      new Date().toISOString(),
      updatedBy,
    );
  }
  const saved = await setDeveloperSetting(TWENTY_SETTINGS.ENABLED, "true", updatedBy);
  return saved ? { ok: true } : { ok: false, error: "Could not enable the sync." };
}

export async function disableTwentySync(updatedBy: string): Promise<boolean> {
  return setDeveloperSetting(TWENTY_SETTINGS.ENABLED, "false", updatedBy);
}
