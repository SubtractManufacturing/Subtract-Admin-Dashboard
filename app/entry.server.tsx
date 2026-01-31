/**
 * Remix Entry Server
 * 
 * This file is the entry point for the Remix server.
 * It handles server-side rendering and initializes the reconciliation scheduler.
 * 
 * CRITICAL: HMR Safety
 * We use a global variable to ensure only one scheduler instance exists during
 * development hot-reloads. Without this, each HMR cycle would create a new
 * scheduler, leading to duplicate cron jobs.
 */

import { PassThrough } from "node:stream";
import type { EntryContext } from "@remix-run/node";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToPipeableStream } from "react-dom/server";

// Import reconciliation modules
import { ReconciliationScheduler } from "~/lib/reconciliation/scheduler.server";
import { ReconciliationTaskRegistry } from "~/lib/reconciliation/types";
import { PostmarkReconciliationTask } from "~/lib/reconciliation/tasks/postmark.server";

// HMR Safety: Declare global variable type
declare global {
  // eslint-disable-next-line no-var
  var __reconciliationScheduler: ReconciliationScheduler | undefined;
  // eslint-disable-next-line no-var
  var __reconciliationInitialized: boolean | undefined;
}

// Initialize scheduler only once (HMR-safe)
if (!global.__reconciliationInitialized) {
  global.__reconciliationInitialized = true;

  console.log("[entry.server] Initializing reconciliation system...");

  // Register all reconciliation tasks
  ReconciliationTaskRegistry.register(new PostmarkReconciliationTask());

  // Get or create scheduler instance
  const scheduler = ReconciliationScheduler.getInstance();
  global.__reconciliationScheduler = scheduler;

  // Start scheduler (async, don't block server startup)
  scheduler
    .start()
    .then(() => {
      console.log("[entry.server] Reconciliation scheduler started");

      // Run startup reconciliation for enabled tasks
      const tasks = ReconciliationTaskRegistry.getAll();
      console.log(
        `[entry.server] Running startup reconciliation for ${tasks.length} task(s)...`
      );

      for (const task of tasks) {
        scheduler.executeTask(task.id, "startup", "system").catch((error) => {
          console.error(
            `[entry.server] Startup reconciliation failed for ${task.id}:`,
            error
          );
        });
      }
    })
    .catch((error) => {
      console.error("[entry.server] Failed to start scheduler:", error);
    });
} else {
  console.log(
    "[entry.server] Reconciliation system already initialized (HMR reload)"
  );
}

const ABORT_DELAY = 5_000;

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return isbot(request.headers.get("user-agent") || "")
    ? handleBotRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      )
    : handleBrowserRequest(
        request,
        responseStatusCode,
        responseHeaders,
        remixContext
      );
}

function handleBotRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onAllReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}

function handleBrowserRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={request.url}
        abortDelay={ABORT_DELAY}
      />,
      {
        onShellReady() {
          shellRendered = true;
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);

          responseHeaders.set("Content-Type", "text/html");

          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );

          pipe(body);
        },
        onShellError(error: unknown) {
          reject(error);
        },
        onError(error: unknown) {
          responseStatusCode = 500;
          if (shellRendered) {
            console.error(error);
          }
        },
      }
    );

    setTimeout(abort, ABORT_DELAY);
  });
}
