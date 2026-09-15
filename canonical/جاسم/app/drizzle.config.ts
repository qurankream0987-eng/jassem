import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

const migrationDirectory =
  process.env.JASIM_MIGRATION_PROOF === "1" && process.env.JASIM_MIGRATIONS_OUT
    ? process.env.JASIM_MIGRATIONS_OUT
    : "./db/migrations-pg";

export default defineConfig({
  schema: "./db/schema.ts",
  // pg migrations kept separate from the original mysql migration history
  out: migrationDirectory,
  dialect: "postgresql",
  dbCredentials: {
    url: connectionString,
  },
});
