---
name: GitHub repository upload
description: Replit-specific fallback for publishing a repository through the connected GitHub integration.
---

When the Replit Git CLI/askpass path does not authenticate, the connected GitHub REST client can publish a repository by creating blobs, assembling the tree in chunks, creating one commit, and updating `main`. Keep the upload rate below the connector limit and check the `x-ratelimit-reset` header before retrying after a 403.

**Why:** The GitHub API connection can remain usable for reads while Git CLI authentication or Git Data writes are temporarily unavailable; repeated retries can consume the full 5,000-request core quota.

**How to apply:** Prefer the Git CLI when its connection is working. For REST fallback, upload blobs sequentially with pacing, chunk `createTree` calls, then verify the branch tree recursively and compare required paths.