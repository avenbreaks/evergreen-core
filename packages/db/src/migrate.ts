import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDb } from "./client";

const currentDir = dirname(fileURLToPath(import.meta.url));

export const runMigrations = async (databaseUrl: string): Promise<void> => {
  const db = createDb(databaseUrl);
  const migrationsFolder = resolve(currentDir, "../drizzle");

  await migrate(db, { migrationsFolder });
};
