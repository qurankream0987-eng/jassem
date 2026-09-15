import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cp, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { Client } from "pg";

const appDirectory = process.cwd();
const canonicalMigrations = resolve(appDirectory, "db/migrations-pg");
const originalDatabaseUrl = process.env.DATABASE_URL;
const expectedMigrationCount = 9;
const requiredTables = [
  "users",
  "conversations",
  "messages",
  "bubbles",
  "runs",
  "dag_nodes",
  "dag_dependencies",
  "execution_proposals",
  "proposal_approvals",
  "execution_attempts",
  "runtime_tasks",
  "jasim_model_usage_ledger",
];

if (!originalDatabaseUrl) {
  throw new Error("DATABASE_URL is required for the Block 0 migration proof.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function databaseUrlFor(databaseName) {
  const url = new URL(originalDatabaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function safeDatabaseName(label) {
  return `jasim_block0_${label}_${randomUUID().replaceAll("-", "")}`;
}

function run(command, args, env) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: appDirectory,
      env,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolveRun();
        return;
      }
      rejectRun(new Error(`${command} ${args.join(" ")} failed (${signal ?? `exit ${code ?? "unknown"}`}).`));
    });
  });
}

async function createDatabase(label) {
  const databaseName = safeDatabaseName(label);
  const admin = new Client({ connectionString: originalDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await admin.end();
  }
  return { databaseName, databaseUrl: databaseUrlFor(databaseName) };
}

async function dropDatabase(databaseName) {
  const admin = new Client({ connectionString: originalDatabaseUrl });
  await admin.connect();
  try {
    await admin.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await admin.end();
  }
}

async function migrate(databaseUrl, migrationDirectory) {
  await run("pnpm", ["run", "db:migrate"], {
    ...process.env,
    DATABASE_URL: databaseUrl,
    JASIM_MIGRATION_PROOF: "1",
    ...(migrationDirectory ? { JASIM_MIGRATIONS_OUT: migrationDirectory } : {}),
  });
}

async function migrationSnapshot(entryCount) {
  const snapshotDirectory = await mkdtemp(join(tmpdir(), "jasim-block0-migrations-"));
  await cp(canonicalMigrations, snapshotDirectory, { recursive: true });
  const journalPath = join(snapshotDirectory, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const removedEntries = journal.entries.slice(entryCount);
  journal.entries = journal.entries.slice(0, entryCount);
  await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  await Promise.all(
    removedEntries.map((entry) => unlink(join(snapshotDirectory, `${entry.tag}.sql`))),
  );
  return snapshotDirectory;
}

async function connect(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function assertRuntimeSchema(databaseUrl) {
  const client = await connect(databaseUrl);
  try {
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])",
      [requiredTables],
    );
    assert(tables.rowCount === requiredTables.length, "Fresh migration did not create the full runtime schema.");
    const ledger = await client.query('SELECT count(*)::int AS count FROM "drizzle"."__drizzle_migrations"');
    assert(ledger.rows[0]?.count === expectedMigrationCount, "Migration ledger does not contain each canonical migration exactly once.");
  } finally {
    await client.end();
  }
}

async function createRepresentativeRow(databaseUrl, label) {
  const unionId = `block0-migration-proof:${label}:${randomUUID()}`;
  const client = await connect(databaseUrl);
  try {
    await client.query('INSERT INTO "users" ("unionId") VALUES ($1)', [unionId]);
  } finally {
    await client.end();
  }
  return unionId;
}

async function assertRepresentativeRow(databaseUrl, unionId) {
  const client = await connect(databaseUrl);
  try {
    const row = await client.query('SELECT "unionId" FROM "users" WHERE "unionId" = $1', [unionId]);
    assert(row.rowCount === 1, "The representative pre-upgrade row was not preserved.");
  } finally {
    await client.end();
  }
}

async function probeRuntimeBoot(databaseUrl) {
  const port = 31_000 + Math.floor(Math.random() * 1_000);
  const child = spawn("pnpm", ["run", "start"], {
    cwd: appDirectory,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      APP_ID: "jasim-block0-migration-proof",
      APP_SECRET: "local-proof-only-not-a-deployed-secret",
      KIMI_AUTH_URL: "http://127.0.0.1:1/proof-auth",
      KIMI_OPEN_URL: "http://127.0.0.1:1/proof-open",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  try {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) return;
      } catch {
        // The HTTP server may still be binding.
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error(`Canonical runtime failed readiness boot: ${output.slice(-1_000)}`);
  } finally {
    const exit = child.exitCode === null ? once(child, "exit") : Promise.resolve();
    if (child.exitCode === null) child.kill("SIGTERM");
    await exit;
  }
}

let checkpointDirectory;
const temporaryDatabases = [];
try {
  const fresh = await createDatabase("fresh");
  temporaryDatabases.push(fresh.databaseName);
  await migrate(fresh.databaseUrl);
  await assertRuntimeSchema(fresh.databaseUrl);
  await probeRuntimeBoot(fresh.databaseUrl);
  await migrate(fresh.databaseUrl);
  await assertRuntimeSchema(fresh.databaseUrl);
  console.log("PASS FRESH_MIGRATE_RUNTIME_BOOT_AND_IDEMPOTENCE");

  checkpointDirectory = await migrationSnapshot(4);
  const upgrade = await createDatabase("upgrade");
  temporaryDatabases.push(upgrade.databaseName);
  await migrate(upgrade.databaseUrl, checkpointDirectory);
  const priorRow = await createRepresentativeRow(upgrade.databaseUrl, "prior-checkpoint");
  await migrate(upgrade.databaseUrl);
  await assertRuntimeSchema(upgrade.databaseUrl);
  await assertRepresentativeRow(upgrade.databaseUrl, priorRow);
  await migrate(upgrade.databaseUrl);
  await assertRuntimeSchema(upgrade.databaseUrl);
  console.log("PASS CHECKPOINT_UPGRADE_PRESERVES_DATA_AND_LEDGER_IDEMPOTENCE");
} finally {
  await Promise.allSettled(temporaryDatabases.map((databaseName) => dropDatabase(databaseName)));
  if (checkpointDirectory) await rm(checkpointDirectory, { recursive: true, force: true });
}