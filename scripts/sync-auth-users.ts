import "dotenv/config";
import { createClient, type User } from "@supabase/supabase-js";
import { db } from "../app/lib/db";
import { users, type NewUser } from "../app/lib/db/schema";
import { eq } from "drizzle-orm";
import { getEnv, requireEnv } from "../app/lib/env.server";

const supabaseUrl =
  getEnv("SUPABASE_URL") || requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const supabaseServiceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

// Create admin client with service role key to access auth.users
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

function userLabel(authUser: { id: string }): string {
  return authUser.id;
}

async function listAllAuthUsers(): Promise<User[]> {
  const allUsers: User[] = [];
  const perPage = 100;
  let page = 1;

  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      throw error;
    }

    const batch = data.users;
    allUsers.push(...batch);

    if (batch.length < perPage) {
      break;
    }
    page += 1;
  }

  return allUsers;
}

async function syncAuthUsers() {
  let hadFailure = false;

  try {
    console.log("Starting auth user sync...");

    const authUsers = await listAllAuthUsers();

    if (authUsers.length === 0) {
      console.log("No auth users found");
      return;
    }

    console.log(`Found ${authUsers.length} auth users`);

    for (const authUser of authUsers) {
      try {
        const existingUser = await db
          .select()
          .from(users)
          .where(eq(users.id, authUser.id))
          .limit(1);

        const name =
          authUser.user_metadata?.name ||
          authUser.user_metadata?.full_name ||
          null;

        if (existingUser.length > 0) {
          console.log(`Updating user: ${userLabel(authUser)}`);
          const update: {
            name: string | null;
            updatedAt: Date;
            email?: string;
          } = {
            name,
            updatedAt: new Date(),
          };
          // Preserve stored email when Auth user has no email
          if (authUser.email) {
            update.email = authUser.email;
          }
          await db.update(users).set(update).where(eq(users.id, authUser.id));
        } else {
          if (!authUser.email) {
            console.error(
              `Skipping create for user ${userLabel(authUser)}: missing email`,
            );
            hadFailure = true;
            continue;
          }
          console.log(`Creating user: ${userLabel(authUser)}`);
          const newUser: NewUser = {
            id: authUser.id,
            email: authUser.email,
            name,
            role: "User",
          };

          await db.insert(users).values(newUser);
        }
      } catch (userError) {
        hadFailure = true;
        console.error(
          `Error syncing user ${userLabel(authUser)}:`,
          userError,
        );
      }
    }

    if (hadFailure) {
      console.error("Auth user sync completed with errors.");
    } else {
      console.log("Auth user sync completed successfully!");
    }

    const totalUsers = await db.select().from(users);
    console.log(`Total users in database: ${totalUsers.length}`);
  } catch (error) {
    hadFailure = true;
    console.error("Sync failed:", error);
  } finally {
    process.exit(hadFailure ? 1 : 0);
  }
}

syncAuthUsers();
