/**
 * WHAT THE MIGRATIONS DECLARE, AND WHAT THE DATABASE ACTUALLY HAS.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * JASIM had 4136 passing tests and could not answer a single sentence in a
 * browser. Every authenticated request returned 401, because
 * `identity_session_revocations` was missing from the database the app runs on
 * — one of FOURTEEN tables the migration journal declares and the live schema
 * never had, `agreements`, `commitments` and `transactions` among them.
 *
 * The tests never noticed: the Block 3.1 suite RECREATES its database from the
 * journal on every run, so it always has every table. Nothing built the real
 * one that way. `drizzle.__drizzle_migrations` did not exist at all — the
 * migrate command had never run once.
 *
 *   TESTS PASS AGAINST A DATABASE BUILT FROM MIGRATIONS
 *   != THE DATABASE THE APP RUNS ON WAS BUILT THAT WAY
 *
 * So this is not a migration runner — `db:migrate` already is one. It is the
 * thing that was actually missing: something that SAYS SO, in one second,
 * instead of a 401 nobody can trace.
 */
import { readFileSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";

const ROOT = new URL("../db/migrations-pg/", import.meta.url);

/** Every table the journal's migrations create, in journal order. */
export function declaredTables() {
  const journal = JSON.parse(readFileSync(new URL("meta/_journal.json", ROOT), "utf8"));
  const tables = new Set();
  for (const entry of journal.entries) {
    const path = new URL(`${entry.tag}.sql`, ROOT);
    // A journal entry whose file is gone is its own problem, reported below.
    if (!existsSync(path)) continue;
    const sql = readFileSync(path, "utf8");
    for (const match of sql.matchAll(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([a-z_0-9]+)"?/gi)) {
      tables.add(match[1]);
    }
  }
  const missingFiles = journal.entries
    .filter((entry) => !existsSync(new URL(`${entry.tag}.sql`, ROOT)))
    .map((entry) => entry.tag);
  return { tables: [...tables].sort(), missingFiles };
}

/** What the live database has, and what it is missing. */
export async function schemaDrift(databaseUrl) {
  const { tables, missingFiles } = declaredTables();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const live = await pool.query(
      "select tablename from pg_tables where schemaname = 'public'",
    );
    const present = new Set(live.rows.map((row) => row.tablename));
    // A table the live schema has and no migration declares is NOT drift worth
    // failing on: it may predate the journal. A table a migration declares and
    // the schema lacks is the failure this exists for.
    const missing = tables.filter((table) => !present.has(table));
    const applied = await pool
      .query("select count(*)::int as n from drizzle.__drizzle_migrations")
      .then((r) => r.rows[0].n)
      .catch(() => null);
    return { declared: tables.length, present: present.size, missing, missingFiles, applied };
  } finally {
    await pool.end();
  }
}

// `pathToFileURL`, not string concatenation: this repository lives under a
// non-ASCII path, which `import.meta.url` percent-encodes and `argv[1]` does
// not — so the naive comparison silently never matched and this printed
// nothing at all while exiting 0. A check that cannot fail is not a check.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(2);
  }
  const drift = await schemaDrift(url);
  console.log(
    `declared ${drift.declared} tables · live ${drift.present} · ` +
      `migrations recorded as applied: ${drift.applied ?? "no ledger at all"}`,
  );
  for (const tag of drift.missingFiles) console.log(`  journal names a missing file: ${tag}`);
  if (drift.missing.length === 0) {
    console.log("No missing tables.");
    process.exit(0);
  }
  console.error(`\n${drift.missing.length} TABLES THE MIGRATIONS DECLARE AND THIS DATABASE LACKS:`);
  for (const table of drift.missing) console.error(`  - ${table}`);
  console.error("\nRun `npm run db:migrate` against this DATABASE_URL.");
  process.exit(1);
}
