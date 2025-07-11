import { createClient } from '@supabase/supabase-js';
import { db } from '../app/lib/db';
import { users } from '../app/lib/db/schema';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseServiceKey) {
  console.error('Please set SUPABASE_SERVICE_ROLE_KEY in your .env file');
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
    // Check if user already exists
    const { data: existingAuth } = await supabase.auth.admin.listUsers();
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
    const existingDbUser = await db.select().from(users).where(eq(users.id, authUserId));

    if (existingDbUser.length === 0) {
      // Create corresponding database user
      console.log('Creating database user...');
      await db.insert(users).values({
        id: authUserId,
        email,
        name: 'Admin User',
      });
    } else {
      console.log('Database user already exists');
    }

    console.log('Admin user setup complete!');
    console.log(`Email: ${email}`);
    console.log('Password: [as configured in DEV_ADMIN_PASSWORD]');
    
  } catch (error) {
    console.error('Error in setup:', error);
  } finally {
    process.exit(0);
  }
}

// Import eq from drizzle-orm
import { eq } from 'drizzle-orm';

setupAdminUser();