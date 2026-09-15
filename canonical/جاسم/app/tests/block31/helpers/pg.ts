import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const TEST_DATABASE = "jasim_block31_test";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fullSchema = { ...schema, ...relations };

export type TestDbHandle = {
  db: NodePgDatabase<typeof fullSchema>;
  pool: Pool;
};

let handlePromise: Promise<TestDbHandle> | undefined;

function databaseUrl(database: string): string {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required for the Block 3.1 PostgreSQL tests");
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

async function initialize(): Promise<TestDbHandle> {
  const adminPool = new Pool({ connectionString: databaseUrl("postgres") });
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
    await adminPool.query(`CREATE DATABASE ${TEST_DATABASE}`);
  } finally {
    await adminPool.end();
  }
  // Runtime modules use DATABASE_URL when imported, so point both the helper
  // and canonical connection at the isolated proof database.
  process.env.DATABASE_URL = databaseUrl(TEST_DATABASE);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  const db = drizzle(pool, { schema: fullSchema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../db/migrations-pg") });
  return { db, pool };
}

export function getTestDb(): Promise<TestDbHandle> {
  handlePromise ??= initialize();
  return handlePromise;
}

export async function resetBlock31(db: NodePgDatabase<any>): Promise<void> {
  await db.execute(sql.raw(`
    TRUNCATE TABLE runtime_jobs, runtime_job_events, execution_attempts,
      dag_dependencies, dag_nodes, runs CASCADE
  `));
}