import { runMigrations } from "./migrate.js"

// Only run migrations in development or if explicitly enabled
// TEMPORARILY DISABLED due to migration conflict - re-enable after fixing database
const shouldAutoMigrate = false // process.env.NODE_ENV === 'development' || process.env.AUTO_MIGRATE === 'true'

export async function autoMigrate() {
  if (!shouldAutoMigrate) {
    console.log('⏭️  Skipping auto-migration (not in development mode)')
    return
  }

  try {
    await runMigrations()
  } catch (error) {
    console.error('Failed to run auto-migration:', error)
    // In production, you might want to throw here to prevent app startup
    // In development, we'll continue anyway
    if (process.env.NODE_ENV === 'production') {
      throw error
    }
  }
}

// Create a singleton promise to ensure migrations only run once
let migrationPromise: Promise<void> | null = null

export function ensureMigrations() {
  if (!migrationPromise) {
    migrationPromise = autoMigrate()
  }
  return migrationPromise
}