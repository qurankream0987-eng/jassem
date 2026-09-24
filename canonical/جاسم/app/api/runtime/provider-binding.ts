/**
 * JASIM — THE GENERAL PROVIDER / CONNECTOR BINDING RUNTIME.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   MODEL != SECRET STORE · MODEL != PROVIDER AUTHORITY
 *   CONNECTED    != VERIFIED
 *   AUTHORIZED   != AUTHENTICATED != VERIFIED
 *   VERIFIED     != FULL ACCESS
 *   READ         != WRITE
 *   PROVIDER_CAPABILITY      != EXECUTION AUTHORITY
 *   PROVIDER_WRITE_PERMISSION != JASIM_ACTION_AUTHORITY
 *   PROVIDER_RESPONSE        != CANONICAL TRUTH
 *   PROVIDER_UNAVAILABLE     != BUSINESS FACT
 *
 *   SETUP_LINK_CREATED != CREDENTIAL_STORED != AUTHENTICATED
 *                      != VERIFIED != CAPABILITY_AVAILABLE
 *
 * ─── WHAT WAS ALREADY HERE ──────────────────────────────────────────────────
 *
 * `scope_provider_bindings` already got the hardest part right: a binding
 * belongs to a SCOPE, it is created through an authority act that needs
 * `manage_providers`, and its credential column holds a NAME whose value lives
 * in the environment. None of that is replaced.
 *
 * Three things it could not say, and this module adds:
 *
 *   WHAT kind of system is on the other end   → a PROVIDER DEFINITION
 *   WHAT this connection may do               → GRANTED CAPABILITIES
 *   WHETHER anybody ever checked it works     → a LIFECYCLE
 *
 * Because it could not say the third, creating the row WAS being connected.
 *
 *   FALSE_CONNECTED_STATE = 0
 *
 * ─── THREE DIFFERENT THINGS, KEPT APART ─────────────────────────────────────
 *
 *   DEFINITION  what kind of external integration this is   (trusted code)
 *   BINDING     this scope authorized this account of it    (a canonical row)
 *   CAPABILITY  what that binding may actually do           (granted, not supported)
 *
 * A definition may support eight capabilities and a binding may be granted one.
 *
 *   PROVIDER_SUPPORTS_CAPABILITY != BINDING_GRANTED_CAPABILITY
 *
 * ─── NO PROVIDER IS A BRANCH ────────────────────────────────────────────────
 *
 * There is no `ShopifyBindingRuntime`, no `PaymentSecretRuntime`, no
 * `HotelConnector`, and there is no `kind` column enumerating inventory,
 * calendar or ERP. A named external system is a DEFINITION plus an ADAPTER plus
 * a CAPABILITY MANIFEST — data registered in trusted code, never a core change.
 *
 *   NEW_PROVIDER != NEW_CORE
 *   DOMAIN_PROVIDER_BINDING_TYPES = 0
 *   PAYMENT_PROVIDER_SPECIAL_BINDING_RUNTIME = 0
 *
 * A payment gateway is a provider whose manifest contains PAY and REFUND. It
 * binds through this module and nothing else.
 *
 * ─── AND WHAT THIS IS NOT ───────────────────────────────────────────────────
 *
 * Not a second executor. This module never plans, never decides that an act
 * should happen, and never declares a business fact. It exposes capabilities to
 * the runtimes that already own those decisions, and a provider's answer enters
 * evidence as an observation for the freshness runtime to judge.
 *
 *   PROVIDER_BINDING_DECLARES_BUSINESS_TRUTH = 0
 *   PROVIDER_RESPONSE_BYPASSES_FRESHNESS = 0
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../queries/connection";
import { events } from "@db/schema";
import { providerCredentials, scopeProviderBindings } from "@db/schema-block2";
import { authorizeScopeAction } from "./actor-scope";
import { assertResolvedPublicEndpoint } from "./block2/mcp-client";
import {
  providerCredentialVault,
  type CredentialContext,
} from "./provider-credential-vault";
import { recordObservation } from "./block2/observations";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — general, closed, and naming no industry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What an external system can be asked to do.
 *
 * Verbs, and only verbs. There is no `READ_SHIRTS`, no `BOOK_HOTEL` and no
 * `UPDATE_CAR`, and adding one would end the generality this list exists to
 * carry. A definition may narrow a verb to a resource class of its own; the
 * vocabulary itself stays this.
 */
export const PROVIDER_CAPABILITIES = [
  "READ",
  "SEARCH",
  "DISCOVER",
  "OBSERVE",
  "TRACK",
  "CREATE",
  "UPDATE",
  "DELETE",
  "BOOK",
  "SCHEDULE",
  "MESSAGE",
  "PAY",
  "REFUND",
] as const;
export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

/**
 * Which verbs change something on the other side.
 *
 * This is the structural fact behind `READ_GRANT_IMPLIES_WRITE = 0`. Read and
 * write are not two levels of one permission; they are different sets, and a
 * grant of one contains nothing of the other.
 */
const MUTATING: ReadonlySet<string> = new Set([
  "CREATE",
  "UPDATE",
  "DELETE",
  "BOOK",
  "SCHEDULE",
  "MESSAGE",
  "PAY",
  "REFUND",
]);

export function capabilityMutates(capability: string): boolean {
  return MUTATING.has(capability);
}

function isCapability(value: string): value is ProviderCapability {
  return (PROVIDER_CAPABILITIES as readonly string[]).includes(value);
}

/**
 * How a provider proves who is calling.
 *
 * Configuration of a definition, never a runtime of its own. There is no
 * OAuthBindingRuntime beside an ApiKeyBindingRuntime: the lifecycle below is
 * identical for every method, and only the SHAPE of the material differs.
 */
export const PROVIDER_AUTH_METHODS = [
  "API_KEY",
  "BASIC_CREDENTIAL",
  "SIGNED_TOKEN",
  "OAUTH_AUTHORIZATION_CODE",
  "CERTIFICATE",
  "TRUSTED_INTERNAL",
] as const;
export type ProviderAuthMethod = (typeof PROVIDER_AUTH_METHODS)[number];

/** Which credential fields each method needs. Fixed here, never by a caller. */
const AUTH_MATERIAL: Readonly<Record<ProviderAuthMethod, readonly string[]>> = Object.freeze({
  API_KEY: ["apiKey"],
  BASIC_CREDENTIAL: ["username", "password"],
  SIGNED_TOKEN: ["token"],
  OAUTH_AUTHORIZATION_CODE: ["accessToken"],
  CERTIFICATE: ["certificate"],
  TRUSTED_INTERNAL: [],
});

/**
 * The lifecycle, and the whole reason this module exists.
 *
 * Each arrow is a separate fact somebody had to establish. A row exists at
 * SETUP_PENDING; a credential was sealed at AUTHORIZED; the provider answered
 * at AUTHENTICATED; the account and its capabilities were checked at VERIFIED.
 * Only VERIFIED may be used.
 */
export const BINDING_LIFECYCLE = [
  "SETUP_PENDING",
  "AUTHORIZED",
  "AUTHENTICATED",
  "VERIFIED",
  "SUSPENDED",
  "REVOKED",
] as const;
export type BindingLifecycle = (typeof BINDING_LIFECYCLE)[number];

export class ProviderBindingError extends Error {
  readonly code: "INVALID" | "FORBIDDEN" | "NOT_FOUND" | "STATE";
  constructor(message: string, code: ProviderBindingError["code"]) {
    super(message);
    this.code = code;
    this.name = "ProviderBindingError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The provider definition
// ─────────────────────────────────────────────────────────────────────────────

/** What the runtime hands an adapter. It is given the credential and nothing else. */
export type ProviderCallContext = {
  readonly scopeId: string;
  readonly bindingId: string;
  readonly endpoint: string;
  readonly capability: ProviderCapability;
  /** Opened from the vault for this one call. Never persisted by an adapter. */
  readonly credential: Readonly<Record<string, string>>;
};

export type AuthenticationOutcome =
  | {
      readonly ok: true;
      /** The far side's own id for this account. Non-sensitive. */
      readonly accountRef: string;
      readonly accountLabel?: string;
    }
  | { readonly ok: false; readonly detail: string };

export type ProviderResult =
  | { readonly status: "OK"; readonly value: unknown; readonly observedAt?: Date }
  /** The provider could not be reached. This is not a fact about the world. */
  | { readonly status: "UNAVAILABLE"; readonly detail: string }
  /** The provider answered with an error. Also not a fact about the world. */
  | { readonly status: "ERROR"; readonly detail: string };

/**
 * The adapter contract.
 *
 * `authenticate` must be SAFE: a handshake, a whoami, an account read. Nothing
 * here may write to prove that writing works.
 *
 *   CONNECTION_TEST_CAUSES_BUSINESS_MUTATION = 0
 *
 * `discover` reports what this particular account can do, which is how
 * `VERIFIED != FULL ACCESS` becomes a number rather than a sentiment.
 *
 * ─── AND WHAT AN ADAPTER MAY NOT DO WITH THE ENDPOINT ───────────────────────
 *
 * The credential is opened for one call against one address. An adapter must
 * never let it follow a redirect to another origin: a destination the
 * authorized person chose does not authorize every destination that
 * destination can point at.
 *
 *   CREDENTIAL_REDIRECT_TO_UNTRUSTED_ORIGIN = 0
 *
 * No transport is implemented in this phase, so this is a contract rather than
 * a behaviour — but it is a contract with a function behind it:
 * `assertWithinEndpoint` is what an adapter calls before following anything,
 * and it is tested here rather than only described.
 */
export type ProviderAdapter = {
  readonly authenticate: (context: ProviderCallContext) => Promise<AuthenticationOutcome>;
  readonly discover: (context: ProviderCallContext) => Promise<readonly ProviderCapability[]>;
  readonly invoke: (
    context: ProviderCallContext,
    request: { readonly capability: ProviderCapability; readonly parameters: Readonly<Record<string, unknown>> },
  ) => Promise<ProviderResult>;
};

/**
 * Where an adapter is allowed to talk.
 *
 * FIXED belongs to a provider whose address is known in trusted code. DECLARED
 * is the custom-API case: a business names its own endpoint, and it is checked
 * against the network boundary before it is ever stored.
 *
 * Either way the address comes from registration or from a person at a trusted
 * surface. A model never supplies a URL, a method, a header or a body.
 *
 *   MODEL_ARBITRARY_HTTP_EXECUTION = 0
 */
export type EndpointPolicy =
  | { readonly mode: "FIXED"; readonly baseUrl: string }
  | { readonly mode: "DECLARED_AT_SETUP" };

export type ProviderDefinition = {
  readonly id: string;
  /** What a person reads. Data, never a branch. */
  readonly displayName: string;
  readonly authMethod: ProviderAuthMethod;
  /** Everything this KIND of system can do. Not what any binding may do. */
  readonly supports: readonly ProviderCapability[];
  readonly endpoint: EndpointPolicy;
  readonly adapter: ProviderAdapter;
  /**
   * A fixture. It may exist only in a registry that was explicitly built to
   * hold one, and the production registry never is.
   *
   *   PRODUCTION_FAKE_PROVIDER = 0
   */
  readonly testOnly?: boolean;
};

/**
 * The registry.
 *
 * Mirrors how this repository already keeps trusted capabilities and product
 * actions: registration happens in server code, and a test-only entry cannot
 * enter a registry that was not built to allow one.
 */
export class ProviderDefinitionRegistry {
  private readonly definitions = new Map<string, ProviderDefinition>();
  private readonly allowTestOnly: boolean;

  constructor(options: { allowTestOnly?: boolean } = {}) {
    this.allowTestOnly = options.allowTestOnly === true;
  }

  register(definition: ProviderDefinition): void {
    if (definition.testOnly && !this.allowTestOnly) {
      throw new ProviderBindingError(
        `«${definition.id}» is a test fixture and may not be registered here.`,
        "FORBIDDEN",
      );
    }
    if (this.definitions.has(definition.id)) {
      throw new ProviderBindingError(`«${definition.id}» is already registered.`, "INVALID");
    }
    if (definition.supports.length === 0) {
      throw new ProviderBindingError(
        `«${definition.id}» supports nothing, so nothing could bind to it.`,
        "INVALID",
      );
    }
    for (const capability of definition.supports) {
      if (!isCapability(capability)) {
        throw new ProviderBindingError(`«${capability}» is not a capability.`, "INVALID");
      }
    }
    // A fixed address is checked NOW, in trusted code, so a bad one is a
    // startup failure rather than a request-time surprise.
    if (definition.endpoint.mode === "FIXED") {
      assertPublicHttpsUrl(definition.endpoint.baseUrl);
    }
    this.definitions.set(definition.id, definition);
  }

  get(id: string): ProviderDefinition | undefined {
    return this.definitions.get(id);
  }

  list(): readonly ProviderDefinition[] {
    return [...this.definitions.values()];
  }
}

/**
 * The production registry. It holds no fixture, ever.
 *
 * It is also EMPTY, and that is the honest state of this phase: this is the
 * binding layer, and no real external adapter has been written yet. So
 *
 *   PRODUCTION_FAKE_PROVIDER = 0
 *
 * is arithmetic rather than a claim — there is nothing registered to be fake.
 * A named system arrives later as a definition plus an adapter, registered in
 * trusted server code, changing nothing here.
 */
export const providerDefinitions = new ProviderDefinitionRegistry();

/**
 * The registry in force.
 *
 * Trusted server code may substitute one — a test harness needs fixtures, and
 * a fixture must never reach the production registry. Substitution cannot
 * WIDEN anything: an installed registry is still subject to every gate below,
 * and no request path, model output or payload can reach this function.
 */
let activeDefinitions: ProviderDefinitionRegistry = providerDefinitions;

export function setProviderDefinitionRegistry(next: ProviderDefinitionRegistry | undefined): void {
  activeDefinitions = next ?? providerDefinitions;
}

function definitionOf(id: string | null | undefined): ProviderDefinition | undefined {
  return id ? activeDefinitions.get(id) : undefined;
}

/**
 * The synchronous half of the network boundary.
 *
 * The repository already owns this decision — private ranges, loopback,
 * link-local, carrier-grade NAT, cloud metadata and DNS rebinding are all
 * refused by `assertResolvedPublicEndpoint`, which pins what it resolved. It is
 * reused rather than rewritten.
 *
 *   UNTRUSTED_ENDPOINT_CAN_ACCESS_INTERNAL_NETWORK = 0
 */
function assertPublicHttpsUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ProviderBindingError("That is not an address.", "INVALID");
  }
  if (url.protocol !== "https:") {
    throw new ProviderBindingError("A provider endpoint must be https.", "INVALID");
  }
  // ── WHERE THIS IS STRICTER THAN WHAT IT REUSES ────────────────────────────
  //
  // The shared boundary permits a loopback host by name, and for its own
  // caller that is right: a runtime legitimately talks to an MCP server on the
  // same machine, named `localhost`, chosen in trusted configuration.
  //
  // A provider endpoint is a different trust class. It is typed in by a
  // business at a setup surface, and a name is a name — so the one host the
  // shared guard lets through by name is refused here before it is ever
  // resolved — and so are the loopback literals it lets through the same way.
  // Everything else (the private ranges, link-local, the cloud metadata
  // address, carrier-grade NAT, and any NAME that resolves into one, with the
  // resolution pinned against rebinding) is the shared guard's, verified by
  // test against it rather than reimplemented here.
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const localName = host === "localhost" || host === "localhost." || host.endsWith(".localhost");
  const localLiteral = host === "::1" || host === "0.0.0.0" || /^127\./.test(host);
  if (localName || localLiteral) {
    throw new ProviderBindingError("A provider endpoint must not be local.", "INVALID");
  }
  // A BASE address, and nothing else. A query string or a fragment on a
  // provider endpoint has no legitimate use and is exactly where a credential
  // would sit if one ever reached a URL — so neither is accepted, rather than
  // being accepted and then scrubbed out of the audit afterwards.
  if (url.search || url.hash) {
    throw new ProviderBindingError("A provider endpoint carries no query.", "INVALID");
  }
  // Credentials in the authority are the other place, and also refused.
  if (url.username || url.password) {
    throw new ProviderBindingError("A provider endpoint carries no credential.", "INVALID");
  }
  return url;
}

/**
 * May a credential issued for `endpoint` be sent to `candidate`?
 *
 * Only when it is the same origin. Not a parent domain, not a sibling
 * subdomain, not the same host on another scheme or port — an origin, exactly.
 * An adapter that follows a redirect calls this first; one that cannot answer
 * yes must drop the credential rather than the check.
 *
 *   CREDENTIAL_REDIRECT_TO_UNTRUSTED_ORIGIN = 0
 */
export function assertWithinEndpoint(endpoint: string, candidate: string): void {
  let target: URL;
  let base: URL;
  try {
    base = new URL(endpoint);
    target = new URL(candidate, endpoint);
  } catch {
    throw new ProviderBindingError("That is not an address.", "INVALID");
  }
  if (target.origin !== base.origin) {
    throw new ProviderBindingError(
      "A credential may not follow a redirect to another origin.",
      "FORBIDDEN",
    );
  }
}

/** The full check, including what the name actually resolves to. */
async function assertReachableEndpoint(raw: string): Promise<string> {
  const url = assertPublicHttpsUrl(raw);
  try {
    await assertResolvedPublicEndpoint(url);
  } catch (error) {
    throw new ProviderBindingError(
      `That endpoint is not allowed: ${error instanceof Error ? error.message : "refused"}.`,
      "INVALID",
    );
  }
  return url.toString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit — kind, actor, time, outcome. Never material.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a binding event may carry.
 *
 * Assembled from named fields rather than spread from an object, so a column
 * added later cannot leak by existing. No caller can widen it, and the one
 * thing that must never appear here has no field to appear in.
 *
 *   RAW_PROVIDER_SECRET_IN_EVENT_LOG = 0
 */
async function audit(input: {
  type: string;
  scopeId: string;
  bindingId: string;
  definitionId: string;
  lifecycle: string;
  message: string;
  detail?: string;
  capabilities?: readonly string[];
}): Promise<void> {
  await db.insert(events).values({
    type: input.type,
    source: "runtime",
    ownerId: input.scopeId,
    message: input.message,
    payload: {
      bindingId: input.bindingId,
      definitionId: input.definitionId,
      lifecycle: input.lifecycle,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.capabilities ? { capabilities: [...input.capabilities] } : {}),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading a binding
// ─────────────────────────────────────────────────────────────────────────────

type BindingRow = typeof scopeProviderBindings.$inferSelect;

/**
 * The binding this principal may manage, or the same refusal as a stranger.
 *
 * A guessed id and somebody else's id give the identical NOT_FOUND, because a
 * refusal that distinguishes them turns guessing into an existence oracle.
 * Authority is re-read from the membership every time: a person who has left an
 * organization manages nothing it owns, whatever they once set up.
 *
 *   CROSS_SCOPE_BINDING = 0 · FORMER_MEMBER_MANAGES_ORG_BINDING = 0
 */
async function manageableBinding(input: {
  bindingId: string;
  principalId: string;
  now?: Date;
}): Promise<{ row: BindingRow; definition: ProviderDefinition }> {
  const [row] = await db
    .select()
    .from(scopeProviderBindings)
    .where(eq(scopeProviderBindings.id, input.bindingId))
    .limit(1);
  if (!row || !row.lifecycle) {
    throw new ProviderBindingError("No such connection.", "NOT_FOUND");
  }
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: row.scopeId,
    permission: "manage_providers",
    ...(input.now ? { now: input.now } : {}),
  });
  if (!allowed.ok) throw new ProviderBindingError("No such connection.", "NOT_FOUND");

  const definition = definitionOf(row.definitionId);
  if (!definition) {
    throw new ProviderBindingError("That provider is no longer registered.", "STATE");
  }
  return { row, definition };
}

function endpointOf(row: BindingRow, definition: ProviderDefinition): string {
  if (definition.endpoint.mode === "FIXED") return definition.endpoint.baseUrl;
  if (!row.endpointUrl) {
    throw new ProviderBindingError("This connection has no endpoint.", "STATE");
  }
  return row.endpointUrl;
}

/** Opens the credential for ONE call. The caller never sees it leave. */
async function credentialFor(row: BindingRow): Promise<Readonly<Record<string, string>>> {
  if (!row.credentialRef) {
    throw new ProviderBindingError("This connection has no credential.", "STATE");
  }
  const context: CredentialContext = {
    scopeId: row.scopeId,
    bindingId: row.id,
    version: row.credentialVersion,
  };
  return providerCredentialVault().open(row.credentialRef, context);
}

async function contextFor(
  row: BindingRow,
  definition: ProviderDefinition,
  capability: ProviderCapability,
): Promise<ProviderCallContext> {
  return {
    scopeId: row.scopeId,
    bindingId: row.id,
    endpoint: endpointOf(row, definition),
    capability,
    credential: await credentialFor(row),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 · SETUP — a link is not a connection
// ─────────────────────────────────────────────────────────────────────────────

export type SetupOpening = {
  readonly bindingId: string;
  readonly definitionId: string;
  readonly lifecycle: BindingLifecycle;
  /** What the trusted surface must collect. Field kinds, never values. */
  readonly collects: readonly { readonly key: string; readonly sensitive: boolean }[];
  readonly expiresAt: Date;
};

const DEFAULT_SETUP_TTL_MS = 15 * 60 * 1000;

/**
 * Open a connection.
 *
 * Creates the binding at SETUP_PENDING and says what a trusted surface must
 * collect. It stores no credential, contacts no provider and connects nothing.
 *
 *   SETUP_LINK != AUTHORIZATION · SETUP_LINK != CONNECTED_PROVIDER
 *   SETUP_LINK != SECRET
 *
 * `scopeId` arrives from a resolved acting scope. A model may say which
 * provider it thinks is meant and which capabilities it thinks are wanted; it
 * cannot say whose the connection is, and what it asks for is a REQUEST that
 * verification later intersects with reality.
 *
 *   MODEL_CAN_SET_BINDING_SCOPE = NO
 *   MODEL_CAN_DECLARE_PROVIDER_CONNECTED = NO
 */
export async function beginProviderSetup(input: {
  principalId: string;
  scopeId: string;
  definitionId: string;
  requestedCapabilities: readonly string[];
  ttlMs?: number;
  now?: Date;
}): Promise<SetupOpening> {
  const definition = definitionOf(input.definitionId);
  if (!definition) {
    throw new ProviderBindingError("That provider is not registered.", "NOT_FOUND");
  }
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: input.scopeId,
    permission: "manage_providers",
    ...(input.now ? { now: input.now } : {}),
  });
  if (!allowed.ok) {
    throw new ProviderBindingError("Not permitted to connect systems here.", "FORBIDDEN");
  }

  // A request for something the provider does not do is a mistake worth saying
  // out loud, rather than a grant that silently shrinks.
  const requested = input.requestedCapabilities.map((value) => value.trim().toUpperCase());
  for (const capability of requested) {
    if (!isCapability(capability)) {
      throw new ProviderBindingError(`«${capability}» is not a capability.`, "INVALID");
    }
    if (!definition.supports.includes(capability)) {
      throw new ProviderBindingError(
        `«${definition.id}» does not do ${capability}.`,
        "INVALID",
      );
    }
  }
  if (requested.length === 0) {
    throw new ProviderBindingError("A connection for nothing is not a connection.", "INVALID");
  }

  // ── THE ADDRESS IS NOT DECIDED HERE ──────────────────────────────────────
  //
  //   MODEL_SUGGESTED_ENDPOINT != TRUSTED_ENDPOINT
  //   CONVERSATION_URL != CREDENTIAL_TARGET
  //   SSRF_SAFE != AUTHORIZED_DESTINATION
  //
  // A custom provider's address is where somebody's credential will be sent.
  // Deciding that is an authority, and this function is reached from a
  // conversation — so it leaves the address EMPTY and says that the trusted
  // surface must collect it, beside the credential, in one submission.
  //
  // A public HTTPS address that passes every network check can still be the
  // wrong address. Network safety answers «is this safe to contact»; only the
  // trusted surface answers «did the authorized person choose this».
  const declaresEndpoint = definition.endpoint.mode === "DECLARED_AT_SETUP";

  // Connecting the same system twice is a decision, not an accident. An
  // existing live binding is surfaced rather than silently duplicated.
  const live = await db
    .select()
    .from(scopeProviderBindings)
    .where(
      and(
        eq(scopeProviderBindings.scopeId, input.scopeId),
        eq(scopeProviderBindings.providerClass, "connector"),
        eq(scopeProviderBindings.providerId, definition.id),
      ),
    )
    .limit(1);
  const existing = live[0];
  if (existing && existing.lifecycle && existing.lifecycle !== "REVOKED") {
    throw new ProviderBindingError(
      `«${definition.displayName}» is already connected here.`,
      "STATE",
    );
  }

  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_SETUP_TTL_MS));
  const id = existing?.id ?? `bind_${randomUUID()}`;
  const values = {
    id,
    scopeId: input.scopeId,
    providerClass: "connector",
    providerId: definition.id,
    definitionId: definition.id,
    lifecycle: "SETUP_PENDING" as const,
    requestedCapabilities: requested,
    discoveredCapabilities: [] as string[],
    grantedCapabilities: [] as string[],
    credentialRef: null,
    credentialVersion: 0,
    accountRef: null,
    accountLabel: null,
    endpointUrl: null,
    setupSessionId: `pbs_${randomUUID()}`,
    setupExpiresAt: expiresAt,
    setupConsumedAt: null,
    authenticatedAt: null,
    verifiedAt: null,
    suspendedReason: null,
    // The legacy column keeps its legacy meaning: `active` means usable, and
    // a connection nobody has verified is not usable.
    state: "pending",
    revokedAt: null,
    boundByPrincipalId: input.principalId,
  };
  if (existing) {
    await db.update(scopeProviderBindings).set(values).where(eq(scopeProviderBindings.id, id));
  } else {
    await db.insert(scopeProviderBindings).values(values);
  }
  await audit({
    type: "PROVIDER_SETUP_OPENED",
    scopeId: input.scopeId,
    bindingId: id,
    definitionId: definition.id,
    lifecycle: "SETUP_PENDING",
    message: `A trusted setup was opened for ${definition.displayName}.`,
    capabilities: requested,
  });
  return {
    bindingId: id,
    definitionId: definition.id,
    lifecycle: "SETUP_PENDING",
    collects: [
      // Not sensitive, and still trusted: it is typed by the person at the
      // same surface, in the same submission, as the credential it targets.
      ...(declaresEndpoint ? [{ key: "endpoint", sensitive: false }] : []),
      ...AUTH_MATERIAL[definition.authMethod].map((key) => ({ key, sensitive: true })),
    ],
    expiresAt,
  };
}

/**
 * Attach the credential a trusted surface collected.
 *
 * Called only from the trusted product-action handler, which is the boundary
 * that keeps credential material out of the conversation entirely.
 *
 *   CREDENTIAL_INPUT != CHAT_INPUT
 *   MODEL_SEES_PROVIDER_SECRET = 0 · CHAT_TRANSCRIPT_CONTAINS_SECRET = 0
 *
 * The binding moves to AUTHORIZED, which means a credential exists and nothing
 * more. Nobody has spoken to the provider yet.
 */
export async function completeProviderSetup(input: {
  bindingId: string;
  principalId: string;
  material: Readonly<Record<string, string>>;
  /**
   * The address, for a provider whose endpoint is declared at setup.
   *
   * It arrives HERE and nowhere else: in the same trusted submission as the
   * credential, against the same binding, under the same re-read of standing.
   * That is deliberate — a credential collected on a trusted surface and sent
   * to a destination chosen somewhere else is not a trusted connection, it is
   * two halves that were never checked against each other.
   *
   *   TRUSTED_CREDENTIAL + UNTRUSTED_DESTINATION = INVALID CONNECTION
   */
  endpointUrl?: string;
  now?: Date;
}): Promise<{ lifecycle: BindingLifecycle; endpointHost: string | null }> {
  const now = input.now ?? new Date();
  const { row, definition } = await manageableBinding({
    bindingId: input.bindingId,
    principalId: input.principalId,
    now,
  });
  if (row.lifecycle !== "SETUP_PENDING") {
    throw new ProviderBindingError("That setup is not open.", "STATE");
  }
  // One-time, and time-bound. A replayed setup finds a consumed one.
  //
  //   SETUP_LINK_REPLAY_ACCEPTED = 0 · EXPIRED_SETUP_LINK_ACCEPTED = 0
  if (row.setupConsumedAt) {
    throw new ProviderBindingError("That setup was already used.", "STATE");
  }
  if (!row.setupExpiresAt || row.setupExpiresAt.getTime() <= now.getTime()) {
    throw new ProviderBindingError("That setup has expired.", "STATE");
  }

  const required = AUTH_MATERIAL[definition.authMethod];
  const material: Record<string, string> = {};
  for (const key of required) {
    const value = input.material[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new ProviderBindingError(`«${key}» is missing.`, "INVALID");
    }
    material[key] = value;
  }

  // ── THE ADDRESS, DECIDED HERE ────────────────────────────────────────────
  //
  // A FIXED provider's address is registry code and cannot be named from
  // outside at all — an address supplied for one is refused rather than
  // ignored, because silently dropping it would leave whoever sent it
  // believing it took effect.
  //
  //   MODEL_OVERRIDES_FIXED_PROVIDER_ENDPOINT = 0
  let endpointUrl: string | null = null;
  if (definition.endpoint.mode === "DECLARED_AT_SETUP") {
    if (!input.endpointUrl) {
      throw new ProviderBindingError("This connection needs an address.", "INVALID");
    }
    endpointUrl = await assertReachableEndpoint(input.endpointUrl);
  } else if (input.endpointUrl) {
    throw new ProviderBindingError("This provider's address is not yours to set.", "INVALID");
  }

  const version = row.credentialVersion + 1;
  // Rotation retires everything older first, so two credentials are never
  // ambiguous authority for one binding.
  await providerCredentialVault().retire(row.id);
  const reference = await providerCredentialVault().seal(
    { scopeId: row.scopeId, bindingId: row.id, version },
    required.length === 0 ? { trustedInternal: "1" } : material,
  );

  await db
    .update(scopeProviderBindings)
    .set({
      lifecycle: "AUTHORIZED",
      credentialRef: reference,
      credentialVersion: version,
      setupConsumedAt: now,
      // Written in the same statement as the credential reference. There is no
      // window in which one is bound and the other is not.
      ...(endpointUrl ? { endpointUrl } : {}),
    })
    .where(eq(scopeProviderBindings.id, row.id));
  await audit({
    type: "PROVIDER_CREDENTIAL_ATTACHED",
    scopeId: row.scopeId,
    bindingId: row.id,
    definitionId: definition.id,
    lifecycle: "AUTHORIZED",
    message: `A credential reference was attached to ${definition.displayName}.`,
    // The HOST, and only the host. Never a path, never a query string — a
    // query string is where a secret would be if one were ever in a URL.
    ...(endpointUrl ? { detail: new URL(endpointUrl).host } : {}),
  });
  return {
    lifecycle: "AUTHORIZED",
    endpointHost: endpointUrl ? new URL(endpointUrl).host : null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · AUTHENTICATION — the credentials work
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ask the provider who we are.
 *
 * Proves exactly one thing: these credentials are accepted. It proves nothing
 * about which account answered or what it can do, which is why this is its own
 * state and not the last one.
 *
 *   AUTHORIZED != AUTHENTICATED
 */
export async function authenticateBinding(input: {
  bindingId: string;
  principalId: string;
  now?: Date;
}): Promise<
  | { readonly status: "AUTHENTICATED"; readonly accountRef: string; readonly accountLabel: string | null }
  | { readonly status: "FAILED"; readonly detail: string }
> {
  const now = input.now ?? new Date();
  const { row, definition } = await manageableBinding({
    bindingId: input.bindingId,
    principalId: input.principalId,
    now,
  });
  if (row.lifecycle !== "AUTHORIZED" && row.lifecycle !== "AUTHENTICATED") {
    throw new ProviderBindingError("There is nothing to authenticate yet.", "STATE");
  }
  // A test uses the safest capability the provider has, and never a mutating
  // one. Writing something to find out whether writing works is not a test.
  //
  //   CONNECTION_TEST_CAUSES_BUSINESS_MUTATION = 0
  const probe = definition.supports.find((capability) => !capabilityMutates(capability));
  if (!probe) {
    throw new ProviderBindingError(
      "This provider offers no safe way to test a connection.",
      "STATE",
    );
  }
  const context = await contextFor(row, definition, probe);
  const outcome = await definition.adapter.authenticate(context);
  if (!outcome.ok) {
    await db
      .update(scopeProviderBindings)
      .set({ lifecycle: "SUSPENDED", suspendedReason: "AUTHENTICATION_FAILED", state: "pending" })
      .where(eq(scopeProviderBindings.id, row.id));
    await audit({
      type: "PROVIDER_AUTHENTICATION_FAILED",
      scopeId: row.scopeId,
      bindingId: row.id,
      definitionId: definition.id,
      lifecycle: "SUSPENDED",
      message: `${definition.displayName} did not accept the credential.`,
      detail: outcome.detail,
    });
    return { status: "FAILED", detail: outcome.detail };
  }
  await db
    .update(scopeProviderBindings)
    .set({
      lifecycle: "AUTHENTICATED",
      accountRef: outcome.accountRef,
      accountLabel: outcome.accountLabel ?? null,
      authenticatedAt: now,
      suspendedReason: null,
    })
    .where(eq(scopeProviderBindings.id, row.id));
  await audit({
    type: "PROVIDER_AUTHENTICATED",
    scopeId: row.scopeId,
    bindingId: row.id,
    definitionId: definition.id,
    lifecycle: "AUTHENTICATED",
    message: `${definition.displayName} accepted the credential.`,
  });
  return {
    status: "AUTHENTICATED",
    accountRef: outcome.accountRef,
    accountLabel: outcome.accountLabel ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · VERIFICATION — it is the account we expected, and this is what it can do
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify the connection and record what it may do.
 *
 *   AUTHENTICATION_SUCCESS != FULL_PROVIDER_VERIFICATION
 *
 * Two separate things happen. The account is checked against what was expected,
 * where an expectation was given — otherwise the account that answered is
 * recorded and nothing is claimed about it. And capabilities are DISCOVERED
 * from the provider, then intersected with what the definition supports and
 * what was asked for.
 *
 * The grant is the intersection and never the request. A person asking for
 * WRITE from a read-only account gets READ.
 *
 *   VERIFIED != FULL ACCESS
 *   PROVIDER_SUPPORTS_CAPABILITY != BINDING_GRANTED_CAPABILITY
 */
export async function verifyBinding(input: {
  bindingId: string;
  principalId: string;
  /** What the person said this connection should be. Checked, not assumed. */
  expectedAccountRef?: string;
  now?: Date;
}): Promise<
  | {
      readonly status: "VERIFIED";
      readonly granted: readonly ProviderCapability[];
      readonly discovered: readonly ProviderCapability[];
      readonly withheld: readonly ProviderCapability[];
    }
  | { readonly status: "FAILED"; readonly detail: string }
> {
  const now = input.now ?? new Date();
  const { row, definition } = await manageableBinding({
    bindingId: input.bindingId,
    principalId: input.principalId,
    now,
  });
  if (row.lifecycle !== "AUTHENTICATED" && row.lifecycle !== "VERIFIED") {
    throw new ProviderBindingError("Authenticate the connection first.", "STATE");
  }
  if (input.expectedAccountRef && row.accountRef !== input.expectedAccountRef) {
    await db
      .update(scopeProviderBindings)
      .set({ lifecycle: "SUSPENDED", suspendedReason: "ACCOUNT_MISMATCH", state: "pending" })
      .where(eq(scopeProviderBindings.id, row.id));
    await audit({
      type: "PROVIDER_VERIFICATION_FAILED",
      scopeId: row.scopeId,
      bindingId: row.id,
      definitionId: definition.id,
      lifecycle: "SUSPENDED",
      message: `${definition.displayName} answered as a different account.`,
      detail: "ACCOUNT_MISMATCH",
    });
    return { status: "FAILED", detail: "This is not the account that was expected." };
  }

  const probe = definition.supports.find((capability) => !capabilityMutates(capability));
  if (!probe) {
    throw new ProviderBindingError("This provider offers no safe way to verify.", "STATE");
  }
  const context = await contextFor(row, definition, probe);
  let discovered: readonly ProviderCapability[];
  try {
    discovered = await definition.adapter.discover(context);
  } catch (error) {
    await db
      .update(scopeProviderBindings)
      .set({ lifecycle: "SUSPENDED", suspendedReason: "DISCOVERY_FAILED", state: "pending" })
      .where(eq(scopeProviderBindings.id, row.id));
    return {
      status: "FAILED",
      detail: error instanceof Error ? error.message : "Discovery failed.",
    };
  }

  const supported = new Set(definition.supports);
  const requested = new Set(row.requestedCapabilities);
  const usable = discovered.filter((capability) => isCapability(capability) && supported.has(capability));
  const granted = usable.filter((capability) => requested.has(capability));
  const withheld = [...requested].filter(
    (capability): capability is ProviderCapability =>
      isCapability(capability) && !granted.includes(capability),
  );

  if (granted.length === 0) {
    await db
      .update(scopeProviderBindings)
      .set({
        lifecycle: "SUSPENDED",
        suspendedReason: "NO_CAPABILITY_GRANTED",
        discoveredCapabilities: usable,
        state: "pending",
      })
      .where(eq(scopeProviderBindings.id, row.id));
    await audit({
      type: "PROVIDER_VERIFICATION_FAILED",
      scopeId: row.scopeId,
      bindingId: row.id,
      definitionId: definition.id,
      lifecycle: "SUSPENDED",
      message: `${definition.displayName} grants none of what was asked for.`,
      detail: "NO_CAPABILITY_GRANTED",
    });
    return { status: "FAILED", detail: "This account can do none of what was asked for." };
  }

  await db
    .update(scopeProviderBindings)
    .set({
      lifecycle: "VERIFIED",
      discoveredCapabilities: usable,
      grantedCapabilities: granted,
      verifiedAt: now,
      suspendedReason: null,
      // Only NOW does the legacy column say usable, which is what it always meant.
      state: "active",
    })
    .where(eq(scopeProviderBindings.id, row.id));
  await audit({
    type: "PROVIDER_VERIFIED",
    scopeId: row.scopeId,
    bindingId: row.id,
    definitionId: definition.id,
    lifecycle: "VERIFIED",
    message: `${definition.displayName} is connected and checked.`,
    capabilities: granted,
  });
  return { status: "VERIFIED", granted, discovered: usable, withheld };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · THE GATE — what stands between a capability and a call
// ─────────────────────────────────────────────────────────────────────────────

export type ProviderCallRefusal =
  /** Nothing here, or nothing this principal may see. The same answer for both. */
  | "NO_SUCH_BINDING"
  /** It exists and is not finished, suspended, or revoked. */
  | "BINDING_NOT_USABLE"
  /** The provider may do it; THIS binding was not granted it. */
  | "CAPABILITY_NOT_GRANTED"
  /** The binding may do it; this principal has no authority to act. */
  | "NOT_AUTHORIZED_TO_ACT";

export type ProviderCallOutcome =
  | { readonly status: "OK"; readonly value: unknown; readonly observedAt: Date }
  | { readonly status: "REFUSED"; readonly refusal: ProviderCallRefusal; readonly detail: string }
  /** The provider could not answer. This says nothing about the world. */
  | { readonly status: "PROVIDER_UNAVAILABLE"; readonly detail: string }
  | { readonly status: "PROVIDER_ERROR"; readonly detail: string };

/**
 * Call a provider through a binding.
 *
 * Four gates, in this order, and every one of them before the adapter is
 * reached. Nothing here asks the model anything.
 *
 *   1  the binding is this scope's                 NO_SUCH_BINDING
 *   2  the binding is VERIFIED                     BINDING_NOT_USABLE
 *   3  the capability was GRANTED to this binding  CAPABILITY_NOT_GRANTED
 *   4  a mutating call needs JASIM's own authority NOT_AUTHORIZED_TO_ACT
 *
 * The fourth is the one that is easy to lose. A calendar provider supporting
 * CREATE, and a binding granted CREATE, still does not mean any suggestion may
 * create anything: the acting principal must hold `mutate` in the scope, and
 * the policy, approval and execution runtimes remain in front of that as they
 * were.
 *
 *   PROVIDER_WRITE_PERMISSION != JASIM_ACTION_AUTHORITY
 *   UNGRANTED_CAPABILITY_PROVIDER_CALL = 0
 *   UNAUTHORIZED_WRITE_PROVIDER_CALL = 0
 *   REVOKED_BINDING_USED = 0
 */
export async function callProvider(input: {
  bindingId: string;
  principalId: string;
  capability: string;
  parameters?: Readonly<Record<string, unknown>>;
  now?: Date;
}): Promise<ProviderCallOutcome> {
  const now = input.now ?? new Date();
  const capability = input.capability.trim().toUpperCase();
  if (!isCapability(capability)) {
    return {
      status: "REFUSED",
      refusal: "CAPABILITY_NOT_GRANTED",
      detail: `«${input.capability}» is not a capability.`,
    };
  }

  const [row] = await db
    .select()
    .from(scopeProviderBindings)
    .where(eq(scopeProviderBindings.id, input.bindingId))
    .limit(1);
  if (!row || !row.lifecycle) {
    return { status: "REFUSED", refusal: "NO_SUCH_BINDING", detail: "No such connection." };
  }
  // Standing in the scope is re-read now, not remembered from when the
  // connection was made. Someone who has left uses nothing.
  const mayUse = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: row.scopeId,
    permission: "view",
    now,
  });
  if (!mayUse.ok) {
    return { status: "REFUSED", refusal: "NO_SUCH_BINDING", detail: "No such connection." };
  }

  // A revoked binding is refused here, before the credential is even looked
  // for. Local revocation means JASIM will not use it again, whatever still
  // exists at the provider or in the vault.
  if (row.lifecycle !== "VERIFIED") {
    return {
      status: "REFUSED",
      refusal: "BINDING_NOT_USABLE",
      detail: `This connection is ${row.lifecycle.toLowerCase()}.`,
    };
  }

  if (!row.grantedCapabilities.includes(capability)) {
    return {
      status: "REFUSED",
      refusal: "CAPABILITY_NOT_GRANTED",
      detail: `This connection was not granted ${capability}.`,
    };
  }

  if (capabilityMutates(capability)) {
    const mayAct = await authorizeScopeAction({
      principalId: input.principalId,
      scopeId: row.scopeId,
      permission: "mutate",
      now,
    });
    if (!mayAct.ok) {
      return {
        status: "REFUSED",
        refusal: "NOT_AUTHORIZED_TO_ACT",
        detail: "Permission at the provider is not authority to act here.",
      };
    }
  }

  const definition = definitionOf(row.definitionId);
  if (!definition) {
    return {
      status: "REFUSED",
      refusal: "BINDING_NOT_USABLE",
      detail: "That provider is no longer registered.",
    };
  }

  let result: ProviderResult;
  try {
    const context = await contextFor(row, definition, capability);
    result = await definition.adapter.invoke(context, {
      capability,
      parameters: input.parameters ?? {},
    });
  } catch (error) {
    // A thrown adapter is an unavailable provider, never a fact.
    return {
      status: "PROVIDER_UNAVAILABLE",
      detail: error instanceof Error ? error.message : "The provider could not be reached.",
    };
  }

  //   PROVIDER_UNAVAILABLE != BUSINESS_FACT · PROVIDER_ERROR != UNAVAILABLE
  //
  // Neither is translated into «not in stock», «no booking» or «false». They
  // are reported as what they are, and the caller keeps its other sources —
  // among them asking the person who knows.
  if (result.status === "UNAVAILABLE") {
    return { status: "PROVIDER_UNAVAILABLE", detail: result.detail };
  }
  if (result.status === "ERROR") {
    return { status: "PROVIDER_ERROR", detail: result.detail };
  }
  return { status: "OK", value: result.value, observedAt: result.observedAt ?? now };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · WHAT A PROVIDER SAID IS EVIDENCE, AND EVIDENCE IS NOT A VERDICT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The proof class a bound provider's answer carries.
 *
 * `BOUND_PROVIDER_RECEIPT` was already in the claim-source vocabulary and
 * already inside the freshness runtime's consequential set — but no proof class
 * mapped to it, so on the EVIDENCE axis it was unreachable: the strongest
 * machine source a policy accepted was one nothing could produce. This is the
 * class that reaches it, and it is set by this trusted call site from the
 * CHANNEL, never lifted from a payload.
 */
export const BOUND_PROVIDER_PROOF_CLASS = "bound_provider_receipt";

/**
 * Record what a verified binding read, as an observation.
 *
 * This function decides NOTHING. It does not say the thing is available, that
 * a booking may proceed, or that a fact is true. It writes down that a bound
 * provider said something at a time, attributed to that provider — and the
 * freshness runtime then decides whether that is good enough for the purpose at
 * hand, exactly as it does for a human answer.
 *
 *   PROVIDER_RESPONSE != CANONICAL_TRUTH
 *   PROVIDER_BINDING_DECLARES_BUSINESS_TRUTH = 0
 *   PROVIDER_RESPONSE_BYPASSES_FRESHNESS = 0
 */
export async function recordProviderEvidence(input: {
  bindingId: string;
  principalId: string;
  subjectKind: string;
  subjectId: string;
  property: string;
  value: unknown;
  observedAt: Date;
  freshnessTtlMs?: number;
}): Promise<{ observationId: string }> {
  const [row] = await db
    .select()
    .from(scopeProviderBindings)
    .where(eq(scopeProviderBindings.id, input.bindingId))
    .limit(1);
  if (!row || row.lifecycle !== "VERIFIED") {
    throw new ProviderBindingError("Only a verified connection is evidence.", "STATE");
  }
  const observation = await recordObservation(db, {
    ownerId: row.scopeId,
    subjectKind: input.subjectKind,
    subjectId: input.subjectId,
    observationType: input.property,
    observedAt: input.observedAt,
    sourceKind: BOUND_PROVIDER_PROOF_CLASS,
    providerId: row.definitionId ?? row.providerId,
    provenance: {
      bindingId: row.id,
      definitionId: row.definitionId,
      accountRef: row.accountRef,
    },
    payload: { value: input.value },
    ...(input.freshnessTtlMs === undefined ? {} : { freshnessTtlMs: input.freshnessTtlMs }),
  });
  return { observationId: observation.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// 6 · REVOCATION — local first, and local is enough
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Disconnect.
 *
 * The binding goes to REVOKED and its credentials are retired, both before any
 * attempt is made to tell the provider. If the remote revocation fails, JASIM
 * still will not use the connection again — a provider that cannot be told is
 * not a reason to keep acting.
 *
 *   LOCAL_REVOKED means JASIM WILL NOT USE IT AGAIN
 *   REVOKED_BINDING_USED = 0
 */
export async function revokeBinding(input: {
  bindingId: string;
  principalId: string;
  now?: Date;
}): Promise<{ lifecycle: "REVOKED"; remoteRevocation: "DONE" | "FAILED" | "NOT_SUPPORTED" }> {
  const now = input.now ?? new Date();
  const { row, definition } = await manageableBinding({
    bindingId: input.bindingId,
    principalId: input.principalId,
    now,
  });
  await db
    .update(scopeProviderBindings)
    .set({
      lifecycle: "REVOKED",
      state: "revoked",
      revokedAt: now,
      grantedCapabilities: [],
      credentialRef: null,
      suspendedReason: null,
    })
    .where(eq(scopeProviderBindings.id, row.id));
  await providerCredentialVault().retire(row.id);
  await audit({
    type: "PROVIDER_REVOKED",
    scopeId: row.scopeId,
    bindingId: row.id,
    definitionId: definition.id,
    lifecycle: "REVOKED",
    message: `${definition.displayName} was disconnected.`,
  });
  return { lifecycle: "REVOKED", remoteRevocation: "NOT_SUPPORTED" };
}

// ─────────────────────────────────────────────────────────────────────────────
// 7 · WHAT A PERSON MAY SEE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safe metadata for one binding.
 *
 * Assembled field by field from a fixed list. There is no spread of the row and
 * no pass-through of anything the vault holds, so a column added later cannot
 * leak by existing, and the credential reference itself does not appear —
 * a reference is not a secret, and it is also not anybody's business.
 *
 *   SECRET_RETURNED_IN_BINDING_READ = 0
 */
export type BindingProjection = {
  readonly bindingId: string;
  readonly providerName: string;
  readonly lifecycle: BindingLifecycle;
  readonly capabilities: readonly string[];
  readonly accountLabel: string | null;
  readonly lastVerifiedAt: Date | null;
  readonly suspendedReason: string | null;
};

function project(row: BindingRow, definition: ProviderDefinition | undefined): BindingProjection {
  return {
    bindingId: row.id,
    providerName: definition?.displayName ?? row.providerId,
    lifecycle: (row.lifecycle ?? "SETUP_PENDING") as BindingLifecycle,
    capabilities: [...row.grantedCapabilities],
    accountLabel: row.accountLabel,
    lastVerifiedAt: row.verifiedAt,
    suspendedReason: row.suspendedReason,
  };
}

/** «ما الأنظمة المربوطة؟» — for a scope this principal actually stands in. */
export async function projectBindings(input: {
  principalId: string;
  scopeId: string;
  now?: Date;
}): Promise<readonly BindingProjection[]> {
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: input.scopeId,
    permission: "view",
    ...(input.now ? { now: input.now } : {}),
  });
  if (!allowed.ok) return [];
  const rows = await db
    .select()
    .from(scopeProviderBindings)
    .where(eq(scopeProviderBindings.scopeId, input.scopeId));
  return rows
    .filter((row) => row.lifecycle !== null)
    .map((row) => project(row, definitionOf(row.definitionId)));
}

/** «ما الذي تستطيع فعله بهذا الربط؟» — granted, never supported. */
export async function bindingCapabilities(input: {
  bindingId: string;
  principalId: string;
  now?: Date;
}): Promise<
  | {
      readonly granted: readonly string[];
      readonly reads: readonly string[];
      readonly writes: readonly string[];
      readonly supportedButNotGranted: readonly string[];
    }
  | null
> {
  const [row] = await db
    .select()
    .from(scopeProviderBindings)
    .where(eq(scopeProviderBindings.id, input.bindingId))
    .limit(1);
  if (!row || !row.lifecycle) return null;
  const allowed = await authorizeScopeAction({
    principalId: input.principalId,
    scopeId: row.scopeId,
    permission: "view",
    ...(input.now ? { now: input.now } : {}),
  });
  if (!allowed.ok) return null;
  const definition = definitionOf(row.definitionId);
  const granted = [...row.grantedCapabilities];
  return {
    granted,
    reads: granted.filter((capability) => !capabilityMutates(capability)),
    writes: granted.filter((capability) => capabilityMutates(capability)),
    supportedButNotGranted: (definition?.supports ?? []).filter(
      (capability) => !granted.includes(capability),
    ),
  };
}

/** Whether a scope has a usable connection that can do something. Data, not truth. */
export async function usableBindingFor(input: {
  scopeId: string;
  capability: ProviderCapability;
}): Promise<{ bindingId: string; definitionId: string } | null> {
  const rows = await db
    .select()
    .from(scopeProviderBindings)
    .where(
      and(
        eq(scopeProviderBindings.scopeId, input.scopeId),
        eq(scopeProviderBindings.lifecycle, "VERIFIED"),
      ),
    );
  const row = rows.find((candidate) => candidate.grantedCapabilities.includes(input.capability));
  if (!row) return null;
  return { bindingId: row.id, definitionId: row.definitionId ?? row.providerId };
}

/** Audit-only. Never projected, and never returned to a caller with a credential. */
export async function credentialRowsForAudit(bindingId: string): Promise<number> {
  const rows = await db
    .select({ id: providerCredentials.id })
    .from(providerCredentials)
    .where(eq(providerCredentials.bindingId, bindingId));
  return rows.length;
}
