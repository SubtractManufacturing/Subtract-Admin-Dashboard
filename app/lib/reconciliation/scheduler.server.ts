/**
 * Reconciliation Scheduler Service
 * 
 * In-process cron scheduler using node-cron for running reconciliation tasks.
 * 
 * CRITICAL FEATURES:
 * - SINGLETON: Only one instance allowed (enforced by getInstance())
 * - ADVISORY LOCKS: PostgreSQL locks prevent race conditions in multi-container environments
 * - HMR-SAFE: Works correctly with Vite/Remix hot module replacement
 * - ERROR HANDLING: Never crashes the process, logs errors to event_logs
 * 
 * USAGE:
 * 1. Register tasks with ReconciliationTaskRegistry
 * 2. Call scheduler.start() on server startup
 * 3. Configure cron schedules via developer_settings table
 */

import cron, { type ScheduledTask } from "node-cron";
import { getDeveloperSetting } from "~/lib/developerSettings";
import { ReconciliationTaskRegistry, type ReconciliationResult, type ReconciliationOptions } from "./types";
import { logReconciliationStart, logReconciliationComplete } from "./event-logger";
import { withAdvisoryLock } from "~/lib/db/advisory-lock";

interface ScheduledJob {
  taskId: string;
  schedule: string;
  job: ScheduledTask;
}

/**
 * Reconciliation Scheduler
 * 
 * Manages cron-based scheduling of reconciliation tasks.
 * Uses PostgreSQL advisory locks to prevent duplicate runs across containers.
 */
export class ReconciliationScheduler {
  private static instance: ReconciliationScheduler;
  private jobs: Map<string, ScheduledJob> = new Map();
  private isRunning = false;
  private isInitialized = false;

  // Private constructor enforces singleton pattern
  private constructor() {}

  /**
   * Get the singleton scheduler instance
   */
  static getInstance(): ReconciliationScheduler {
    if (!ReconciliationScheduler.instance) {
      ReconciliationScheduler.instance = new ReconciliationScheduler();
    }
    return ReconciliationScheduler.instance;
  }

  /**
   * Start the scheduler
   * Loads all enabled tasks from developer_settings and schedules them
   * 
   * IDEMPOTENT: Safe to call multiple times
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("[Scheduler] Already running, skipping start");
      return;
    }

    console.log("[Scheduler] Starting reconciliation scheduler...");
    this.isRunning = true;
    this.isInitialized = true;

    // Load and schedule all registered tasks
    const tasks = ReconciliationTaskRegistry.getAll();
    console.log(`[Scheduler] Found ${tasks.length} registered task(s)`);

    for (const task of tasks) {
      try {
        await this.scheduleTask(task.id);
      } catch (error) {
        console.error(`[Scheduler] Failed to schedule task ${task.id}:`, error);
        // Don't throw - continue with other tasks
      }
    }

    console.log(
      `[Scheduler] Scheduler started with ${this.jobs.size} active job(s)`
    );
  }

  /**
   * Schedule or reschedule a specific task
   * Loads cron schedule from developer_settings
   */
  async scheduleTask(taskId: string): Promise<void> {
    const task = ReconciliationTaskRegistry.get(taskId);
    if (!task) {
      console.warn(`[Scheduler] Task ${taskId} not found in registry`);
      return;
    }

    // Check if task is enabled
    const enabled = await getDeveloperSetting(
      `reconciliation_${taskId}_enabled`
    );
    if (enabled !== "true") {
      console.log(`[Scheduler] Task ${taskId} is disabled, skipping`);
      this.stopTask(taskId); // Stop if currently running
      return;
    }

    // Get cron schedule
    const cronSchedule = await getDeveloperSetting(
      `reconciliation_${taskId}_cron`
    );
    if (!cronSchedule) {
      console.warn(
        `[Scheduler] No cron schedule configured for task ${taskId}, skipping`
      );
      return;
    }

    // Validate cron syntax
    if (!cron.validate(cronSchedule)) {
      console.error(
        `[Scheduler] Invalid cron schedule for ${taskId}: "${cronSchedule}"`
      );
      return;
    }

    // Stop existing job if running (for reschedule)
    this.stopTask(taskId);

    // Create new scheduled job
    const job = cron.schedule(
      cronSchedule,
      async () => {
        console.log(`[Scheduler] Cron triggered for task: ${taskId}`);
        await this.executeTask(taskId, "scheduled");
      },
      {
        timezone: "UTC", // Use UTC for consistency
      }
    );

    this.jobs.set(taskId, {
      taskId,
      schedule: cronSchedule,
      job,
    });

    console.log(
      `[Scheduler] Scheduled task "${taskId}" with cron: ${cronSchedule}`
    );
  }

  /**
   * Execute a reconciliation task
   * Can be triggered by cron, manual UI action, or startup
   * 
   * CRITICAL: Uses PostgreSQL advisory lock to prevent duplicate runs
   */
  async executeTask(
    taskId: string,
    triggerSource: "scheduled" | "manual" | "startup" | "api" = "manual",
    triggeredBy?: string
  ): Promise<ReconciliationResult | null> {
    const task = ReconciliationTaskRegistry.get(taskId);
    if (!task) {
      console.error(`[Scheduler] Task ${taskId} not found in registry`);
      return null;
    }

    console.log(
      `[Scheduler] Executing task "${taskId}" (trigger: ${triggerSource})`
    );

    // CRITICAL: Acquire advisory lock to prevent duplicate runs
    const lockKey = `reconciliation_${taskId}`;
    const { success, result, error } = await withAdvisoryLock(
      lockKey,
      async () => {
        return await this.runTaskWithLogging(
          task,
          taskId,
          triggerSource,
          triggeredBy
        );
      }
    );

    if (!success) {
      console.log(
        `[Scheduler] Task ${taskId} skipped - already running in another process/container`
      );
      return null;
    }

    if (error) {
      console.error(`[Scheduler] Task ${taskId} failed with error:`, error);
    }

    return result || null;
  }

  /**
   * Run a task with logging to event_logs
   */
  private async runTaskWithLogging(
    task: { execute: (options: ReconciliationOptions) => Promise<ReconciliationResult>; name: string },
    taskId: string,
    triggerSource: "scheduled" | "manual" | "startup" | "api",
    triggeredBy?: string
  ): Promise<ReconciliationResult> {
    // Get window hours from settings
    const windowHours = parseInt(
      (await getDeveloperSetting(`reconciliation_${taskId}_window_hours`)) ||
        "72"
    );

    // Log start event
    const startEventId = await logReconciliationStart(
      taskId,
      task.name,
      windowHours,
      triggeredBy
    );

    const startTime = Date.now();

    try {
      // Execute the task
      const result = await task.execute({
        windowHours,
        triggerSource,
        triggeredBy,
      });

      result.duration = Date.now() - startTime;

      // Log completion event
      await logReconciliationComplete(taskId, task.name, result, startEventId);

      console.log(
        `[Scheduler] Task "${taskId}" completed in ${result.duration}ms:`,
        result.summary
      );

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[Scheduler] Task "${taskId}" failed:`, error);

      // Log failure event
      const failedResult: ReconciliationResult = {
        success: false,
        summary: {
          itemsFetched: 0,
          itemsNew: 0,
          itemsUpdated: 0,
          corrections: 0,
        },
        errors: [errorMsg],
        duration: Date.now() - startTime,
      };

      await logReconciliationComplete(
        taskId,
        task.name,
        failedResult,
        startEventId
      );

      return failedResult;
    }
  }

  /**
   * Stop a specific task's scheduled job
   */
  stopTask(taskId: string): void {
    const existing = this.jobs.get(taskId);
    if (existing) {
      existing.job.stop();
      this.jobs.delete(taskId);
      console.log(`[Scheduler] Stopped task: ${taskId}`);
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    console.log("[Scheduler] Stopping all scheduled jobs...");
    for (const job of this.jobs.values()) {
      job.job.stop();
    }
    this.jobs.clear();
    this.isRunning = false;
    console.log("[Scheduler] Scheduler stopped");
  }

  /**
   * Restart a task with potentially updated configuration
   */
  async restartTask(taskId: string): Promise<void> {
    this.stopTask(taskId);
    await this.scheduleTask(taskId);
  }

  /**
   * Get the status of all scheduled jobs
   */
  getStatus(): {
    isRunning: boolean;
    isInitialized: boolean;
    jobs: Array<{
      taskId: string;
      schedule: string;
      isActive: boolean;
    }>;
  } {
    return {
      isRunning: this.isRunning,
      isInitialized: this.isInitialized,
      jobs: Array.from(this.jobs.values()).map((job) => ({
        taskId: job.taskId,
        schedule: job.schedule,
        isActive: true, // node-cron doesn't expose running state
      })),
    };
  }

  /**
   * Check if a specific task is scheduled
   */
  isTaskScheduled(taskId: string): boolean {
    return this.jobs.has(taskId);
  }

  /**
   * Get the cron schedule for a task
   */
  getTaskSchedule(taskId: string): string | null {
    const job = this.jobs.get(taskId);
    return job?.schedule || null;
  }
}
