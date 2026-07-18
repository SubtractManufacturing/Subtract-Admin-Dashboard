import { createClient } from "@supabase/supabase-js";
import { db } from "../app/lib/db";
import { users, type NewUser } from "../app/lib/db/schema";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing required environment variables:");
  console.error("- NEXT_PUBLIC_SUPABASE_URL");
  console.error("- SUPABASE_SERVICE_ROLE_KEY (admin/service role key needed)");
  process.exit(1);
}

// Create admin client with service role key to access auth.users
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function syncAuthUsers() {
  try {
    console.log("Starting auth user sync...");
    
    // Fetch all users from Supabase auth
    const { data: authUsers, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
      console.error("Error fetching auth users:", error);
      return;
    }
    
    if (!authUsers || authUsers.users.length === 0) {
      console.log("No auth users found");
      return;
    }
    
    console.log(`Found ${authUsers.users.length} auth users`);
    
    for (const authUser of authUsers.users) {
      try {
        // Check if user already exists in public.users
        const existingUser = await db
          .select()
          .from(users)
          .where(eq(users.id, authUser.id))
          .limit(1);
        
        if (existingUser.length > 0) {
          // Update existing user
          console.log(`Updating user: ${authUser.email}`);
          await db
            .update(users)
            .set({
              email: authUser.email || '',
              name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || null,
              updatedAt: new Date(),
            })
            .where(eq(users.id, authUser.id));
        } else {
          // Create new user
          console.log(`Creating user: ${authUser.email}`);
          const newUser: NewUser = {
            id: authUser.id,
            email: authUser.email || '',
            name: authUser.user_metadata?.name || authUser.user_metadata?.full_name || null,
            role: "User", // Default role
          };
          
          await db.insert(users).values(newUser);
        }
      } catch (userError) {
        console.error(`Error syncing user ${authUser.email}:`, userError);
      }
    }
    
    console.log("Auth user sync completed successfully!");
    
    // Show summary
    const totalUsers = await db.select().from(users);
    console.log(`Total users in database: ${totalUsers.length}`);
    
  } catch (error) {
    console.error("Sync failed:", error);
  } finally {
    process.exit(0);
  }
}

// Run the sync
syncAuthUsers();