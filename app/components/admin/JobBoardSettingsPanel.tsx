import { useEffect, useState, type ReactNode } from "react";
import { useFetcher, useLoaderData } from "@remix-run/react";

import AdminPageHeader from "~/components/admin/PageHeader";

export type JobBoardAdminLoaderData = {
  webhookConfigured: boolean;
  notifyRoleId: string | null;
};

export type JobBoardAdminActionData =
  | { ok: true; message: string }
  | { ok: false; message: string };

type SettingField = "webhook" | "role";

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-slate-700 dark:hover:text-gray-100"
    >
      {children}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
      />
    </svg>
  );
}

export default function JobBoardSettingsPanel() {
  const { webhookConfigured, notifyRoleId } =
    useLoaderData<JobBoardAdminLoaderData>();
  const fetcher = useFetcher<JobBoardAdminActionData>();
  const [editing, setEditing] = useState<SettingField | null>(null);
  const [draftWebhookUrl, setDraftWebhookUrl] = useState("");
  const [draftRoleId, setDraftRoleId] = useState("");

  const isBusy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setEditing(null);
      setDraftWebhookUrl("");
      setDraftRoleId("");
    }
  }, [fetcher.state, fetcher.data]);

  const submitIntent = (intent: string, fields?: Record<string, string>) => {
    const formData = new FormData();
    formData.set("intent", intent);
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        formData.set(key, value);
      }
    }
    fetcher.submit(formData, { method: "post" });
  };

  const webhookDisplay = webhookConfigured
    ? "Webhook configured"
    : "Not configured";
  const roleDisplay = notifyRoleId ?? "Not configured";

  return (
    <div className="px-6 py-8 lg:px-10 lg:py-10">
      <AdminPageHeader
        breadcrumbs={[
          { label: "Admin", href: "/admin" },
          { label: "Job Board" },
        ]}
      />

      <div className="mt-6 mb-8 max-w-2xl">
        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          Job Board
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Discord webhook and notification role for Pending order postings.
        </p>
      </div>

      <section className="max-w-2xl rounded-xl border border-gray-200 bg-white p-5 sm:p-6 dark:border-slate-700 dark:bg-slate-800">
        {fetcher.data && (
          <div
            className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
              fetcher.data.ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-100"
                : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100"
            }`}
          >
            {fetcher.data.message}
          </div>
        )}

        <div className="space-y-6">
          <div>
            <label
              htmlFor="job-board-webhook"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Discord webhook
            </label>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Required for Send to Board in the order modal. Operators can still
              use Mark as sent when no webhook is set.
            </p>
            <div className="flex items-center gap-1">
              {editing === "webhook" ? (
                <>
                  <input
                    id="job-board-webhook"
                    type="url"
                    value={draftWebhookUrl}
                    onChange={(event) => setDraftWebhookUrl(event.target.value)}
                    placeholder="https://discord.com/api/webhooks/…"
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
                  />
                  <IconButton
                    label="Save webhook"
                    disabled={isBusy || !draftWebhookUrl.trim()}
                    onClick={() =>
                      submitIntent("updateWebhook", {
                        webhookUrl: draftWebhookUrl.trim(),
                      })
                    }
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </IconButton>
                  <IconButton
                    label="Cancel editing webhook"
                    disabled={isBusy}
                    onClick={() => {
                      setEditing(null);
                      setDraftWebhookUrl("");
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </IconButton>
                </>
              ) : (
                <>
                  <input
                    id="job-board-webhook"
                    readOnly
                    value={webhookDisplay}
                    className={`min-w-0 flex-1 cursor-default rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900/60 ${
                      webhookConfigured
                        ? "text-gray-700 dark:text-gray-200"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  />
                  <IconButton
                    label={webhookConfigured ? "Replace webhook" : "Add webhook"}
                    disabled={isBusy}
                    onClick={() => {
                      setEditing("webhook");
                      setDraftWebhookUrl("");
                    }}
                  >
                    <PencilIcon />
                  </IconButton>
                  <IconButton
                    label="Remove webhook"
                    disabled={isBusy || !webhookConfigured}
                    onClick={() => submitIntent("clearWebhook")}
                  >
                    <TrashIcon />
                  </IconButton>
                </>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="job-board-role"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Notification role ID
            </label>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              Tagged at the top of new posts as{" "}
              <code className="text-xs">&lt;@&amp;roleId&gt;</code>.
            </p>
            <div className="flex items-center gap-1">
              {editing === "role" ? (
                <>
                  <input
                    id="job-board-role"
                    type="text"
                    inputMode="numeric"
                    value={draftRoleId}
                    onChange={(event) => setDraftRoleId(event.target.value)}
                    placeholder="Discord role snowflake (17–20 digits)"
                    className="min-w-0 flex-1 rounded-lg border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100"
                  />
                  <IconButton
                    label="Save notification role"
                    disabled={isBusy || !draftRoleId.trim()}
                    onClick={() =>
                      submitIntent("updateNotifyRole", {
                        notifyRoleId: draftRoleId.trim(),
                      })
                    }
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </IconButton>
                  <IconButton
                    label="Cancel editing role"
                    disabled={isBusy}
                    onClick={() => {
                      setEditing(null);
                      setDraftRoleId("");
                    }}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </IconButton>
                </>
              ) : (
                <>
                  <input
                    id="job-board-role"
                    readOnly
                    value={roleDisplay}
                    className={`min-w-0 flex-1 cursor-default rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-900/60 ${
                      notifyRoleId
                        ? "text-gray-700 dark:text-gray-200"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  />
                  <IconButton
                    label={notifyRoleId ? "Replace notification role" : "Add notification role"}
                    disabled={isBusy}
                    onClick={() => {
                      setEditing("role");
                      setDraftRoleId("");
                    }}
                  >
                    <PencilIcon />
                  </IconButton>
                  <IconButton
                    label="Remove notification role"
                    disabled={isBusy || !notifyRoleId}
                    onClick={() => submitIntent("clearNotifyRole")}
                  >
                    <TrashIcon />
                  </IconButton>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
