import type { ActionFunctionArgs } from "@remix-run/node";

import { sendRfqImportJob } from "~/lib/queue/producer.server";
import {
  getRfqWebhookSecret,
  isRfqIntakeEnabled,
} from "~/lib/rfq-intake/storage.server";
import { handleRfqWebhook } from "~/lib/rfq-intake/webhook.server";

export async function action({ request }: ActionFunctionArgs) {
  const enabled = isRfqIntakeEnabled();
  return handleRfqWebhook(request, {
    enabled,
    secret: enabled ? getRfqWebhookSecret() : "",
    async enqueue(receiptKey) {
      await sendRfqImportJob({ receiptKey });
    },
  });
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
