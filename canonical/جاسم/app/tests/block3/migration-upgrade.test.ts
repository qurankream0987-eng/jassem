import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsSource = path.resolve(__dirname, "../../db/migrations-pg");
const migrationPattern = /^(\d+)_.*\.sql$/;
const block2Tables = [
  "memberships",
  "delegation_grants",
  "temporal_triggers",
  "availability_windows",
  "reservations",
  "observations",
  "track_sessions",
  "assignments",
  "remote_executions",
  "notification_intents",
  "events",
  "event_subscriptions",
  "external_webhook_events",
  "runtime_jobs",
  "runtime_job_events",
];
const block3Tables = [
  "commercial_orders",
  "payment_intents",
  "payment_method_references",
  "mandate_budgets",
  "economic_ledger_entries",
  "fee_rules",
  "plans",
  "subscriptions",
  "entitlements",
  "usage_records",
];

function databaseUrl(database: string): string {
  const source = process.env.DATABASE_URL;
  if (!source) {
    throw new Error("DATABASE_URL is required for migration upgrade proof");
  }
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

async function migrationFiles(): Promise<string[]> {
  return (await fs.readdir(migrationsSource))
    .filter((file) => migrationPattern.test(file))
    .sort();
}

async function makeMigrationFolder(maxMigration?: number): Promise<string> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "jasim-block3-migrations-"));
  const allFiles = await migrationFiles();
  const selected = maxMigration === undefined
    ? allFiles
    : allFiles.filter((file) => Number(file.match(migrationPattern)?.[1]) <= maxMigration);
  await Promise.all(selected.map((file) => fs.copyFile(
    path.join(migrationsSource, file),
    path.join(folder, file),
  )));

  const journal = JSON.parse(await fs.readFile(
    path.join(migrationsSource, "meta", "_journal.json"),
    "utf8",
  )) as { entries: Array<{ idx: number }> };
  const entries = maxMigration === undefined
    ? journal.entries
    : journal.entries.filter((entry) => entry.idx <= maxMigration);
  await fs.mkdir(path.join(folder, "meta"));
  await fs.writeFile(
    path.join(folder, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }, null, 2),
  );
  return folder;
}

async function createDatabase(name: string): Promise<Pool> {
  const admin = new Pool({ connectionString: databaseUrl("postgres") });
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return new Pool({ connectionString: databaseUrl(name), max: 10 });
}

async function tableNames(pool: Pool): Promise<Set<string>> {
  const result = await pool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  return new Set(result.rows.map(({ table_name }) => table_name));
}

async function assertTables(pool: Pool): Promise<void> {
  const names = await tableNames(pool);
  for (const table of [...block2Tables, ...block3Tables]) {
    expect(names.has(table), `expected table ${table}`).toBe(true);
  }
  const column = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'payment_intents'
        AND column_name = 'providerRef'
    ) AS exists
  `);
  expect(column.rows[0]?.exists).toBe(true);
}

describe("Block 2 to Block 3 migration upgrade proof", () => {
  const databases: string[] = [];
  const pools: Pool[] = [];
  const temporaryFolders: string[] = [];

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()));
    const admin = new Pool({ connectionString: databaseUrl("postgres") });
    try {
      for (const database of databases) {
        await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      }
    } finally {
      await admin.end();
    }
    await Promise.all(temporaryFolders.map((folder) => fs.rm(folder, { recursive: true, force: true })));
  });

  it("FRESH_INSTALL_MIGRATION applies the complete numbered chain", async () => {
    const database = `jasim_block3_fresh_${process.pid}`;
    databases.push(database);
    const pool = await createDatabase(database);
    pools.push(pool);
    const folder = await makeMigrationFolder();
    temporaryFolders.push(folder);

    await migrate(drizzle(pool), { migrationsFolder: folder });
    await assertTables(pool);
  });

  it("BLOCK2_TO_BLOCK3_UPGRADE preserves Block 2 data", async () => {
    const database = `jasim_block3_upgrade_${process.pid}`;
    databases.push(database);
    const pool = await createDatabase(database);
    pools.push(pool);
    const block2Folder = await makeMigrationFolder(8);
    const completeFolder = await makeMigrationFolder();
    temporaryFolders.push(block2Folder, completeFolder);

    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: block2Folder });
    const before = {
      id: "upgrade-grant-1",
      principalOwnerId: "owner-upgrade",
      delegateId: "delegate-upgrade",
      purpose: "migration compatibility proof",
      fingerprint: "upgrade-fingerprint",
    };
    await pool.query(
      `INSERT INTO delegation_grants
       ("id", "principalOwnerId", "delegateId", "purpose", "fingerprint")
       VALUES ($1, $2, $3, $4, $5)`,
      [before.id, before.principalOwnerId, before.delegateId, before.purpose, before.fingerprint],
    );

    await migrate(db, { migrationsFolder: completeFolder });
    await assertTables(pool);
    const result = await pool.query(
      `SELECT "id", "principalOwnerId", "delegateId", "purpose", "fingerprint"
       FROM delegation_grants WHERE "id" = $1`,
      [before.id],
    );
    expect(result.rows).toEqual([before]);
  });
});