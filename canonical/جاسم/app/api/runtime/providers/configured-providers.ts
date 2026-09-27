/**
 * JASIM — WHERE A PROVIDER DEFINITION COMES FROM IN PRODUCTION.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   DISCOVERY_CREATES_PROVIDER_DEFINITION = 0
 *   MODEL_CREATES_PROVIDER_DEFINITION = 0
 *   REMOTE_METADATA_CREATES_PROVIDER_DEFINITION = 0
 *   PRODUCTION_FAKE_PROVIDER = 0
 *
 * ─── AND WHY IT IS A DEPLOYMENT FACT ────────────────────────────────────────
 *
 * A definition says that a business runs a particular kind of system at a
 * particular address, and that JASIM may connect accounts to it. Nothing in a
 * conversation, a discovered tool listing, an agent card or a database row is
 * allowed to assert that. It is the same trust class as the process secret: it
 * arrives from the deployment, is validated once at boot, and a malformed entry
 * is a startup failure rather than a request-time surprise.
 *
 * This ships NO provider. An installation that configures none has an empty
 * registry and no remote call is possible, which is exactly what it was before
 * — the difference is that a deployment can now say otherwise without a code
 * change, and nothing fake was added to pretend it already had.
 *
 * ─── WHAT IT MAY SAY ────────────────────────────────────────────────────────
 *
 *   JASIM_REMOTE_PROVIDERS = [
 *     {
 *       "id": "…", "displayName": "…",
 *       "authMethod": "API_KEY",
 *       "endpoint": "https://…"   |   "DECLARED_AT_SETUP",
 *       "tools": { "SEARCH": "search_inventory", "CANCEL": "cancel_job" },
 *       "webhook": "SIGNED_HMAC", "receipt": "SIGNED_HMAC",
 *       "freshnessSeconds": 900,
 *       "candidates": {
 *         "<semantic capability id>": {
 *           "invoke": "SEARCH", "readback": "TRACK",
 *           "inputSpec": [{ "name": "query", "type": "string", "required": true }]
 *         }
 *       }
 *     }
 *   ]
 *
 * ─── THREE NAMESPACES, TWO EXPLICIT STATEMENTS ──────────────────────────────
 *
 *   a semantic capability   what JASIM promises            inventory.search
 *   a provider verb         what a connection was granted  SEARCH
 *   a remote tool name      what the system calls it       search_inventory
 *
 * Neither relationship is ever inferred. `tools` states the second→third, and
 * `candidates` states the first→second. Nothing reads a tool name to pick a
 * verb, and nothing reads a verb to pick a capability.
 *
 *   REMOTE_TOOL_NAME_SELECTS_PROVIDER_VERB = 0
 *   PROVIDER_VERB_SELECTS_SEMANTIC_CAPABILITY = 0
 *   DESCRIPTION_SELECTS_SEMANTIC_CAPABILITY = 0
 *
 * `supports` is derived from `tools`' keys, so a definition cannot claim a verb
 * it has no way to perform; and a candidate's `implementationId` is DERIVED from
 * `tools[invoke]`, so the tool the DAG names and the tool the adapter calls for
 * one operation are the same string by construction.
 *
 *   DAG_TOOL_DIFFERS_FROM_ADAPTER_TOOL_FOR_SAME_OPERATION = 0
 */

import type { CapabilityProviderRegistry } from "../capability-provider";
import type { TypedFieldSpec } from "../capability-registry";
import {
  PROVIDER_AUTH_METHODS,
  PROVIDER_CAPABILITIES,
  ProviderBindingError,
  type EndpointPolicy,
  type ProviderAuthMethod,
  type ProviderCapability,
  type ProviderDefinitionRegistry,
} from "../provider-binding";
import { mcpProviderDefinition, type McpToolBinding } from "./mcp-provider";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(entry: Record<string, unknown>, key: string, index: number): string {
  const value = entry[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ProviderBindingError(
      `Configured remote provider #${index} is missing «${key}».`,
      "INVALID",
    );
  }
  return value.trim();
}

function signingMode(
  entry: Record<string, unknown>,
  key: string,
  index: number,
): "NONE" | "SIGNED_HMAC" | undefined {
  const value = entry[key];
  if (value === undefined) return undefined;
  if (value !== "NONE" && value !== "SIGNED_HMAC") {
    throw new ProviderBindingError(
      `Configured remote provider #${index} has an unknown «${key}».`,
      "INVALID",
    );
  }
  return value;
}

/**
 * WHICH REMOTE TOOL performs each verb, as the deployment stated it.
 *
 * Read once and shared, because the definition's manifest and a candidate's
 * `implementationId` are both derived from it — two readings could drift and one
 * cannot.
 */
function toolMapOf(entry: Record<string, unknown>, index: number): Record<string, string> {
  const raw = entry.tools;
  if (!isRecord(raw) || Object.keys(raw).length === 0) {
    throw new ProviderBindingError(
      `Configured remote provider #${index} declares no operations.`,
      "INVALID",
    );
  }
  const tools: Record<string, string> = {};
  for (const [capability, tool] of Object.entries(raw)) {
    if (!(PROVIDER_CAPABILITIES as readonly string[]).includes(capability)) {
      throw new ProviderBindingError(
        `Configured remote provider #${index} names «${capability}», which is not a capability.`,
        "INVALID",
      );
    }
    if (typeof tool !== "string" || tool.trim().length === 0) {
      throw new ProviderBindingError(
        `Configured remote provider #${index} has no remote name for ${capability}.`,
        "INVALID",
      );
    }
    tools[capability] = tool.trim();
  }
  return tools;
}

/**
 * Parse the deployment's own statement about the remote systems it runs.
 *
 * Strict on purpose. Every refusal here is a boot failure, which is the cheapest
 * place for a mistake about an address or a verb to be found.
 */
export function parseConfiguredMcpProviders(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ProviderBindingError("JASIM_REMOTE_PROVIDERS is not JSON.", "INVALID");
  }
  if (!Array.isArray(parsed)) {
    throw new ProviderBindingError("JASIM_REMOTE_PROVIDERS must be a list.", "INVALID");
  }
  return parsed.map((raw, index) => {
    if (!isRecord(raw)) {
      throw new ProviderBindingError(`Configured remote provider #${index} is not an object.`, "INVALID");
    }
    const authMethod = text(raw, "authMethod", index) as ProviderAuthMethod;
    if (!(PROVIDER_AUTH_METHODS as readonly string[]).includes(authMethod)) {
      throw new ProviderBindingError(
        `Configured remote provider #${index} has an unknown authMethod.`,
        "INVALID",
      );
    }
    // FIXED means the address is this configuration's; DECLARED_AT_SETUP means
    // each connection's own trusted setup collects it beside its credential.
    const declared = text(raw, "endpoint", index);
    const endpoint: EndpointPolicy =
      declared === "DECLARED_AT_SETUP"
        ? { mode: "DECLARED_AT_SETUP" }
        : { mode: "FIXED", baseUrl: declared };

    const tools = toolMapOf(raw, index);

    return mcpProviderDefinition({
      id: text(raw, "id", index),
      displayName: text(raw, "displayName", index),
      authMethod,
      endpoint,
      tools: tools as McpToolBinding,
      ...(Array.isArray(raw.observes)
        ? { observes: raw.observes.filter((one): one is string => typeof one === "string") }
        : {}),
      ...(raw.paymentMethod === "NONE" || raw.paymentMethod === "REQUIRED"
        ? { paymentMethod: raw.paymentMethod }
        : {}),
      ...(signingMode(raw, "webhook", index) ? { webhook: signingMode(raw, "webhook", index)! } : {}),
      ...(signingMode(raw, "receipt", index) ? { receipt: signingMode(raw, "receipt", index)! } : {}),
      ...(typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)
        ? { timeoutMs: raw.timeoutMs }
        : {}),
    });
  });
}

/**
 * Register what the deployment configured, and nothing otherwise.
 *
 * Returns how many were registered, so boot can say so out loud — an empty
 * registry is a fact worth logging rather than a silence.
 */
export function registerConfiguredMcpProviders(
  registry: ProviderDefinitionRegistry,
  raw: string | undefined,
): readonly string[] {
  if (!raw || raw.trim().length === 0) return [];
  const definitions = parseConfiguredMcpProviders(raw);
  for (const definition of definitions) {
    // The registry does the rest of the checking it always did: the address is
    // public HTTPS and not local, every verb is in the vocabulary, and a
    // test-only entry cannot enter a registry that was not built to hold one.
    registry.register(definition);
  }
  return definitions.map((definition) => definition.id);
}

/** What a configured definition supports, for a boot log. Never a credential. */
export function configuredProviderSummary(
  raw: string | undefined,
): readonly { id: string; supports: readonly ProviderCapability[] }[] {
  if (!raw || raw.trim().length === 0) return [];
  return parseConfiguredMcpProviders(raw).map((definition) => ({
    id: definition.id,
    supports: definition.supports,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// THE CANDIDATE BRIDGE — what makes a configured definition SELECTABLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * WHY A DEFINITION IS NOT YET A PROVIDER.
 *
 *   PROVIDER_DEFINITION != CAPABILITY_PROVIDER
 *   CONFIGURED_CANDIDATE != GRANTED_CONNECTION
 *   SELECTED_PROVIDER != AUTHORIZED_CONNECTION · FOUND != MAY_EXECUTE
 *
 * A definition says a kind of system exists and how a connection to it is made.
 * The runtime's DAG asks a different question — «which implementation of this
 * SEMANTIC capability should this node use?» — and answers it from the
 * `CapabilityProviderRegistry`, which knew nothing about configured definitions.
 *
 * This is the bridge, and it is only a bridge. A candidate registered here is
 * SELECTABLE and nothing more: it connects no account, grants no verb, carries
 * no address and holds no credential. Execution still needs the acting scope's
 * own VERIFIED binding with the exact verb granted, and still gets its endpoint
 * and credential from that binding.
 *
 *   CONFIGURED_CANDIDATE_AUTO_CREATES_BINDING = 0
 *   CONFIGURED_CANDIDATE_AUTO_GRANTS_CAPABILITY = 0
 *   CONFIGURED_CANDIDATE_ENDPOINT_BYPASSES_BINDING = 0
 *
 * ─── AND WHY IT IS NOT SELECTABLE THE MOMENT IT IS REGISTERED ───────────────
 *
 * `resolveProvider` requires a non-native provider to be observed AVAILABLE and
 * to hold an unexpired freshness lease. A configuration file is not evidence
 * that a system answers, so a candidate is registered UNKNOWN with no lease —
 * unselectable — and becomes selectable only when a real handshake reaches the
 * real endpoint with the real credential. Nothing here writes AVAILABLE.
 *
 *   CONFIG_FILE_EQUALS_LIVE_AVAILABILITY = NO
 *   FAKE_AVAILABLE_TO_PASS_RESOLUTION = 0 · MISSING_FRESHNESS_LEASE_EXECUTES = 0
 */
export type ConfiguredCandidate = {
  readonly id: string;
  readonly definitionId: string;
  /** The SEMANTIC capability this implements. Stated, never inferred. */
  readonly capabilityId: string;
  /** Derived from the definition's tool map. Never a second free tool name. */
  readonly implementationId: string;
  readonly operations: { readonly invoke: string; readonly readback?: string; readonly cancel?: string };
  readonly freshnessSeconds: number;
  /**
   * The I/O contract this route offers, when the deployment declares one.
   *
   * TRUSTED because it belongs to the same configuration authority that named
   * the definition and the tool — NOT because a remote account described itself.
   * Absent means THERE IS NO VERIFIED CONTRACT, and a requirement that actually
   * asks for fields then fails closed.
   *
   *   MODEL_DECLARED_SCHEMA_AUTHORITY = 0
   *   REMOTE_TOOL_DESCRIPTION_IS_AUTHORITY = 0
   *   REQUIREMENT_SPEC_COPIED_INTO_OFFERED_SPEC = 0
   *
   * Input and output are independent: a deployment that knows what a tool
   * accepts and not what it returns declares the first and leaves the second
   * absent, and an output requirement then stays INCOMPATIBLE.
   *
   *   OUTPUT_SCHEMA_INVENTED_WHEN_REMOTE_DOES_NOT_PROVIDE_ONE = 0
   */
  readonly inputSpec?: readonly TypedFieldSpec[];
  readonly outputSpec?: readonly TypedFieldSpec[];
};

/**
 * WHAT A DECLARED CONTRACT MAY SAY, AND WHAT IT MAY NOT PRETEND TO.
 *
 * `TypedFieldSpec` is a flat list of named scalars. It has no element type for an
 * array, no interior for an object, no enum and no union — so a configuration
 * that tried to express `filters.category: string` would be flattening a nested
 * requirement into a claim it cannot check. Anything shaped like nesting is
 * refused at boot rather than accepted and quietly lost.
 *
 *   UNSUPPORTED_JSON_SCHEMA_FAILS_OPEN = 0
 */
const SPEC_TYPES: readonly TypedFieldSpec["type"][] = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
];

function specOf(
  entry: Record<string, unknown>,
  key: "inputSpec" | "outputSpec",
  label: string,
): readonly TypedFieldSpec[] | undefined {
  const raw = entry[key];
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ProviderBindingError(`«${label}» declares an empty ${key}.`, "INVALID");
  }
  const names = new Set<string>();
  return raw.map((field) => {
    if (!isRecord(field)) {
      throw new ProviderBindingError(`«${label}» has a malformed ${key} field.`, "INVALID");
    }
    const name = typeof field.name === "string" ? field.name.trim() : "";
    if (!name) {
      throw new ProviderBindingError(`«${label}» has a ${key} field with no name.`, "INVALID");
    }
    if (names.has(name)) {
      throw new ProviderBindingError(`«${label}» declares ${key} field «${name}» twice.`, "INVALID");
    }
    names.add(name);
    const type = field.type;
    if (typeof type !== "string" || !(SPEC_TYPES as readonly string[]).includes(type)) {
      throw new ProviderBindingError(
        `«${label}» gives ${key} field «${name}» the type «${String(type)}», which cannot be expressed here.`,
        "INVALID",
      );
    }
    // Nesting has no representation, so a configuration may not imply one.
    for (const nested of ["properties", "items", "enum", "oneOf", "anyOf", "allOf", "$ref"]) {
      if (field[nested] !== undefined) {
        throw new ProviderBindingError(
          `«${label}» gives ${key} field «${name}» a «${nested}», which cannot be expressed here.`,
          "INVALID",
        );
      }
    }
    if (field.required !== undefined && typeof field.required !== "boolean") {
      throw new ProviderBindingError(
        `«${label}» gives ${key} field «${name}» a non-boolean «required».`,
        "INVALID",
      );
    }
    return {
      name,
      type: type as TypedFieldSpec["type"],
      ...(field.required === true ? { required: true } : {}),
      ...(typeof field.unit === "string" && field.unit.trim() ? { unit: field.unit.trim() } : {}),
    };
  });
}

/**
 * Parse the candidate bridges a deployment stated, against the definitions it
 * stated and the semantic capabilities this build actually has.
 *
 * Every refusal is a boot failure. A malformed trusted mapping is never skipped:
 * silently dropping one would leave a node with no provider and no explanation.
 */
export function parseConfiguredCandidates(
  raw: string,
  capabilities: {
    getTrustedCapability(name: string): { id: string; testOnly?: boolean } | undefined;
  },
): readonly ConfiguredCandidate[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new ProviderBindingError("JASIM_REMOTE_PROVIDERS must be a list.", "INVALID");
  }
  const definitions = parseConfiguredMcpProviders(raw);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const seen = new Set<string>();
  const bridges: ConfiguredCandidate[] = [];

  parsed.forEach((entry, index) => {
    if (!isRecord(entry) || entry.candidates === undefined) return;
    const definitionId = text(entry, "id", index);
    const definition = byId.get(definitionId);
    if (!definition) {
      throw new ProviderBindingError(
        `Configured remote provider #${index} maps candidates to no definition.`,
        "INVALID",
      );
    }
    if (!isRecord(entry.candidates)) {
      throw new ProviderBindingError(
        `Configured remote provider «${definitionId}» has a malformed candidates map.`,
        "INVALID",
      );
    }
    // A lease length is a deployment's own statement about how long a single
    // reachability observation may stand for. There is no default, because a
    // default would be this file inventing a policy.
    const freshnessSeconds = entry.freshnessSeconds;
    if (typeof freshnessSeconds !== "number" || !Number.isFinite(freshnessSeconds) || freshnessSeconds <= 0) {
      throw new ProviderBindingError(
        `Configured remote provider «${definitionId}» declares candidates without a freshness lease.`,
        "INVALID",
      );
    }
    const tools = toolMapOf(entry, index);

    for (const [capabilityId, operationsRaw] of Object.entries(entry.candidates)) {
      // The semantic capability must be one this build actually promises. A
      // mapping to a name nothing implements is a configuration mistake, and a
      // test-only capability is never something a remote system implements.
      const capability = capabilities.getTrustedCapability(capabilityId);
      if (!capability) {
        throw new ProviderBindingError(
          `«${definitionId}» maps «${capabilityId}», which is not a capability here.`,
          "INVALID",
        );
      }
      if (capability.testOnly) {
        throw new ProviderBindingError(
          `«${definitionId}» maps the test-only capability «${capabilityId}».`,
          "INVALID",
        );
      }
      if (!isRecord(operationsRaw)) {
        throw new ProviderBindingError(
          `«${definitionId}» maps «${capabilityId}» to no operations.`,
          "INVALID",
        );
      }
      const operations: { invoke: string; readback?: string; cancel?: string } = {
        invoke: "",
      };
      for (const slot of ["invoke", "readback", "cancel"] as const) {
        // `inputSpec` / `outputSpec` live beside the verbs and are read below.
        const verb = operationsRaw[slot];
        if (verb === undefined) {
          if (slot === "invoke") {
            throw new ProviderBindingError(
              `«${definitionId}» maps «${capabilityId}» without an invoke operation.`,
              "INVALID",
            );
          }
          continue;
        }
        if (typeof verb !== "string" || !(PROVIDER_CAPABILITIES as readonly string[]).includes(verb)) {
          throw new ProviderBindingError(
            `«${definitionId}» maps «${capabilityId}» ${slot} to «${String(verb)}», which is not a capability.`,
            "INVALID",
          );
        }
        // Supported by the definition — which, because `supports` is derived
        // from the tool map, is the same as «there is a tool for it».
        if (!definition.supports.includes(verb as ProviderCapability)) {
          throw new ProviderBindingError(
            `«${definitionId}» does not do ${verb}, so it cannot be ${capabilityId}'s ${slot}.`,
            "INVALID",
          );
        }
        operations[slot] = verb;
      }
      // Deterministic and stable, and not a discovery id: a bridge is named
      // after the two trusted things it joins.
      const id = `cfg:${definitionId}:${capabilityId}`;
      if (seen.has(id)) {
        throw new ProviderBindingError(`Duplicate configured candidate «${id}».`, "INVALID");
      }
      seen.add(id);
      const label = `${definitionId}:${capabilityId}`;
      bridges.push({
        id,
        definitionId,
        capabilityId,
        // DERIVED. The DAG names this tool and the adapter calls the same one.
        implementationId: tools[operations.invoke]!,
        operations,
        freshnessSeconds,
        // Declared by the deployment, per ROUTE. Two configured tools with
        // different contracts cannot share one, because each candidate reads
        // only its own entry.
        ...(specOf(operationsRaw, "inputSpec", label)
          ? { inputSpec: specOf(operationsRaw, "inputSpec", label) }
          : {}),
        ...(specOf(operationsRaw, "outputSpec", label)
          ? { outputSpec: specOf(operationsRaw, "outputSpec", label) }
          : {}),
      });
    }
  });
  return bridges;
}

/**
 * Register the bridges into THE registry the DAG resolves against.
 *
 * No second registry, and no candidate that could be mistaken for a discovered
 * one: the provenance is MANUAL_CONFIG, the trust class is TRUSTED_CONFIGURED
 * because every field came from deployment-owned configuration, and a candidate
 * normalized from a tool listing or an agent card is still UNTRUSTED_CANDIDATE
 * however closely its strings match.
 *
 *   SECOND_CAPABILITY_PROVIDER_REGISTRY = 0
 *   DISCOVERY_BECOMES_TRUSTED_CONFIGURED_AUTOMATICALLY = 0
 */
export function registerConfiguredCandidates(input: {
  providers: CapabilityProviderRegistry;
  capabilities: { getTrustedCapability(name: string): { id: string; testOnly?: boolean } | undefined };
  raw: string | undefined;
  now?: Date;
}): readonly string[] {
  if (!input.raw || input.raw.trim().length === 0) return [];
  const now = input.now ?? new Date();
  const bridges = parseConfiguredCandidates(input.raw, input.capabilities);
  for (const bridge of bridges) {
    input.providers.register({
      id: bridge.id,
      kind: "MCP",
      capabilityId: bridge.capabilityId,
      implementationId: bridge.implementationId,
      // No protocol is CLAIMED. `resolveProvider` filters on a declared
      // protocol version and a candidate that declares none is not filtered on
      // one — and the only honest source of a version is the remote system's own
      // `initialize`, which has not been read at registration time. Nothing is
      // invented to pass a filter.
      // The offered contract, when the deployment declared one. Absent means no
      // verified contract, and `specCompatible` then refuses any requirement
      // that actually asks for a field.
      //
      //   FAIL_CLOSED > FALSE_COMPATIBILITY
      ...(bridge.inputSpec ? { inputSpec: [...bridge.inputSpec] } : {}),
      ...(bridge.outputSpec ? { outputSpec: [...bridge.outputSpec] } : {}),
      trustClass: "TRUSTED_CONFIGURED",
      // UNKNOWN, on purpose. A configuration file is not a reachability
      // observation, and this is the state `resolveProvider` refuses.
      availability: { state: "UNKNOWN", observedAt: now },
      costClass: "UNKNOWN",
      latencyClass: "UNKNOWN",
      // No freshness lease. Registered means known about, not usable.
      freshness: { discoveredAt: now },
      // No endpoint. The address is the binding's, and putting one here is how
      // execution authority would leak back into a candidate.
      definitionId: bridge.definitionId,
      operations: bridge.operations,
      provenance: { source: "MANUAL_CONFIG" },
    });
  }
  return bridges.map((bridge) => bridge.id);
}

/**
 * WHAT A HANDSHAKE MAY SAY ABOUT A SHARED CANDIDATE.
 *
 * ─── THE SUBJECT PROBLEM ────────────────────────────────────────────────────
 *
 * A bridged candidate is shared: `resolveProvider` has no acting scope, so the
 * one availability field it reads is read on behalf of everybody. A handshake,
 * meanwhile, happens at ONE binding with ONE credential and — when the address
 * is declared per connection — at ONE address.
 *
 *   PROVIDER_DEFINITION != PROVIDER_ACCOUNT
 *   ACCOUNT_A_REACHABLE != ACCOUNT_B_REACHABLE
 *   OBSERVATION_AUTHORITY_MUST_MATCH_OBSERVATION_SUBJECT
 *
 * So this promotes an observation to the shared candidate in exactly one case,
 * and refuses in every other:
 *
 *   FIXED address + something ANSWERED  → the SERVICE is up. Every binding under
 *                                         this definition dials that same place,
 *                                         so it is a fact about all of them.
 *   FIXED address + SILENCE             → that same place did not answer.
 *   anything else                       → NOTHING is written.
 *
 * ─── AND WHAT IS NEVER PROMOTED ─────────────────────────────────────────────
 *
 * Whether a credential was accepted. One account's key being refused says
 * nothing about another account, and letting it mark a shared candidate
 * UNAVAILABLE would let any tenant take the provider away from every other one.
 *
 *   BAD_CREDENTIAL != PROVIDER_GLOBALLY_DOWN
 *   ONE_BINDING_FAILURE != ALL_BINDINGS_UNAVAILABLE
 *
 * Nor anything from discovery: which capabilities an account has is the most
 * account-specific fact in the lifecycle. The provider runtime no longer reports
 * from there at all.
 *
 * ─── AND WHAT IT CANNOT DO EITHER WAY ───────────────────────────────────────
 *
 * Selection is not authority. Availability decides whether a node may CONSIDER
 * this candidate; execution still needs the acting scope's own VERIFIED binding
 * with the exact verb granted.
 *
 *   CANDIDATE_AVAILABILITY_BYPASSES_BINDING_GATE = 0
 *   FAKE_GLOBAL_HEALTH_CHECK_ADDED = 0
 */
export function configuredCandidateHandshakeObserver(input: {
  providers: CapabilityProviderRegistry;
  capabilities: { getTrustedCapability(name: string): { id: string; testOnly?: boolean } | undefined };
  raw: string | undefined;
}): (observation: {
  definitionId: string;
  bindingId: string;
  endpointMode: "FIXED" | "DECLARED_AT_SETUP";
  service: "ANSWERED" | "SILENT" | "UNKNOWN";
  account: "ACCEPTED" | "REFUSED";
  at: Date;
}) => void {
  const bridges = input.raw ? parseConfiguredCandidates(input.raw, input.capabilities) : [];
  return (observation) => {
    // Each connection dials its own address, so this handshake was about that
    // one connection. There is nothing here that is true of the others.
    if (observation.endpointMode !== "FIXED") return;
    // The adapter could not tell a refusal from silence, so neither can this.
    if (observation.service === "UNKNOWN") return;
    for (const bridge of bridges) {
      if (bridge.definitionId !== observation.definitionId) continue;
      input.providers.observe(bridge.id, {
        state: observation.service === "ANSWERED" ? "AVAILABLE" : "UNAVAILABLE",
        at: observation.at,
        ...(observation.service === "ANSWERED"
          ? { freshUntil: new Date(observation.at.getTime() + bridge.freshnessSeconds * 1000) }
          : {}),
      });
    }
  };
}
