---
name: Smart Bubble PostgreSQL proof
description: How to interpret and run the focused Smart Bubble lifecycle proof in this workspace.
---

The Smart Bubble lifecycle proof must run through the canonical Runtime TypeScript configuration and use numeric owner IDs. The focused proof is the reliable signal for Bubble list, projection, owner isolation, versioned presentation transitions, archive, and restore.

**Why:** The scripts package does not inherit canonical `@db/*` aliases by default, and the broader historical world proof continues into an unrelated Task insert path with a separate schema failure. Treating that broad failure as a Bubble regression is misleading.

**How to apply:** Run the focused `test:jasim-smart-bubbles` script first. Investigate failures from the broader `test:jasim-world-runtime` proof separately as Task/Runtime work rather than weakening Bubble assertions.