import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { readServerEnvironment } from "@/src/server/config/environment";
import * as schema from "@/src/server/db/schema";

type Database = NodePgDatabase<typeof schema>;

type DatabaseState = {
  pool?: Pool;
  database?: Database;
};

const globalDatabaseState = globalThis as typeof globalThis & {
  __baigongDatabase?: DatabaseState;
};

const databaseState = (globalDatabaseState.__baigongDatabase ??= {});

export function getDatabase(): Database {
  if (!databaseState.database) {
    const environment = readServerEnvironment();
    const pool = new Pool({
      connectionString: environment.databaseUrl,
      application_name: "baigong-agent",
      connectionTimeoutMillis: 3_000,
      idleTimeoutMillis: 30_000,
      max: 10,
    });

    databaseState.pool = pool;
    databaseState.database = drizzle(pool, { schema });
  }

  return databaseState.database;
}

export async function pingDatabase(): Promise<void> {
  const database = getDatabase();
  await database.execute("select 1");
}

export async function closeDatabase(): Promise<void> {
  await databaseState.pool?.end();
  databaseState.pool = undefined;
  databaseState.database = undefined;
}
