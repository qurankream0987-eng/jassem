---
name: Block 3.1 test isolation
description: PostgreSQL test-suite concurrency and module initialization constraints discovered during Block 3.1 validation.
---

Run the Block 2, Block 3, and Block 3.1 Vitest suites serially. Their helpers create/drop predictable temporary PostgreSQL databases, so concurrent runs collide on database names and produce misleading failures or disconnects.

**Why:** Parallel regression runs caused duplicate-database errors and apparent failures across otherwise passing suites. A serial rerun produced the expected green results.

**How to apply:** Use one suite at a time for the final gate. Tests importing modules with module-level database bindings must dynamically import them after `getTestDb()` has initialized the test database.