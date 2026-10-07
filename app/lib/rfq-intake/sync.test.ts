import { describe, expect, it } from "vitest";

import {
  runRfqIntakeSync,
  type RfqSyncClaim,
  type RfqSyncCooldownStore,
  type RfqSyncScanResult,
} from "./sync";

class MemoryCooldownStore implements RfqSyncCooldownStore {
  private state:
    | { claimId: string; claimedAt: Date; result: RfqSyncScanResult | null }
    | undefined;
  private waiters: Array<(result: RfqSyncScanResult) => void> = [];
  private nextId = 1;
  maintainedClaims = 0;
  stoppedClaims = 0;

  async claim(now: Date, cooldownMs: number): Promise<RfqSyncClaim> {
    if (
      this.state &&
      now.getTime() - this.state.claimedAt.getTime() < cooldownMs
    ) {
      return {
        acquired: false,
        claimId: this.state.claimId,
        result: this.state.result,
      };
    }
    this.state = {
      claimId: `claim-${this.nextId++}`,
      claimedAt: now,
      result: null,
    };
    return { acquired: true, claimId: this.state.claimId };
  }

  async complete(claimId: string, result: RfqSyncScanResult): Promise<void> {
    if (!this.state || this.state.claimId !== claimId) return;
    this.state.result = result;
    for (const resolve of this.waiters.splice(0)) resolve(result);
  }

  maintainClaim(): () => void {
    this.maintainedClaims += 1;
    return () => {
      this.stoppedClaims += 1;
    };
  }

  async waitForResult(claimId: string): Promise<RfqSyncScanResult> {
    if (this.state?.claimId === claimId && this.state.result) {
      return this.state.result;
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

describe("RFQ intake sync", () => {
  it("runs one scan for concurrent callers and shares its count", async () => {
    const store = new MemoryCooldownStore();
    let releaseScan!: (count: number) => void;
    const scanResult = new Promise<number>((resolve) => {
      releaseScan = resolve;
    });
    let scans = 0;
    const dependencies = {
      enabled: true,
      cooldownStore: store,
      now: () => new Date("2026-09-21T00:00:00Z"),
      async scan() {
        scans += 1;
        return { newImports: await scanResult };
      },
    };

    const first = runRfqIntakeSync(dependencies);
    const second = runRfqIntakeSync(dependencies);
    releaseScan(2);

    await expect(first).resolves.toEqual({ newImports: 2, cooldown: false });
    await expect(second).resolves.toEqual({ newImports: 2, cooldown: true });
    expect(scans).toBe(1);
    expect(store.maintainedClaims).toBe(1);
    expect(store.stoppedClaims).toBe(1);
  });

  it("refuses to scan when intake is disabled", async () => {
    let scans = 0;

    await expect(
      runRfqIntakeSync({
        enabled: false,
        cooldownStore: new MemoryCooldownStore(),
        now: () => new Date("2026-09-21T00:00:00Z"),
        async scan() {
          scans += 1;
          return { newImports: 0 };
        },
      }),
    ).rejects.toThrow("RFQ intake is disabled");
    expect(scans).toBe(0);
  });

  it("keeps the cooldown after a failed scan", async () => {
    const store = new MemoryCooldownStore();
    let scans = 0;
    const dependencies = {
      enabled: true,
      cooldownStore: store,
      now: () => new Date("2026-09-21T00:00:00Z"),
      async scan() {
        scans += 1;
        throw new Error("Storage unavailable");
      },
    };

    await expect(runRfqIntakeSync(dependencies)).rejects.toThrow(
      "Storage unavailable",
    );
    await expect(runRfqIntakeSync(dependencies)).rejects.toThrow(
      "RFQ sync failed",
    );
    expect(scans).toBe(1);
    expect(store.stoppedClaims).toBe(1);
  });
});
