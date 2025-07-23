import { migrateOrderNotes } from "../app/lib/migrate-notes";

async function run() {
  console.log("Starting order notes migration...");
  
  try {
    await migrateOrderNotes();
    console.log("Migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

run();