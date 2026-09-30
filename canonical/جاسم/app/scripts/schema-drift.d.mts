/** Types for the schema drift check, so `boot.ts` imports it typed. */
export type SchemaDrift = {
  readonly declared: number;
  readonly present: number;
  /** Tables a migration declares and the live schema lacks. Named, not counted. */
  readonly missing: readonly string[];
  /** Journal entries whose .sql file is gone. */
  readonly missingFiles: readonly string[];
  /** Rows in drizzle's ledger, or null when the ledger does not exist at all. */
  readonly applied: number | null;
};
export function declaredTables(): {
  readonly tables: readonly string[];
  readonly missingFiles: readonly string[];
};
export function schemaDrift(databaseUrl: string): Promise<SchemaDrift>;
