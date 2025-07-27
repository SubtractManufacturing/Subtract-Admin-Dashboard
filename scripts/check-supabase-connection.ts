import 'dotenv/config';

console.log('Checking Supabase connection details...\n');

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.error('❌ DATABASE_URL is not set in .env file');
  process.exit(1);
}

// Parse the connection string - handle both postgres:// and postgresql://
const urlMatch = dbUrl.match(/(?:postgresql|postgres):\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(.+?)(\?.*)?$/);

if (!urlMatch) {
  console.error('❌ DATABASE_URL format is invalid');
  console.error('Expected format: postgresql://user:password@host:port/database');
  console.error('Your URL starts with:', dbUrl.substring(0, 30) + '...');
  process.exit(1);
}

const [, user, password, host, port, database] = urlMatch;

console.log('📋 Connection details:');
console.log(`  User: ${user}`);
console.log(`  Host: ${host}`);
console.log(`  Port: ${port}`);
console.log(`  Database: ${database}`);
console.log(`  Password: ${password.length > 0 ? '***' + password.slice(-4) : 'NOT SET'}`);

// Check if it's a Supabase host
if (host.includes('supabase.co')) {
  console.log('\n✅ This is a Supabase database');
  
  console.log('\n💡 Supabase connection tips:');
  console.log('1. For direct connections, use port 5432');
  console.log('2. For connection pooling (recommended), use port 6543');
  console.log('3. Make sure your database password is correct');
  console.log('4. Check if your Supabase project is paused (free tier pauses after 1 week of inactivity)');
  
  if (port === '5432') {
    console.log('\n⚠️  You are using the direct connection port (5432).');
    console.log('   Consider using the pooler port (6543) for better reliability.');
    console.log('   Update your DATABASE_URL by changing :5432 to :6543');
  } else if (port === '6543') {
    console.log('\n✅ You are using the connection pooler (recommended)');
  }
} else {
  console.log('\n⚠️  This does not appear to be a Supabase database');
}

console.log('\n📌 To test the connection manually:');
console.log(`   psql "${dbUrl.replace(password, '***')}"`);