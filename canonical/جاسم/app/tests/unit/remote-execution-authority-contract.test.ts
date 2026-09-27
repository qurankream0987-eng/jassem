/**
 * JASIM — THE REMOTE EXECUTION AUTHORITY CONTRACT.
 *
 * Checked without a database, a provider or a socket: what decides where a
 * remote call goes, what it presents, and what may never decide either.
 *
 *   DISCOVERED_PROVIDER != AUTHORIZED_CONNECTION
 *   DISCOVERED_ENDPOINT != AUTHORIZED_DESTINATION · SSRF_SAFE != AUTHORIZED
 *   PROVIDER_CANDIDATE != PROVIDER_BINDING
 *   DISCOVERY_ID_IMPLICITLY_EQUALS_DEFINITION_ID = 0
 *   PROTOCOL_AUTHORITY_RUNTIMES_ADDED = 0
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8");
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

const RUNTIME = strip(read("api/runtime/jasim-runtime.ts"));
const POLLING = strip(read("api/runtime/block2/remote-polling.ts"));
const BINDING = strip(read("api/runtime/provider-binding.ts"));
const CANDIDATE = strip(read("api/runtime/capability-provider.ts"));
const CLIENT = strip(read("api/runtime/block2/mcp-client.ts"));

describe("the remote execution authority contract", () => {
  it("no remote path can reach a discovered endpoint any more", () => {
    //   DISCOVERY_ENDPOINT_USED_FOR_EXECUTION_AUTHORITY = 0
    //   DISCOVERY_ENDPOINT_USED_FOR_POLL = 0 · FOR_CANCEL = 0
    //
    // The helper that read a candidate's own account of where it lives is gone,
    // and the polling module no longer reads the discovery table at all.
    expect(RUNTIME).not.toMatch(/function remoteProviderEndpoint/);
    expect(RUNTIME).not.toMatch(/provenance\.reference/);
    expect(POLLING).not.toMatch(/capabilityProviderCatalog|ioMetadata|providerConfiguration/);
    // Every remote client is built from a canonical connection's endpoint.
    expect(RUNTIME).toMatch(/createMcpClient\(\{\s*baseUrl: remoteConnection!\.endpoint,/);
    expect(POLLING).toMatch(/defaultClientFactory\)\(connection\.endpoint, connection\.headers\)/);
  });

  it("the two id namespaces are bridged by trusted configuration only", () => {
    //   DISCOVERY_ID_IMPLICITLY_EQUALS_DEFINITION_ID = 0
    //
    // A candidate carries the bridge, discovery may not set it, and the runtime
    // refuses to execute a candidate that has none.
    expect(CANDIDATE).toMatch(/definitionId\?: string;/);
    expect(CANDIDATE).toMatch(/DISCOVERY_SOURCES\.has\(provider\.provenance\.source\)/);
    expect(CANDIDATE).toMatch(/"MCP_CATALOG", "A2A_AGENT_CARD"/);
    expect(RUNTIME).toMatch(/providerDefinitionId = provider\.definitionId \?\? null;/);
    expect(RUNTIME).toMatch(/if \(!providerDefinitionId\) \{/);
    // And nothing passes a candidate id where a definition id is expected.
    // The candidate id is never handed to anything that expects a definition.
    expect(RUNTIME).not.toMatch(/definitionId: providerBinding\.providerId/);
    expect(RUNTIME).not.toMatch(/providerId: providerBinding\.providerId,\s*bindingId: null/);
    expect(RUNTIME).toMatch(/definitionId: providerDefinitionId,/);
    expect(RUNTIME).toMatch(/providerId: providerDefinitionId,\s*bindingId: providerAccountRef,/);
  });

  it("the destination and the credential leave by the same door", () => {
    //   CREDENTIAL_BINDING_DIFFERS_FROM_ENDPOINT_BINDING = 0
    //   TRUSTED_CREDENTIAL + UNTRUSTED_DESTINATION = INVALID CONNECTION
    const gate = BINDING.slice(
      BINDING.indexOf("export async function authorizedConnection"),
      BINDING.indexOf("export function httpAuthorizationFor"),
    );
    // One row, read once, and both facts derived from it.
    expect(gate.match(/\.from\(scopeProviderBindings\)/g)).toHaveLength(1);
    expect(gate).toMatch(/const endpoint = endpointOf\(row, definition\);/);
    expect(gate).toMatch(/const credential = await credentialFor\(row\);/);
    // Nothing returns one without the other.
    expect(gate).not.toMatch(/return \{ status: "AUTHORIZED", connection: \{ endpoint \}/);
    // The gate itself: this scope, this provider, VERIFIED, and granted.
    expect(gate).toMatch(/row\.scopeId !== input\.onBehalfOfScopeId/);
    expect(gate).toMatch(/row\.definitionId !== input\.definitionId/);
    expect(gate).toMatch(/row\.lifecycle !== "VERIFIED"/);
    //
    // ── AN INHERITED EXPECTATION THAT CHANGED ──────────────────────────────
    //
    // OLD_EXPECTATION: the gate compares the call's SIDE of the vocabulary
    //   against the side of some granted capability.
    // WHY_IT_IS_WRONG: it was too weak, and this assertion is what pinned the
    //   weakness in place. A side is a classification: a connection granted
    //   only PAY passed a DELETE, and one granted only OBSERVE passed a SEARCH.
    // NEW_EXPECTATION: the gate requires the EXACT verb, in the grant list and
    //   in the definition's manifest.
    // WHY_THE_NEW_EXPECTATION_IS_STRICTER: it is the rule the other two doors
    //   in the same runtime always applied, and this door was the only one that
    //   did not. `capabilityMutates` keeps its job — the read/write partition —
    //   and stops being authority.
    //
    //   SAME_EFFECT_SIDE != SAME_AUTHORITY
    //   ANY_MUTATING_GRANT_AUTHORIZES_ANY_MUTATION = 0
    //
    expect(gate).not.toMatch(/capabilityMutates/);
    expect(gate).toMatch(/row\.grantedCapabilities\.includes\(input\.requiresCapability\)/);
    expect(gate).toMatch(/definition\.supports\.includes\(input\.requiresCapability\)/);
    // An operation nobody named is refused rather than defaulted.
    expect(gate).toMatch(/if \(!input\.requiresCapability \|\| !isCapability\(input\.requiresCapability\)\)/);
    // And a null account is refused rather than searched for.
    expect(gate).toMatch(/if \(!input\.bindingId\) \{/);
    expect(gate).not.toMatch(/orderBy|desc\(|createdAt/);
  });

  it("the pinned account is read, never reselected", () => {
    //   POLL_RESELECTS_PROVIDER_BINDING = 0 · CANCEL_RESELECTS = 0
    //   NULL_PROVIDER_BINDING_POLL_ALLOWED = 0
    expect(POLLING).toMatch(/bindingId: execution\.providerBindingRef/);
    expect(POLLING).toMatch(/definitionId: execution\.providerDefinitionId/);
    // No lookup by scope, provider, recency or preference anywhere in the
    // follow-up paths.
    expect(POLLING).not.toMatch(/accountBindingFor|usableBindingFor|verifiedBindingsFor/);
    expect(POLLING).not.toMatch(/orderBy|preferredProviders|scopePolicies/);
    // A readback and a cancellation are different OPERATIONS, each requiring
    // the exact verb the execution pinned for it — not a side, and not each
    // other's.
    expect(POLLING).toMatch(/pinnedConnection\(execution, "readback"\)/);
    expect(POLLING).toMatch(/pinnedConnection\(execution, "cancel"\)/);
    expect(POLLING).toMatch(/execution\.authorizedOperations\?\.\[operation\] \?\? null/);
    // And the authority check happens before the cancellation moves state.
    const cancel = POLLING.slice(POLLING.indexOf("export async function requestRemoteCancellation"));
    expect(cancel.indexOf('pinnedConnection(execution, "MUTATING")')).toBeLessThan(
      cancel.indexOf('to: "CANCEL_REQUESTED"'),
    );
  });

  it("a credential never reaches a URL, a row, or another origin", () => {
    //   RAW_PROVIDER_CREDENTIAL_IN_REMOTE_EXECUTION = 0
    //   CREDENTIAL_REDIRECT_TO_UNTRUSTED_ORIGIN = 0
    //
    // The material becomes one header and nothing else: no query string, no
    // path, and no column on the execution row.
    const shaping = BINDING.slice(
      BINDING.indexOf("export function httpAuthorizationFor"),
      BINDING.indexOf("export async function accountBindingFor"),
    );
    expect(shaping).toMatch(/authorization: `Bearer/);
    // Nothing here builds a URL, so there is no query string for material to
    // arrive in. `?` is not searched for as a character because the language
    // uses it; the absence of URL construction is the stronger statement.
    expect(shaping).not.toMatch(/searchParams|new URL\(|endpoint/);
    // A certificate is refused rather than sent as text.
    expect(shaping).toMatch(/case "CERTIFICATE":\s*throw new ProviderBindingError/);
    // The execution row records identities, never material.
    const create = strip(read("api/runtime/block2/remote-execution.ts"));
    expect(create).not.toMatch(/credential|apiKey|secret|authorization/i);
    // And a credential-carrying request refuses a cross-origin redirect.
    expect(CLIENT).toMatch(/this\.carriesCredential && next\.origin !== new URL\(endpoint\.url\)\.origin/);
    expect(CLIENT).toMatch(/name\.toLowerCase\(\) === "authorization"/);
  });

  it("authority stays in the general runtime, with no protocol runtime beside it", () => {
    //   PROTOCOL_AUTHORITY_RUNTIMES_ADDED = 0
    for (const name of [
      "McpAuthorityRuntime", "A2AEndpointAuthority", "McpCredentialStore",
      "RemoteAgentBindingRuntime",
    ]) {
      expect(BINDING, name).not.toContain(name);
      expect(POLLING, name).not.toContain(name);
      expect(RUNTIME, name).not.toContain(name);
    }
    // The gate is the binding runtime's, and the protocol module holds none of it.
    expect(POLLING).toMatch(/from "\.\.\/provider-binding"/);
    expect(CLIENT).not.toMatch(/scopeProviderBindings|providerCredentialVault|lifecycle/);
    // And no provider or domain is named where authority is decided.
    const gate = BINDING.slice(
      BINDING.indexOf("export async function authorizedConnection"),
      BINDING.indexOf("export async function accountBindingFor"),
    );
    for (const name of ["Mcp", "A2A", "Stripe", "Restaurant", "Car"]) {
      expect(gate, name).not.toContain(name);
    }
  });
});
