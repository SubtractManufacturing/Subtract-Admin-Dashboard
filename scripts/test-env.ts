import 'dotenv/config';

console.log('Environment check:');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'Set (hidden for security)' : 'NOT SET');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Set' : 'NOT SET');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set' : 'NOT SET');

// Check if DATABASE_URL looks like localhost
if (process.env.DATABASE_URL) {
  const isLocalhost = process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1');
  console.log('DATABASE_URL points to:', isLocalhost ? 'localhost (incorrect for Supabase)' : 'remote database (correct)');
  
  // Show just the host part (safe to display)
  const match = process.env.DATABASE_URL.match(/postgresql:\/\/[^@]+@([^:\/]+)/);
  if (match) {
    console.log('Database host:', match[1]);
  }
}