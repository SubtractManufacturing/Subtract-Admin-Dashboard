import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseServiceKey) {
  console.error('Please set SUPABASE_SERVICE_ROLE_KEY in your .env file');
  console.log('You can find this in Supabase Dashboard > Settings > API > Service Role Key');
  process.exit(1);
}

const supabase = createClient(
  supabaseUrl,
  supabaseServiceKey // Need service role for admin operations
);

async function setupAdminUser() {
  const email = 'Admin@test.com';
  const password = process.env.DEV_ADMIN_PASSWORD!;

  if (!password) {
    console.error('Please set DEV_ADMIN_PASSWORD in your .env file');
    process.exit(1);
  }

  try {
    console.log('Setting up admin user...\n');
    
    // First, check if users table exists
    const { data: tables } = await supabase
      .from('users')
      .select('id')
      .limit(1);
    
    if (!tables) {
      console.log('⚠️  Users table does not exist.');
      console.log('\nPlease create the users table first by running this SQL in Supabase SQL Editor:');
      console.log(`
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Create a policy to allow users to read their own data
CREATE POLICY "Users can read own data" ON public.users
  FOR SELECT USING (auth.uid()::text = id);
`);
      process.exit(1);
    }
    
    // Check if user already exists
    console.log('Checking for existing user...');
    const { data: existingAuth, error: listError } = await supabase.auth.admin.listUsers();
    
    if (listError) {
      console.error('Error listing users:', listError);
      console.log('\n⚠️  Make sure you have set SUPABASE_SERVICE_ROLE_KEY correctly');
      return;
    }
    
    const existingUser = existingAuth?.users.find(u => u.email === email);

    let authUserId: string;

    if (existingUser) {
      console.log('Admin auth user already exists, updating password...');
      // Update password
      const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(
        existingUser.id,
        { password }
      );
      
      if (updateError) {
        console.error('Error updating auth user:', updateError);
        return;
      }
      
      authUserId = existingUser.id;
    } else {
      // Create auth user
      console.log('Creating admin auth user...');
      const { data: authUser, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto-confirm email
      });

      if (error) {
        console.error('Error creating auth user:', error);
        return;
      }

      authUserId = authUser.user.id;
    }

    // Check if database user exists
    const { data: existingDbUser } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .single();

    if (!existingDbUser) {
      // Create corresponding database user
      console.log('Creating database user...');
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: authUserId,
          email,
          name: 'Admin User',
        });
      
      if (insertError) {
        console.error('Error creating database user:', insertError);
        return;
      }
    } else {
      console.log('Database user already exists');
    }

    console.log('\n✅ Admin user setup complete!');
    console.log(`Email: ${email}`);
    console.log('Password: [as configured in DEV_ADMIN_PASSWORD]');
    
  } catch (error) {
    console.error('Error in setup:', error);
  }
}

setupAdminUser();