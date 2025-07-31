interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
  lastAttempt: number;
}

class RateLimiter {
  private attempts: Map<string, RateLimitEntry> = new Map();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly blockDurationMs: number;

  constructor(options: {
    maxAttempts?: number;
    windowMs?: number;
    blockDurationMs?: number;
  } = {}) {
    this.maxAttempts = options.maxAttempts || 5;
    this.windowMs = options.windowMs || 15 * 60 * 1000; // 15 minutes
    this.blockDurationMs = options.blockDurationMs || 30 * 60 * 1000; // 30 minutes
  }

  isBlocked(identifier: string): { blocked: boolean; remainingAttempts?: number; retryAfter?: Date } {
    const entry = this.attempts.get(identifier);
    
    if (!entry) {
      return { blocked: false, remainingAttempts: this.maxAttempts };
    }

    const now = Date.now();
    
    // Check if blocked
    if (entry.attempts >= this.maxAttempts) {
      const blockEndTime = entry.lastAttempt + this.blockDurationMs;
      if (now < blockEndTime) {
        return { 
          blocked: true, 
          remainingAttempts: 0,
          retryAfter: new Date(blockEndTime)
        };
      }
      // Block period expired, reset
      this.attempts.delete(identifier);
      return { blocked: false, remainingAttempts: this.maxAttempts };
    }

    // Check if window expired
    if (now - entry.firstAttempt > this.windowMs) {
      this.attempts.delete(identifier);
      return { blocked: false, remainingAttempts: this.maxAttempts };
    }

    return { 
      blocked: false, 
      remainingAttempts: this.maxAttempts - entry.attempts 
    };
  }

  recordAttempt(identifier: string): void {
    const now = Date.now();
    const entry = this.attempts.get(identifier);

    if (!entry) {
      this.attempts.set(identifier, {
        attempts: 1,
        firstAttempt: now,
        lastAttempt: now
      });
    } else {
      entry.attempts++;
      entry.lastAttempt = now;
    }
  }

  reset(identifier: string): void {
    this.attempts.delete(identifier);
  }

  // Cleanup old entries periodically
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.attempts.entries()) {
      if (now - entry.lastAttempt > this.windowMs + this.blockDurationMs) {
        this.attempts.delete(key);
      }
    }
  }
}

// Create a singleton instance for login attempts
export const loginRateLimiter = new RateLimiter({
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  blockDurationMs: 30 * 60 * 1000 // 30 minutes
});

// Cleanup old entries every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => loginRateLimiter.cleanup(), 60 * 60 * 1000);
}