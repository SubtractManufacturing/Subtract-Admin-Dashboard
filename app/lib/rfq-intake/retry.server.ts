import { sendRfqImportJob } from "../queue/producer.server";
import { resetRfqImportForRetryByReceiptKey } from "./postgres.server";

export async function retryRfqImport(receiptKey: string): Promise<boolean> {
  const resetKey = await resetRfqImportForRetryByReceiptKey(receiptKey);
  if (!resetKey) return false;
  await sendRfqImportJob({ receiptKey: resetKey });
  return true;
}
