import { db } from "./db/index";
import { orders } from "./db/schema";
import { eq } from "drizzle-orm";

interface OldOrderNote {
  id: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  note: string;
  createdAt: string;
}

interface OldOrderNotesData {
  notes: OldOrderNote[];
}

interface NewOrderNote {
  id: string;
  userId: string;
  note: string;
  createdAt: string;
}

interface NewOrderNotesData {
  notes: NewOrderNote[];
}

// Function to migrate notes from old format to new format
export async function migrateOrderNotes(): Promise<void> {
  try {
    // Get all orders with notes
    const ordersWithNotes = await db
      .select({
        id: orders.id,
        notes: orders.notes
      })
      .from(orders)
      .where(orders.notes.isNotNull());

    console.log(`Found ${ordersWithNotes.length} orders with notes to migrate`);

    for (const order of ordersWithNotes) {
      if (!order.notes) continue;

      try {
        const oldNotesData = JSON.parse(order.notes) as OldOrderNotesData;
        
        // Convert to new format by removing userName and userEmail
        const newNotesData: NewOrderNotesData = {
          notes: oldNotesData.notes.map(note => ({
            id: note.id,
            userId: note.userId,
            note: note.note,
            createdAt: note.createdAt
          }))
        };

        // Update the order with new format
        await db
          .update(orders)
          .set({ notes: JSON.stringify(newNotesData) })
          .where(eq(orders.id, order.id));

        console.log(`Migrated notes for order ${order.id}`);
      } catch (error) {
        console.error(`Failed to migrate notes for order ${order.id}:`, error);
      }
    }

    console.log("Notes migration completed");
  } catch (error) {
    console.error("Failed to migrate notes:", error);
    throw error;
  }
}