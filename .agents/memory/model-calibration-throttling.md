---
name: Model calibration throttling
description: Constraints for running evidence-based model comparisons through the active Replit OpenAI-compatible provider.
---

Model calibration is valid only when every candidate row is a successful provider response. Persist candidate results, retry failed rows with backoff, and do not turn HTTP 429 responses or empty completions into zero-quality scores.

**Why:** A burst comparison run can exhaust the active provider's rate allowance even when model availability probes succeed. Treating failed requests as outputs would bias routing and cost decisions.

**How to apply:** Run candidate and judge calls in resumable, rate-limited batches. If the provider remains rate-limited after a cooldown, report the economic comparison as not measured and keep model mappings provisional.