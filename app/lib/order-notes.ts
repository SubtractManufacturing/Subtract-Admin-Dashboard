import { db } from "./db/index";
import { orders, users } from "./db/schema";
import { eq, inArray } from "drizzle-orm";

export interface OrderNote {
  id: string;
  userId: string;
  note: string;
  createdAt: string;
  // Old format fields (for backward compatibility)
  userName?: string;
  userEmail?: string;
}

export interface OrderNotesData {
  notes: OrderNote[];
}

export interface OrderNoteWithUser extends OrderNote {
  userName: string | null;
  userEmail: string;
}

export async function getOrderNotesWithUsers(order: any): Promise<OrderNoteWithUser[]> {
  try {
    if (!order.notes) {
      return [];
    }
    
    const notesData = JSON.parse(order.notes);
    const notes = notesData.notes || [];
    
    if (notes.length === 0) {
      return [];
    }
    
    // Get unique user IDs
    const userIds = [...new Set(notes.map((note: any) => note.userId))];
    console.log("User IDs from notes:", userIds);
    
    // Fetch user information
    let usersData = [];
    try {
      usersData = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email
        })
        .from(users)
        .where(inArray(users.id, userIds));
      
      console.log("Users found:", usersData);
    } catch (dbError) {
      console.error("Failed to fetch users from database:", dbError);
      // Continue with empty users array, will use fallback display
    }
    
    // Create a map for quick lookup
    const userMap = new Map(usersData.map(user => [user.id, user]));
    
    // Combine notes with user information
    return notes.map((note: any) => {
      const user = userMap.get(note.userId);
      console.log(`Note userId: ${note.userId}, Found user:`, user);
      console.log(`Note data:`, note);
      
      // Check if note has old format with stored user info
      // If user not found, try to use stored info from old format
      let userName = user?.name || note.userName || null;
      let userEmail = user?.email || note.userEmail || null;
      
      console.log(`Resolved userName: ${userName}, userEmail: ${userEmail}`);
      
      // If we still don't have user info, try to make it more informative
      if (!user && !userEmail) {
        // Show partial user ID to help identify the user
        userEmail = `User ${note.userId.substring(0, 8)}...`;
      }
      
      return {
        id: note.id,
        userId: note.userId,
        note: note.note,
        createdAt: note.createdAt,
        userName,
        userEmail
      };
    });
  } catch (error) {
    console.error(`Failed to get order notes with users: ${error}`);
    return [];
  }
}

export async function getOrderNotes(order: any): Promise<OrderNote[]> {
  try {
    if (!order.notes) {
      return [];
    }
    const notesData = JSON.parse(order.notes) as OrderNotesData;
    return notesData.notes || [];
  } catch (error) {
    console.error(`Failed to parse order notes: ${error}`);
    console.error(`Order notes value:`, order.notes);
    return [];
  }
}

export async function addOrderNote(
  orderId: number,
  userId: string,
  note: string
): Promise<void> {
  try {
    // Get current order
    const [currentOrder] = await db
      .select({ notes: orders.notes })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    // Parse existing notes or create new structure
    let notesData: OrderNotesData = { notes: [] };
    if (currentOrder?.notes) {
      try {
        notesData = JSON.parse(currentOrder.notes) as OrderNotesData;
      } catch {
        // If parsing fails, start fresh
        notesData = { notes: [] };
      }
    }

    // Add new note
    const newNote: OrderNote = {
      id: Date.now().toString(), // Simple ID generation
      userId,
      note,
      createdAt: new Date().toISOString(),
    };

    notesData.notes.unshift(newNote); // Add to beginning

    // Update order with new notes
    await db
      .update(orders)
      .set({ notes: JSON.stringify(notesData) })
      .where(eq(orders.id, orderId));
  } catch (error) {
    console.error(`Failed to add order note: ${error}`);
    throw error;
  }
}

export async function updateOrderNote(
  orderId: number,
  noteId: string,
  newNoteText: string
): Promise<void> {
  try {
    // Get current order
    const [currentOrder] = await db
      .select({ notes: orders.notes })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!currentOrder?.notes) {
      throw new Error("No notes found");
    }

    // Parse existing notes
    const notesData = JSON.parse(currentOrder.notes) as OrderNotesData;
    
    // Find and update the note
    const noteIndex = notesData.notes.findIndex(note => note.id === noteId);
    if (noteIndex === -1) {
      throw new Error("Note not found");
    }

    notesData.notes[noteIndex].note = newNoteText;

    // Update order with modified notes
    await db
      .update(orders)
      .set({ notes: JSON.stringify(notesData) })
      .where(eq(orders.id, orderId));
  } catch (error) {
    console.error(`Failed to update order note: ${error}`);
    throw error;
  }
}

export async function deleteOrderNote(
  orderId: number,
  noteId: string
): Promise<void> {
  try {
    // Get current order
    const [currentOrder] = await db
      .select({ notes: orders.notes })
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);

    if (!currentOrder?.notes) {
      throw new Error("No notes found");
    }

    // Parse existing notes
    const notesData = JSON.parse(currentOrder.notes) as OrderNotesData;
    
    // Filter out the note to delete
    notesData.notes = notesData.notes.filter(note => note.id !== noteId);

    // Update order with remaining notes
    await db
      .update(orders)
      .set({ notes: JSON.stringify(notesData) })
      .where(eq(orders.id, orderId));
  } catch (error) {
    console.error(`Failed to delete order note: ${error}`);
    throw error;
  }
}