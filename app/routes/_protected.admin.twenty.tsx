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
import { formatTimeAgo, twentySyncHealth } from "~/lib/twenty/health";
import { companyIdentityFor, companyKeyFor } from "~/lib/twenty/matching";
import { notifyTwentySync } from "~/lib/twenty/notify.server";
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

  const settings = await getTwentySettings();
  const overview = await getTwentySyncOverview(settings.syncStartedAt);
  const apiKeyConfigured = isTwentyApiKeyConfigured();
  const now = new Date();
  const data: TwentyAdminLoaderData = {
    enabled: settings.enabled,
    workspaceUrl: settings.workspaceUrl,
    // Only ever a yes/no: the key itself stays on the server.
    apiKeyConfigured,
    syncStartedAt: settings.syncStartedAt?.toISOString() ?? null,
    health: twentySyncHealth(
      {
        enabled: settings.enabled,
        workspaceUrl: settings.workspaceUrl,
        apiKeyConfigured,
        lastRunAt: settings.lastRunAt,
        enabledAt: settings.enabledAt,
        failureCount: overview.failureCount,
        warningCount: overview.warnings.length,
        pendingCount: overview.pendingCount,
      },
      now,
    ),
    lastRunLabel: formatTimeAgo(settings.lastRunAt, now),
    syncedQuotes: overview.syncedQuotes,
    pendingCount: overview.pendingCount,
    failureCount: overview.failureCount,
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
      if (!result.ok) return respond({ ok: false, message: result.error });
      const notes = [
        "Workspace URL saved.",
        result.linksCleared ? "Links to the previous workspace were cleared." : null,
        result.syncDisabled
          ? "Automatic sync was turned off. Test the connection, then enable it again."
          : null,
      ];
      return respond({ ok: true, message: notes.filter(Boolean).join(" ") });
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
      const run = await withTwentySyncLock(async () => {
        const { workspaceUrl } = await getTwentySettings();
        const twenty = buildTwentyClient(workspaceUrl);
        if (!twenty) return { ok: false as const, error: "Set the workspace URL and TWENTY_API_KEY first." };
        return syncOneQuote({
          store: postgresTwentySyncStore,
          twenty,
          quoteNumber: String(formData.get("quoteNumber") ?? ""),
        });
      });
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
    case "loadCompanies": {
      const { workspaceUrl } = await getTwentySettings();
      const twenty = buildTwentyClient(workspaceUrl);
      if (!twenty) {
        return respond({
          ok: false,
          message: "Set the workspace URL and TWENTY_API_KEY first.",
        });
      }
      try {
        const companies = await twenty.listCompanies();
        companies.sort((a, b) => a.name.localeCompare(b.name));
        return respond({ ok: true, message: "", companies });
      } catch {
        return respond({ ok: false, message: "Could not load companies from Twenty." });
      }
    }
    case "chooseCompany": {
      const customerId = Number.parseInt(String(formData.get("customerId")), 10);
      const choice = String(formData.get("companyId") ?? "");

      const saveChoice = async (): Promise<
        { saved: true; enabled: boolean } | { saved: false; message: string }
      > => {
        const pending = await getTwentyCompanyChoice(customerId);
        const customer = await postgresTwentySyncStore.getCustomer(customerId);
        if (!customer) return { saved: false, message: "This customer no longer exists." };

        const { workspaceUrl, enabled } = await getTwentySettings();
        const twenty = buildTwentyClient(workspaceUrl);
        if (!twenty) {
          return { saved: false, message: "Set the workspace URL and TWENTY_API_KEY first." };
        }

        // Creating is only offered when settling a match; corrections pick an existing company.
        const isListed =
          pending?.candidates.some((company) => company.id === choice) ||
          (choice !== "new" &&
            (await twenty.listCompanies()).some((company) => company.id === choice));
        if (!isListed && !(choice === "new" && pending)) {
          return { saved: false, message: "Choose one of the listed companies." };
        }

        const companyId =
          choice === "new"
            ? (await twenty.createCompany({ name: pending?.companyName ?? customer.displayName })).id
            : choice;
        await saveTwentyCompanyChoice(
          customerId,
          companyId,
          companyKeyFor(companyIdentityFor(customer)),
        );
        return { saved: true, enabled };
      };

      let run: Awaited<ReturnType<typeof withTwentySyncLock<Awaited<ReturnType<typeof saveChoice>>>>>;
      try {
        run = await withTwentySyncLock(saveChoice);
      } catch (error) {
        console.error("[Twenty] Could not save company choice", error);
        return respond({
          ok: false,
          message: "Could not save the company. Check that Twenty is reachable, then try again.",
        });
      }
      if (!run.ran) {
        return respond({ ok: false, message: "A sync is running. Try again in a minute." });
      }
      if (!run.value.saved) return respond({ ok: false, message: run.value.message });
      if (!run.value.enabled) {
        return respond({
          ok: true,
          message: "Company saved. Use Sync one quote, or it will apply when the sync is enabled.",
        });
      }
      // The choice is saved by now. If this fails, the next sweep still applies it.
      notifyTwentySync("customer.updated");
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
