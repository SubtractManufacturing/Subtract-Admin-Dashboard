export const RFQ_SYNC_COOLDOWN_MS = 30_000;

export type RfqSyncScanResult =
  | { status: "completed"; newImports: number }
  | { status: "failed" };

export type RfqSyncClaim =
  | { acquired: true; claimId: string }
  | {
      acquired: false;
      claimId: string;
      result: RfqSyncScanResult | null;
    };

export interface RfqSyncCooldownStore {
  claim(now: Date, cooldownMs: number): Promise<RfqSyncClaim>;
  maintainClaim?(claimId: string): () => void;
  complete(claimId: string, result: RfqSyncScanResult): Promise<void>;
  waitForResult(claimId: string): Promise<RfqSyncScanResult>;
}

export type RfqIntakeSyncDependencies = {
  enabled: boolean;
  cooldownStore: RfqSyncCooldownStore;
  now(): Date;
  scan(): Promise<{ newImports: number }>;
};

export type RfqIntakeSyncResult = {
  newImports: number;
  cooldown: boolean;
};

function resultFromScan(
  result: RfqSyncScanResult,
  cooldown: boolean,
): RfqIntakeSyncResult {
  if (result.status === "failed") {
    throw new Error("RFQ sync failed");
  }
  return { newImports: result.newImports, cooldown };
}

export async function runRfqIntakeSync(
  dependencies: RfqIntakeSyncDependencies,
): Promise<RfqIntakeSyncResult> {
  if (!dependencies.enabled) {
    throw new Error("RFQ intake is disabled");
  }

  const claim = await dependencies.cooldownStore.claim(
    dependencies.now(),
    RFQ_SYNC_COOLDOWN_MS,
  );
  if (!claim.acquired) {
    const result =
      claim.result ??
      (await dependencies.cooldownStore.waitForResult(claim.claimId));
    return resultFromScan(result, true);
  }

  const stopMaintainingClaim =
    dependencies.cooldownStore.maintainClaim?.(claim.claimId) ?? (() => {});
  try {
    const outcome = await dependencies.scan();
    const result: RfqSyncScanResult = {
      status: "completed",
      newImports: outcome.newImports,
    };
    await dependencies.cooldownStore.complete(claim.claimId, result);
    return resultFromScan(result, false);
  } catch (error) {
    await dependencies.cooldownStore.complete(claim.claimId, {
      status: "failed",
    });
    throw error;
  } finally {
    stopMaintainingClaim();
  }
}
