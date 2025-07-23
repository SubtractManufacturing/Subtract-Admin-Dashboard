// This file ensures migrations are run before database access
import { ensureMigrations } from "./auto-migrate.js"

// Re-export everything from client
export * from "./client.js"

// Ensure migrations run on first import
if (typeof window === 'undefined') {
  // Only run on server-side
  ensureMigrations().catch(console.error)
}