import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';

type InfoRow = Record<string, unknown>;

async function checkDatabase() {
  console.log('Checking database connection and schema...\n');
  
  // Create a fresh database connection with SSL
  const connectionString = process.env.DATABASE_URL!;
  const client = postgres(connectionString, {
    ssl: 'require',
    connection: {
      application_name: 'subtract-admin'
    }
  });
  const db = drizzle(client);
  
  try {
    // Test connection
    const result = await db.execute(sql`SELECT current_database()`);
    const dbRows = result as unknown as InfoRow[];
    console.log('✅ Database connection successful');
    console.log(`Connected to database: ${String(dbRows[0]?.current_database)}\n`);
    
    // Check if users table exists
    const tables = await db.execute(sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);
    
    const tableRows = tables as unknown as InfoRow[];
    console.log('📋 Existing tables:');
    tableRows.forEach((row) => console.log(`  - ${String(row.table_name)}`));
    console.log('');
    
    // Check users table schema
    const userTableExists = tableRows.some((row) => row.table_name === 'users');
    if (userTableExists) {
      const columns = await db.execute(sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'users'
        AND table_schema = 'public'
        ORDER BY ordinal_position
      `);
      
      const columnRows = columns as unknown as InfoRow[];
      console.log('📊 Users table columns:');
      columnRows.forEach((row) => {
        console.log(`  - ${String(row.column_name)} (${String(row.data_type)}) ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
      
      // Check if password_hash exists
      const hasPasswordHash = columnRows.some((row) => row.column_name === 'password_hash');
      
      if (hasPasswordHash) {
        console.log('\n⚠️  Found password_hash column. Removing it...');
        try {
          await db.execute(sql`ALTER TABLE users DROP COLUMN IF EXISTS password_hash`);
          console.log('✅ Removed password_hash column');
        } catch (error) {
          console.error('❌ Error removing password_hash:', error);
        }
      } else {
        console.log('\n✅ password_hash column not found (already removed or never existed)');
      }
    } else {
      console.log('\n⚠️  Users table does not exist. You may need to run migrations.');
    }
    
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    console.log('\nPlease check:');
    console.log('1. Is your PostgreSQL database running?');
    console.log('2. Is DATABASE_URL correctly set in your .env file?');
    console.log('3. Format should be: postgresql://user:password@host:port/database');
  } finally {
    await client.end();
    process.exit(0);
  }
}

checkDatabase();
