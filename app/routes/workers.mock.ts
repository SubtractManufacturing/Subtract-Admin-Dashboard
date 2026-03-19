import { json, type ActionFunctionArgs } from "@remix-run/node";
import { sendMockJob } from "~/lib/queue/producer.server";
import type { MockJobPayload } from "~/lib/queue/types";

// TEMPORARY: Smoke test endpoint for verifying PG Boss queue pipeline.
// Remove this route once queue infrastructure is confirmed working.
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  let message = "Hello from mock job endpoint";

  try {
    const body = await request.json();
    if (body?.message && typeof body.message === "string") {
      message = body.message;
    }
  } catch {
    // Ignore parse errors and keep the default message.
  }

  const payload: MockJobPayload = {
    message,
    triggeredAt: new Date().toISOString(),
  };

  const jobId = await sendMockJob(payload);
  console.log(`[Enqueue] Mock job queued: ${jobId}`);

  return json({
    success: true,
    jobId,
    queue: "mock-job",
    enqueuedAt: payload.triggeredAt,
  });
}
