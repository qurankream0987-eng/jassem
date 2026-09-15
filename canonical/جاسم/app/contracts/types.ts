/**
 * JASIM Contracts — Legacy Re-exports
 * Kept for backwards compatibility. Prefer importing from `index.ts`.
 */
export type * from "./jasim";
export * from "./constants";
export * from "./errors";
export * from "./zod";
// Resolve the TaskError name clash between ./jasim (interface) and ./errors (class):
// the errors.ts class wins for this legacy barrel.
export { TaskError } from "./errors";
