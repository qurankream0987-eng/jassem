---
name: Provider fabric trust boundaries
description: Block 1.1 rules — no global provider registry, fail-closed freshness leases for non-native providers, JASIM-controlled semantic keys only
---

# Provider fabric trust boundaries (Block 1.1)

Rules the architect enforced and future provider work must not regress:

1. **No process-global provider registry.** Each `CapabilityRegistry` instance owns its `CapabilityProviderRegistry`; `resolveProvider`/`searchProviderCatalog`/`loadFullProviderContracts` require an explicit registry argument. A global default let test-only registries mint globally TRUSTED_CORE providers and silently cross-wire same-id handlers.
2. **Non-NATIVE providers fail closed on freshness.** Missing `freshness.expiresAt` = STALE, never selectable. NATIVE providers are code-bound and exempt unless carrying an expired lease.
3. **Remote metadata is data, never proof.** `semanticMapCandidate` matches only `semanticKeys` (structured A2A `skill.semantic` or JASIM-side `declaredSemantics`) — never free-text descriptions or remote tool names; external-effectful/authority-bound capabilities are never auto-mapped.

**Why:** First architect review of Block 1.1 failed on exactly these three trust-boundary defects; fixing them was required for PASS.

**How to apply:** Any new provider kind, promotion flow, or remote integration (MCP/A2A runtime work in Block 2) must preserve all three — promotion only via server-side trust approval + expiry issuance.
