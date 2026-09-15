---
name: Smart UI truthfulness gates
description: Durable rules for preventing runtime and presentation paths from turning accepted, partial, or unverified work into success.
---

The Smart UI must treat provider content, internal artifact fields, dispatcher acceptance, and node completion as data only. User-visible success and retry permission require an explicit independently verified receipt state.

**Why:** A normal-looking provider stub, an accepted dispatcher request, or a missing verification field can otherwise create a false success claim even when no provider result or business effect has been proved.

**How to apply:** Gate success on complete current-node coverage plus `verificationStatus === "VERIFIED"`. Treat `PENDING`, `INCONCLUSIVE`, failed, and missing verification as non-success; only allow retry when the explicit terminal verification state authorizes it. Use neutral wording for accepted actions.