import 'dotenv/config';
import { db } from "../app/lib/db";
import { users } from "../app/lib/db/schema";
import { eq } from "drizzle-orm";

async function ensureAdminUser() {
  try {
    // The admin user ID from the notes
    const adminUserId = "944163a3-884a-4209-b220-c927a8890455";
    const adminEmail = "admin@test.com";
    const adminName = "Admin";
    
    // Check if user exists
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.id, adminUserId))
      .limit(1);
    
    if (existingUser.length === 0) {
      console.log(`Creating admin user ${adminUserId}...`);
      
      await db.insert(users).values({
        id: adminUserId,
        email: adminEmail,
        name: adminName,
        createdAt: new Date()
      });
      
      console.log("Admin user created successfully!");
    } else {
      console.log("Admin user already exists:", existingUser[0]);
      
      // Update name if it's missing
      if (!existingUser[0].name) {
        console.log("Updating admin user name...");
        await db
          .update(users)
          .set({ name: adminName })
          .where(eq(users.id, adminUserId));
        console.log("Admin user name updated!");
      }
    }
    
  } catch (error) {
    console.error("Failed to ensure admin user:", error);
    throw error;
  }
}

ensureAdminUser()
  .then(() => {
    console.log("\nAdmin user check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nAdmin user check failed:", error);
    process.exit(1);
  });