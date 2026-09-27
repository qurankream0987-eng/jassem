/**
 * JASIM — A REMOTE SYSTEM THAT CAN ACTUALLY BE CALLED.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   TRANSPORT != AUTHORITY · PROTOCOL != DOMAIN
 *   REMOTE DESCRIPTION != TRUSTED CONFIGURATION
 *   DISCOVERED_TOOL != AUTHORIZED_TOOL
 *   REMOTE_TOOL_NAME != PROVIDER_CAPABILITY
 *   PROVIDER_UNAVAILABLE != BUSINESS_FACT
 *
 * ─── WHAT WAS MISSING, AND WHAT THIS IS ─────────────────────────────────────
 *
 * Every authority gate a remote call passes through was already built: the
 * trusted definition, the candidate bridge, the exact granted verb, the VERIFIED
 * lifecycle, the bound endpoint, the sealed credential, the pinned follow-up
 * operations, the receipt verifier. Nothing could traverse them, because no
 * `ProviderDefinition` existed in production and no `ProviderAdapter` spoke a
 * real protocol.
 *
 * This is that adapter, and nothing else. It decides nothing about whether a
 * call may happen — by the time `invoke` runs, `authorizedConnection` has
 * already proved the scope, the definition, the lifecycle and the exact verb,
 * and has opened the credential for this one call. An adapter receives an
 * already-authorized context.
 *
 *   NEW_AUTHORITY_RUNTIME_ADDED = NO
 *
 * ─── WHERE THE TOOL NAME COMES FROM ─────────────────────────────────────────
 *
 * The one thing a protocol needs that the capability vocabulary does not carry
 * is WHICH REMOTE TOOL implements a verb. That is trusted configuration, stated
 * once when the definition is registered in server code, and it is a MAP FROM
 * CAPABILITY TO TOOL — never the reverse. A tool called `transfer_funds` cannot
 * become PAY by being named that; PAY becomes `transfer_funds` because a
 * deployment said so.
 *
 *   TOOL_NAME_SELECTS_PROVIDER_CAPABILITY = 0
 *   DESCRIPTION_SELECTS_PROVIDER_CAPABILITY = 0
 *   EFFECT_KIND_SELECTS_PROVIDER_CAPABILITY = 0
 *   MODEL_ARBITRARY_TOOL_SELECTION = 0 · MODEL_ARBITRARY_REMOTE_HTTP = 0
 *
 * A capability with no configured tool is REFUSED rather than guessed at, so a
 * definition cannot support a verb it has no way to perform.
 */

import {
  httpAuthorizationFor,
  PROVIDER_CAPABILITIES,
  type EndpointPolicy,
  type ProviderAdapter,
  type ProviderAuthMethod,
  type ProviderCallContext,
  type ProviderCapability,
  type ProviderDefinition,
  type ProviderResult,
} from "../provider-binding";
import { createMcpClient, McpClientError } from "../block2/mcp-client";

/**
 * WHICH REMOTE TOOL performs each verb. Trusted configuration, one direction.
 *
 * The keys are JASIM's vocabulary and the values are the remote system's own
 * names. Nothing reads a value to decide a key.
 */
export type McpToolBinding = Readonly<Partial<Record<ProviderCapability, string>>>;

export type McpProviderConfig = {
  /** Which material this connection presents. The definition's own method. */
  readonly authMethod: ProviderAuthMethod;
  readonly tools: McpToolBinding;
  readonly timeoutMs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The client for ONE authorized call.
 *
 * Built from the context the gate produced: its endpoint, and its credential
 * shaped into exactly one header. Never from a discovered address, a model, a
 * request, or anything the provider said in a previous answer.
 *
 *   DISCOVERY_ENDPOINT_RECEIVES_BOUND_CREDENTIAL = 0
 *   MODEL_ENDPOINT_RECEIVES_BOUND_CREDENTIAL = 0
 *
 * The transport itself refuses to follow a redirect across origins while
 * carrying that header, so a bound destination cannot hand the credential on.
 *
 *   CREDENTIAL_CROSS_ORIGIN_REDIRECT = 0
 */
function clientFor(context: ProviderCallContext, config: McpProviderConfig) {
  return createMcpClient({
    baseUrl: context.endpoint,
    headers: { ...httpAuthorizationFor({ authMethod: config.authMethod, credential: context.credential }) },
    ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}),
  });
}

/**
 * A transport failure is not a fact about the world.
 *
 * Unreachable, timed out, reset, or answered with an HTTP the protocol does not
 * define → UNAVAILABLE: JASIM does not know what happened. Answered, and the
 * answer was an error or was not the protocol → ERROR: the provider spoke and
 * declined. Neither is ever a success, and neither becomes an observation.
 *
 *   PROVIDER_UNAVAILABLE != BUSINESS_FACT · NO_FAKE_SUCCESSFUL_OUTPUT
 */
function failureOf(error: unknown): ProviderResult {
  if (error instanceof McpClientError) {
    // Unchanged by the reachability split: an HTTP status the protocol does not
    // define still leaves JASIM not knowing what happened to the request, which
    // is UNAVAILABLE. The new code exists to judge whether a SERVICE answered,
    // not to re-decide what a failed call means.
    return error.code === "PROTOCOL"
      ? { status: "ERROR", detail: error.message }
      : { status: "UNAVAILABLE", detail: error.message };
  }
  return {
    status: "UNAVAILABLE",
    detail: error instanceof Error ? error.message : "The provider could not be reached.",
  };
}

/**
 * The adapter.
 *
 * Three functions, each doing exactly what the contract says and nothing that
 * decides authority.
 */
export function createMcpProviderAdapter(config: McpProviderConfig): ProviderAdapter {
  return {
    /**
     * A HANDSHAKE, and nothing that writes.
     *
     * `initialize` is the protocol's own hello: it names the server and the
     * version it speaks. No tool is called, so nothing on the other side moves.
     *
     *   AUTHENTICATE_CAUSES_BUSINESS_MUTATION = 0
     *   AUTHENTICATED != VERIFIED
     */
    async authenticate(context) {
      try {
        const hello = await clientFor(context, config).initialize();
        const info = isRecord(hello) && isRecord(hello.serverInfo) ? hello.serverInfo : {};
        const name = typeof info.name === "string" ? info.name : "";
        const version = typeof info.version === "string" ? info.version : "";
        if (!name) {
          // It answered; it just did not say who it was. The service is up and
          // this handshake proved nothing about the account.
          return { ok: false, detail: "The provider did not identify itself.", reached: true };
        }
        return {
          ok: true,
          // The far side's own id for this account. Non-sensitive, and reported
          // rather than chosen.
          accountRef: name,
          ...(version ? { accountLabel: `${name} ${version}` } : {}),
        };
      } catch (error) {
        // WHICH of the two failed. A status or a malformed body means something
        // answered — a refused credential arrives that way — and only silence
        // means the address did not.
        //
        //   SERVICE_ANSWERED != CREDENTIAL_ACCEPTED
        const reached =
          error instanceof McpClientError
            ? error.code === "HTTP_STATUS" || error.code === "PROTOCOL"
            : undefined;
        return {
          ok: false,
          detail: error instanceof Error ? error.message : "The provider could not be reached.",
          ...(reached === undefined ? {} : { reached }),
        };
      }
    },

    /**
     * WHAT THIS ACCOUNT CAN ACTUALLY DO, and only ever less.
     *
     * The configured verbs whose tool the server actually exposes. A tool the
     * configuration never named contributes nothing, and a verb the
     * configuration named contributes nothing unless the tool is really there.
     * So the result is always a subset of what was configured, which is itself
     * the definition's manifest — discovery narrows and cannot widen.
     *
     *   REMOTE_DISCOVERY_WIDENS_DEFINITION_SUPPORT = 0
     *   REMOTE_TOOL_NAME != PROVIDER_CAPABILITY
     */
    async discover(context) {
      let listed: unknown;
      try {
        listed = await clientFor(context, config).listTools();
      } catch {
        // Unknown is not everything. A provider that would not say reports none.
        return [];
      }
      const names = new Set<string>();
      if (isRecord(listed) && Array.isArray(listed.tools)) {
        for (const tool of listed.tools) {
          if (isRecord(tool) && typeof tool.name === "string") names.add(tool.name);
        }
      }
      return PROVIDER_CAPABILITIES.filter((capability) => {
        const tool = config.tools[capability];
        return tool !== undefined && names.has(tool);
      });
    },

    /**
     * ONE VERB, ONE TOOL.
     *
     * The capability arrives already granted; this only translates it into the
     * remote name a deployment bound it to. A verb with no configured tool is
     * refused — there is no fallback tool, no first tool, and no name derived
     * from anything.
     */
    async invoke(context, request) {
      const tool = config.tools[request.capability];
      if (!tool) {
        return {
          status: "ERROR",
          detail: `This connection has no operation for ${request.capability}.`,
        };
      }
      try {
        const called = await clientFor(context, config).callTool(tool, { ...request.parameters });
        if (called.isError) {
          // The provider ran it and said no. A refusal, never a result.
          return { status: "ERROR", detail: "The provider rejected the request." };
        }
        return {
          status: "OK",
          value: {
            content: called.content,
            ...(called.receiptSignature ? { receiptSignature: called.receiptSignature } : {}),
            ...(called.taskReference ? { task: called.taskReference } : {}),
          },
          observedAt: new Date(),
        };
      } catch (error) {
        return failureOf(error);
      }
    },
  };
}

/**
 * A remote provider definition, built so its manifest cannot disagree with its
 * transport.
 *
 * `supports` is DERIVED from the tool map rather than given beside it: a verb
 * the definition claims to support but has no tool for would be a promise the
 * adapter must refuse at call time, and a tool bound to a verb the definition
 * does not support would be dead configuration. One source, no drift.
 */
export function mcpProviderDefinition(input: {
  id: string;
  displayName: string;
  authMethod: ProviderAuthMethod;
  endpoint: EndpointPolicy;
  tools: McpToolBinding;
  observes?: readonly string[];
  paymentMethod?: "NONE" | "REQUIRED";
  webhook?: "NONE" | "SIGNED_HMAC";
  receipt?: "NONE" | "SIGNED_HMAC";
  timeoutMs?: number;
}): ProviderDefinition {
  const supports = PROVIDER_CAPABILITIES.filter(
    (capability) => input.tools[capability] !== undefined,
  );
  return {
    id: input.id,
    displayName: input.displayName,
    authMethod: input.authMethod,
    supports,
    endpoint: input.endpoint,
    adapter: createMcpProviderAdapter({
      authMethod: input.authMethod,
      tools: input.tools,
      ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
    }),
    ...(input.observes ? { observes: input.observes } : {}),
    ...(input.paymentMethod ? { paymentMethod: input.paymentMethod } : {}),
    ...(input.webhook ? { webhook: input.webhook } : {}),
    ...(input.receipt ? { receipt: input.receipt } : {}),
  };
}
