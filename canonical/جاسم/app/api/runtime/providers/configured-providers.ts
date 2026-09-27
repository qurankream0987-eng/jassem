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
 *       "webhook": "SIGNED_HMAC", "receipt": "SIGNED_HMAC"
 *     }
 *   ]
 *
 * The `tools` map is the only place a remote name appears, and it maps JASIM's
 * verb TO that name. `supports` is derived from its keys, so a definition cannot
 * claim a verb it has no way to perform.
 */

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

    const toolsRaw = raw.tools;
    if (!isRecord(toolsRaw) || Object.keys(toolsRaw).length === 0) {
      throw new ProviderBindingError(
        `Configured remote provider #${index} declares no operations.`,
        "INVALID",
      );
    }
    const tools: Record<string, string> = {};
    for (const [capability, tool] of Object.entries(toolsRaw)) {
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
