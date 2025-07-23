import { db } from "../app/lib/db";
import { orders, users } from "../app/lib/db/schema";
import { eq, inArray, isNotNull } from "drizzle-orm";

async function syncUsersFromNotes() {
  try {
    // Get all orders with notes
    const ordersWithNotes = await db
      .select({
        id: orders.id,
        notes: orders.notes
      })
      .from(orders)
      .where(isNotNull(orders.notes));

    console.log(`Found ${ordersWithNotes.length} orders with notes`);

    const allUserIds = new Set<string>();

    // Extract all user IDs from notes
    for (const order of ordersWithNotes) {
      if (!order.notes) continue;

      try {
        const notesData = JSON.parse(order.notes);
        const notes = notesData.notes || [];
        
        notes.forEach((note: any) => {
          if (note.userId) {
            allUserIds.add(note.userId);
          }
        });
      } catch (error) {
        console.error(`Failed to parse notes for order ${order.id}:`, error);
      }
    }

    console.log(`Found ${allUserIds.size} unique user IDs in notes`);

    // Check which users exist
    const userIdArray = Array.from(allUserIds);
    const existingUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(inArray(users.id, userIdArray));

    const existingUserIds = new Set(existingUsers.map(u => u.id));
    const missingUserIds = userIdArray.filter(id => !existingUserIds.has(id));

    console.log(`${missingUserIds.length} users are missing from the database`);

    if (missingUserIds.length > 0) {
      console.log("Missing user IDs:", missingUserIds);
      console.log("\nTo fix this, these users need to be added to the users table.");
      console.log("You can either:");
      console.log("1. Have these users log in to the system (which should create their user record)");
      console.log("2. Manually add them to the users table");
    }

    // Also check for users with missing names
    const usersWithoutNames = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name
      })
      .from(users)
      .where(inArray(users.id, userIdArray));

    const usersNeedingNames = usersWithoutNames.filter(u => !u.name);
    if (usersNeedingNames.length > 0) {
      console.log(`\n${usersNeedingNames.length} users have no name set:`);
      usersNeedingNames.forEach(u => {
        console.log(`- ${u.id}: ${u.email}`);
      });
    }

  } catch (error) {
    console.error("Failed to sync users:", error);
    throw error;
  }
}

syncUsersFromNotes()
  .then(() => {
    console.log("\nSync check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nSync check failed:", error);
    process.exit(1);
  });