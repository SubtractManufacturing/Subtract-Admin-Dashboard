import {
  json,
  redirect,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "@remix-run/node";

import type {
  TwentyAdminActionData,
  TwentyAdminLoaderData,
} from "~/components/admin/TwentySettingsPanel";
import { requireAuth, withAuthHeaders } from "~/lib/auth.server";
import { sendTwentySyncJob } from "~/lib/queue/producer.server";
import {
  buildTwentyClient,
  disableTwentySync,
  enableTwentySync,
  getTwentySettings,
  isTwentyApiKeyConfigured,
  saveTwentyWorkspaceUrl,
  testTwentyConnection,
} from "~/lib/twenty/settings.server";
import { syncOneQuote } from "~/lib/twenty/sync.server";
import { companyIdentityFor, companyKeyFor } from "~/lib/twenty/matching";
import {
  clearTwentyRetryDelay,
  getTwentyCompanyChoice,
  getTwentySyncOverview,
  postgresTwentySyncStore,
  saveTwentyCompanyChoice,
  withTwentySyncLock,
} from "~/lib/twenty/store.server";

export { default } from "~/components/admin/TwentySettingsPanel";

function isAdminOrDev(role: string) {
  return role === "Admin" || role === "Dev";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const [settings, overview] = await Promise.all([
    getTwentySettings(),
    getTwentySyncOverview(),
  ]);
  const data: TwentyAdminLoaderData = {
    enabled: settings.enabled,
    workspaceUrl: settings.workspaceUrl,
    // Only ever a yes/no: the key itself stays on the server.
    apiKeyConfigured: isTwentyApiKeyConfigured(),
    syncStartedAt: settings.syncStartedAt?.toISOString() ?? null,
    lastRunAt: settings.lastRunAt,
    syncedQuotes: overview.syncedQuotes,
    failures: overview.failures,
    warnings: overview.warnings,
  };
  return withAuthHeaders(json(data), headers);
}

function parseRetryTarget(formData: FormData) {
  const entityType = formData.get("entityType");
  const entityId = Number.parseInt(String(formData.get("entityId")), 10);
  if ((entityType !== "customer" && entityType !== "quote") || !(entityId > 0)) {
    return undefined;
  }
  return { entityType, entityId } as const;
}

export async function action({ request }: ActionFunctionArgs) {
  const { userDetails, headers } = await requireAuth(request);
  if (!isAdminOrDev(userDetails.role)) {
    return withAuthHeaders(redirect("/"), headers);
  }

  const updatedBy = userDetails.email ?? userDetails.name ?? userDetails.id;
  const formData = await request.formData();
  const intent = formData.get("intent");

  const respond = (response: TwentyAdminActionData) =>
    withAuthHeaders(json(response, { status: response.ok ? 200 : 400 }), headers);

  switch (intent) {
    case "saveUrl": {
      const rawUrl = formData.get("workspaceUrl");
      const result = await saveTwentyWorkspaceUrl(
        typeof rawUrl === "string" ? rawUrl : "",
        updatedBy,
      );
      return respond(
        result.ok
          ? {
              ok: true,
              message: result.linksCleared
                ? "Workspace URL saved. Links to the previous workspace were cleared."
                : "Workspace URL saved.",
            }
          : { ok: false, message: result.error },
      );
    }
    case "test": {
      const { workspaceUrl } = await getTwentySettings();
      const result = await testTwentyConnection(workspaceUrl);
      return respond(
        result.ok
          ? {
              ok: true,
              message:
                "Connected. Read access and the required fields are confirmed. Write access is first tested by a sync.",
            }
          : { ok: false, message: result.error },
      );
    }
    case "enable": {
      const result = await enableTwentySync(updatedBy);
      return respond(
        result.ok
          ? { ok: true, message: "Sync enabled." }
          : { ok: false, message: `Sync not enabled: ${result.error}` },
      );
    }
    case "disable": {
      const saved = await disableTwentySync(updatedBy);
      return respond(
        saved
          ? { ok: true, message: "Sync disabled." }
          : { ok: false, message: "Could not disable the sync." },
      );
    }
    case "syncQuote": {
      const { workspaceUrl } = await getTwentySettings();
      const twenty = buildTwentyClient(workspaceUrl);
      if (!twenty) {
        return respond({
          ok: false,
          message: "Set the workspace URL and TWENTY_API_KEY first.",
        });
      }
      const run = await withTwentySyncLock(() =>
        syncOneQuote({
          store: postgresTwentySyncStore,
          twenty,
          quoteNumber: String(formData.get("quoteNumber") ?? ""),
        }),
      );
      if (!run.ran) {
        return respond({ ok: false, message: "A sync is running. Try again in a minute." });
      }
      const result = run.value;
      if (!result.ok) return respond({ ok: false, message: result.error });
      const { report } = result;
      if (report.matchingOpportunities !== 1) {
        return respond({
          ok: false,
          message: `Expected 1 opportunity for this quote but found ${report.matchingOpportunities}.`,
          report,
        });
      }
      return respond({
        ok: true,
        message: report.created ? "Opportunity created." : "Existing opportunity updated.",
        report,
      });
    }
    case "chooseCompany": {
      const customerId = Number.parseInt(String(formData.get("customerId")), 10);
      const choice = String(formData.get("companyId") ?? "");
      const pending = await getTwentyCompanyChoice(customerId);
      const customer = await postgresTwentySyncStore.getCustomer(customerId);
      if (!pending || !customer) {
        return respond({ ok: false, message: "This choice is no longer needed." });
      }
      const isCandidate = pending.candidates.some((company) => company.id === choice);
      if (choice !== "new" && !isCandidate) {
        return respond({ ok: false, message: "Choose one of the listed companies." });
      }

      const { workspaceUrl, enabled } = await getTwentySettings();
      const twenty = buildTwentyClient(workspaceUrl);
      if (!twenty) {
        return respond({
          ok: false,
          message: "Set the workspace URL and TWENTY_API_KEY first.",
        });
      }
      const companyKey = companyKeyFor(companyIdentityFor(customer));
      const run = await withTwentySyncLock(async () => {
        const companyId =
          choice === "new"
            ? (await twenty.createCompany({ name: pending.companyName })).id
            : choice;
        await saveTwentyCompanyChoice(customerId, companyId, companyKey);
      });
      if (!run.ran) {
        return respond({ ok: false, message: "A sync is running. Try again in a minute." });
      }
      if (!enabled) {
        return respond({
          ok: true,
          message: "Company saved. Use Sync one quote, or it will apply when the sync is enabled.",
        });
      }
      await sendTwentySyncJob({ triggeredAt: new Date().toISOString() });
      return respond({ ok: true, message: "Company saved. The sync will pick it up shortly." });
    }
    case "retry":
    case "retryAll": {
      const target = intent === "retry" ? parseRetryTarget(formData) : undefined;
      if (intent === "retry" && !target) {
        return respond({ ok: false, message: "Invalid record." });
      }
      await clearTwentyRetryDelay(target);
      const { enabled } = await getTwentySettings();
      if (!enabled) {
        return respond({
          ok: true,
          message: "Ready to retry when the sync is enabled. Sync one quote works now.",
        });
      }
      await sendTwentySyncJob({ triggeredAt: new Date().toISOString() });
      return respond({ ok: true, message: "Retry queued." });
    }
    default:
      return respond({ ok: false, message: "Invalid action." });
  }
}
