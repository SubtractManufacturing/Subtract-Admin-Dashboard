/**
 * PostgreSQL Advisory Lock utilities
 * 
 * CRITICAL: Prevents race conditions in multi-container Docker deployments
 * 
 * In development mode (NODE_ENV !== 'production'), locks are skipped to avoid
 * issues with stale locks in connection pools.
 * 
 * In production with multiple containers, uses pg_try_advisory_xact_lock
 * (transaction-level locks) which are automatically released.
 */

import { db } from "./index";
import { sql } from "drizzle-orm";

// Skip locks in development to avoid issues with connection pooling and HMR
const SKIP_LOCKS = process.env.NODE_ENV !== "production";

/**
 * Execute a function with a transaction-level advisory lock
 * 
 * In development: Skips the lock entirely (logs a warning)
 * In production: Uses pg_try_advisory_xact_lock for safe locking
 * 
 * If lock cannot be acquired in production, returns immediately without executing
 */
export async function withAdvisoryLock<T>(
  lockKey: string,
  fn: () => Promise<T>
): Promise<{ success: boolean; result?: T; error?: string }> {
  // In development, skip locks to avoid connection pool issues
  if (SKIP_LOCKS) {
    console.log(`[AdvisoryLock] DEV MODE: Skipping lock for ${lockKey}`);
    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[AdvisoryLock] Error during execution:`, error);
      return { success: false, error: errorMsg };
    }
  }

  // Production mode: Use advisory locks
  try {
    // Try to acquire a transaction-level advisory lock
    const lockResult = await db.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint) as acquired`
    );

    const row = (lockResult as unknown as Array<{ acquired: boolean }>)?.[0];
    const acquired = row?.acquired === true;

    console.log(`[AdvisoryLock] Lock ${lockKey}: acquired=${acquired}`);

    if (!acquired) {
      // Log who's holding locks for debugging
      try {
        const locksResult = await db.execute(
          sql`SELECT pid, mode, granted FROM pg_locks WHERE locktype = 'advisory' LIMIT 5`
        );
        console.log(`[AdvisoryLock] Current advisory locks:`, locksResult);
      } catch {
        // Ignore errors checking locks
      }

      console.log(
        `[AdvisoryLock] Could not acquire lock: ${lockKey} (already held by another process)`
      );
      return { success: false };
    }

    console.log(`[AdvisoryLock] Acquired transaction lock: ${lockKey}`);

    const result = await fn();
    
    console.log(`[AdvisoryLock] Completed work for: ${lockKey}`);
    return { success: true, result };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[AdvisoryLock] Error during locked execution:`, error);
    return { success: false, error: errorMsg };
  }
}

/**
 * Check if an advisory lock is currently held (by any session)
 * Useful for status checks
 * 
 * NOTE: In development mode, always returns false (locks are skipped)
 */
export async function isLockHeld(lockKey: string): Promise<boolean> {
  if (SKIP_LOCKS) {
    return false;
  }

  try {
    const result = await db.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})::bigint) as acquired`
    );
    
    const row = (result as unknown as Array<{ acquired: boolean }>)?.[0];
    return row?.acquired !== true;
  } catch (error) {
    console.error(`[AdvisoryLock] Error checking lock status:`, error);
    return false;
  }
}

/**
 * Force release all advisory locks held by this session
 * Useful for cleanup
 */
export async function releaseAllLocks(): Promise<void> {
  try {
    await db.execute(sql`SELECT pg_advisory_unlock_all()`);
    console.log(`[AdvisoryLock] Released all session locks`);
  } catch (error) {
    console.error(`[AdvisoryLock] Failed to release all locks:`, error);
  }
}
