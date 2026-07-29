import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDatabase, getDatabase } from "@/src/server/db/client";

try {
  await migrate(getDatabase(), { migrationsFolder: "drizzle" });
  console.info("Database migrations completed.");
} finally {
  await closeDatabase();
}
