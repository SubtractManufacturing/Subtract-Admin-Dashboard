import 'dotenv/config';
import { db } from "../app/lib/db";
import { users } from "../app/lib/db/schema";

async function checkUsers() {
  try {
    const allUsers = await db.select().from(users);
    console.log(`Total users in database: ${allUsers.length}`);
    
    allUsers.forEach(user => {
      console.log(`User: ${user.id} - ${user.name || 'NO NAME'} - ${user.email}`);
    });
    
    // Check for the specific user ID from the notes
    const specificUserId = "944163a3-884a-4209-b220-c927a8890455";
    const specificUser = allUsers.find(u => u.id === specificUserId);
    
    if (specificUser) {
      console.log(`\nFound user ${specificUserId}:`, specificUser);
    } else {
      console.log(`\nUser ${specificUserId} NOT FOUND in database`);
    }
    
  } catch (error) {
    console.error("Failed to check users:", error);
  }
}

checkUsers()
  .then(() => {
    console.log("\nCheck completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nCheck failed:", error);
    process.exit(1);
  });