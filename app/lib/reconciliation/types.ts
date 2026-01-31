/**
 * Generic reconciliation task interface
 * Implement this for each data source (Postmark, Stripe, etc.)
 * 
 * ARCHITECTURE:
 * - Tasks are registered via ReconciliationTaskRegistry
 * - Scheduler loads tasks and runs them on configured cron schedules
 * - All tasks must be idempotent - safe to run multiple times
 */
export interface ReconciliationTask {
  /** Unique identifier for this task (e.g., "postmark", "stripe") */
  readonly id: string;

  /** Human-readable name */
  readonly name: string;

  /** Human-readable description */
  readonly description: string;

  /**
   * Execute the reconciliation task
   * MUST be idempotent - safe to run multiple times
   */
  execute(options: ReconciliationOptions): Promise<ReconciliationResult>;

  /**
   * Validate task configuration from developer settings
   * Returns array of error messages, empty if valid
   */
  validateConfig(): Promise<string[]>;
}

export interface ReconciliationOptions {
  /** How far back to reconcile (hours) */
  windowHours: number;

  /** Who/what triggered this run */
  triggeredBy?: string;

  /** Source of trigger (scheduled, manual, startup, api) */
  triggerSource?: "scheduled" | "manual" | "startup" | "api";

  /** Task-specific options */
  taskOptions?: Record<string, unknown>;
}

export interface ReconciliationResult {
  success: boolean;
  summary: {
    itemsFetched: number;
    itemsNew: number;
    itemsUpdated: number;
    corrections: number;
  };
  errors: string[];
  duration: number;
}

/**
 * Task registry for managing reconciliation tasks
 * 
 * USAGE:
 * 1. Create a class implementing ReconciliationTask
 * 2. Register it via ReconciliationTaskRegistry.register(new MyTask())
 * 3. The scheduler will pick it up and schedule based on developer_settings
 */
export class ReconciliationTaskRegistry {
  private static tasks = new Map<string, ReconciliationTask>();

  static register(task: ReconciliationTask): void {
    if (this.tasks.has(task.id)) {
      console.warn(`[ReconciliationRegistry] Task ${task.id} already registered, overwriting`);
    }
    this.tasks.set(task.id, task);
    console.log(`[ReconciliationRegistry] Registered task: ${task.id}`);
  }

  static get(taskId: string): ReconciliationTask | undefined {
    return this.tasks.get(taskId);
  }

  static getAll(): ReconciliationTask[] {
    return Array.from(this.tasks.values());
  }

  static has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }

  static unregister(taskId: string): boolean {
    return this.tasks.delete(taskId);
  }

  static clear(): void {
    this.tasks.clear();
  }
}
