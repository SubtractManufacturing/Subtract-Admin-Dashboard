import 'dotenv/config';
import postgres from 'postgres';

async function testConnection() {
  const url = process.env.DATABASE_URL!;
  console.log('Testing connection to Supabase...\n');
  
  // Extract host for logging
  const hostMatch = url.match(/@([^:\/]+)/);
  if (hostMatch) {
    console.log('Connecting to:', hostMatch[1]);
  }
  
  try {
    // Simple connection with minimal options
    const sql = postgres(url, {
      ssl: true,
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10
    });
    
    console.log('Executing test query...');
    const result = await sql`SELECT version()`;
    console.log('\n✅ Connection successful!');
    console.log('PostgreSQL version:', result[0].version);
    
    // Check current database
    const dbResult = await sql`SELECT current_database()`;
    console.log('Current database:', dbResult[0].current_database);
    
    // End connection
    await sql.end();
    
  } catch (error: any) {
    console.error('\n❌ Connection failed!');
    console.error('Error:', error.message);
    
    if (error.code === 'ENETUNREACH') {
      console.log('\n💡 Network unreachable. Possible solutions:');
      console.log('1. Check your internet connection');
      console.log('2. Try using a VPN if you\'re behind a restrictive firewall');
      console.log('3. Check if your Supabase project is paused (free tier)');
    } else if (error.code === 'ENOTFOUND') {
      console.log('\n💡 Host not found. Check your DATABASE_URL');
    } else if (error.message.includes('password')) {
      console.log('\n💡 Authentication failed. Check your database password');
    }
  }
  
  process.exit(0);
}

testConnection();