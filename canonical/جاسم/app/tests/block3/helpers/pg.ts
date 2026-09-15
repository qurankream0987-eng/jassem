import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { sql } from "drizzle-orm";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const TEST_DATABASE = "jasim_block3_test";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fullSchema = { ...schema, ...relations };

export type TestDbHandle = {
  db: NodePgDatabase<typeof fullSchema>;
  pool: Pool;
};

let handlePromise: Promise<TestDbHandle> | undefined;

function databaseUrl(database: string): string {
  const source = process.env.DATABASE_URL;
  if (!source) {
    throw new Error("DATABASE_URL is required for the Block 3 PostgreSQL tests");
  }
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

  const pool = new Pool({ connectionString: databaseUrl(TEST_DATABASE), max: 30 });
  const db = drizzle(pool, { schema: fullSchema });
  await migrate(db, {
    migrationsFolder: path.resolve(__dirname, "../../../db/migrations-pg"),
  });
  return { db, pool };
}

export function getTestDb(): Promise<TestDbHandle> {
  handlePromise ??= initialize();
  return handlePromise;
}

/** Reset every table Block 3 tests touch (Block 2 substrate included). */
export async function resetBlock3(db: NodePgDatabase<any>): Promise<void> {
  await db.execute(sql.raw(`
    TRUNCATE TABLE
      commercial_orders,
      payment_intents,
      payment_method_references,
      mandate_budgets,
      economic_ledger_entries,
      fee_rules,
      plans,
      subscriptions,
      entitlements,
      usage_records,
      capability_provider_catalog,
      memberships,
      delegation_grants,
      temporal_triggers,
      availability_windows,
      reservations,
      observations,
      track_sessions,
      assignments,
      remote_executions,
      notification_intents,
      events,
      event_subscriptions,
      external_webhook_events,
      runtime_jobs,
      runtime_job_events
    CASCADE
  `));
}
