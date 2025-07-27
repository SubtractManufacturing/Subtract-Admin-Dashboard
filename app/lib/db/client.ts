import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from "./schema.js"

const connectionString = process.env.DATABASE_URL!

// Supabase requires SSL
export const client = postgres(connectionString, {
  ssl: 'require',
  connection: {
    application_name: 'subtract-admin'
  }
})
export const db = drizzle(client, { schema })