import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

const runMigrations = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is not set')
  }

  console.log('🔄 Running database migrations...')
  
  const migrationClient = postgres(process.env.DATABASE_URL, { max: 1 })
  const db = drizzle(migrationClient)
  
  try {
    await migrate(db, { migrationsFolder: './drizzle' })
    console.log('✅ Migrations completed successfully')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await migrationClient.end()
  }
}

// Run migrations if this file is executed directly
// Note: This check is disabled due to TypeScript module settings
// To run migrations directly, use: npm run db:migrate

export { runMigrations }