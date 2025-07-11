import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

async function testSupabaseConnection() {
  console.log('Testing Supabase connection...\n');
  
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }
  
  console.log('Supabase URL:', supabaseUrl);
  
  try {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Test auth endpoint
    console.log('\nTesting auth endpoint...');
    const { data: authData, error: authError } = await supabase.auth.getSession();
    
    if (authError) {
      console.error('Auth error:', authError);
    } else {
      console.log('✅ Auth endpoint accessible');
      console.log('Current session:', authData.session ? 'Active' : 'None');
    }
    
    // Test database via Supabase client
    console.log('\nTesting database query via Supabase client...');
    const { data, error } = await supabase
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('Database error:', error);
      if (error.message.includes('relation') && error.message.includes('does not exist')) {
        console.log('\n💡 Users table does not exist yet. This is expected for a fresh setup.');
      }
    } else {
      console.log('✅ Database accessible via Supabase client');
    }
    
  } catch (error: any) {
    console.error('\n❌ Unexpected error:', error.message);
  }
  
  console.log('\n📌 Next steps:');
  console.log('1. If the Supabase client works but direct database connection fails,');
  console.log('   you may need to use Supabase client for database operations');
  console.log('   or check your network settings for PostgreSQL connections.');
  console.log('2. Make sure your Supabase project is not paused (check dashboard)');
}

testSupabaseConnection();