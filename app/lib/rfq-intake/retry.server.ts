import { sendRfqImportJob } from "../queue/producer.server";
import { resetRfqImportForRetry } from "./postgres.server";

export async function retryRfqImport(receiptNumber: string): Promise<boolean> {
  const receiptKey = await resetRfqImportForRetry(receiptNumber);
  if (!receiptKey) return false;
  await sendRfqImportJob({ receiptKey });
  return true;
}
