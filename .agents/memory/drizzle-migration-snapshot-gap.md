---
name: Drizzle migration snapshot gap
description: drizzle-kit generate in the canonical app can emit broken migrations because early meta snapshots are missing; verify generated SQL and record hashes manually.
---

The canonical app (`canonical/جاسم/app/db/migrations-pg/`) is missing drizzle meta snapshots for the earliest migrations, so `drizzle-kit generate` diffs against an incomplete snapshot and may emit `CREATE TABLE` statements for tables that already exist. Applying such a migration fails at runtime.

**Why:** Discovered when generating the economic-fabric migration — the generated SQL duplicated pre-existing tables because the diff base was wrong.

**How to apply:**
- After `drizzle-kit generate`, always read the emitted SQL and confirm it contains ONLY the intended delta before applying.
- If it contains pre-existing tables, hand-trim the SQL, apply it with a plain `pg` client, and record the file's sha256 in `drizzle.__drizzle_migrations` manually (matching drizzle's hash format), keeping `_journal.json` consistent.
- Once the latest snapshot is complete again, subsequent `generate` runs produce clean deltas.
