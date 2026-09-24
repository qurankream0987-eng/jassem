/**
 * JASIM — THE CANONICAL PERSISTENT WORLD RUNTIME.
 *
 * ─── THE LAW ────────────────────────────────────────────────────────────────
 *
 *   CONVERSATION
 *     -> SEMANTIC ROUTER
 *       -> PERSISTENT_WORLD
 *         -> VALIDATED WorldDefinition
 *           -> SCOPE / AUTHORIZATION
 *             -> POLICY / APPROVAL
 *               -> ATOMIC MATERIALIZATION
 *                 -> worldId · version 1 · durable event · projection
 *
 *   ROUTED       != MATERIALIZED
 *   MATERIALIZED != CONFIGURED
 *   CONFIGURED   != EXTERNALLY_CONNECTED
 *
 * A World is a durable, versioned, authorized operational state that may
 * outlive a conversation, a Run, a Task, a Bubble or a device session.
 *
 * ─── AND WHAT IT IS NOT ─────────────────────────────────────────────────────
 *
 * Not an agent, not an intelligence, not a domain application, not a
 * dashboard, not a replacement for the conversation, not a database a model
 * designed, and not a generated React app. A World holds general canonical
 * structure — entities, relations, policies, workflows — and every one of
 * those words is already in this runtime's vocabulary.
 *
 *   DOMAIN_WORLD_TYPES_ADDED     = 0
 *   DOMAIN_WORLD_RENDERERS_ADDED = 0
 *   WORLD_MARKETPLACE_CORES_ADDED = 0
 *
 * ─── WHAT THIS MODULE IS, AND IS NOT, ALLOWED TO BE ─────────────────────────
 *
 * There was already a World: `generated_systems` and `system_versions`, with
 * lineage, a semantic digest, a request key and a rollback that creates a new
 * version rather than erasing one. Nothing here replaces any of it. This is
 * the CONVERSATIONAL boundary that was missing — scope, validation, policy,
 * authority, atomic commit, durable events and a canonical projection — and it
 * commits through the same service and the same tables.
 *
 *   PARALLEL_WORLD_SYSTEMS_ADDED = 0
 *
 * ─── WHAT A MODEL MAY AND MAY NOT DO ────────────────────────────────────────
 *
 * It may propose a definition and name a change. It may not say whose world it
 * is, which scope is acting, what permission it holds, that a policy allowed
 * it, that somebody approved it, or what version is current. Those are the
 * runtime's own words, and `WORLD_AUTHORITY_KEYS` refuses them before the
 * schema is reached.
 */

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../queries/connection";
import { conversations, events } from "../../db/schema";
import { WorldDNASchema, type WorldDNA } from "../../contracts/dna";
import {
  WorldVersionConflictError,
  type GeneratedWorldSystem,
  type GeneratedWorldVersion,
} from "../../contracts/generated-world";
import { GeneratedWorldService } from "../core/generated-world-service";
import { DrizzleGeneratedWorldRepository } from "../core/generated-world-repository";
import { authorizeScopeAction, type ActingScope, type ScopePermission } from "./actor-scope";
import { evaluatePolicies, type PolicyDecision } from "./policy-enforcement";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — closed, and naming no industry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a change to a World can BE.
 *
 * Seven classes, and every mutation there will ever be is one of them.
 * «أضف عضواً» is a PERMISSION change whether the world organizes a school or a
 * foundry; «أضف مورداً» is DATA whether the resource is a lathe or a beehive.
 * A class named after an industry would be the first domain branch.
 *
 *   DOMAIN_MUTATION_CLASSES_ADDED = 0
 */
export const WORLD_MUTATION_CLASSES = [
  "DATA",
  "STRUCTURAL",
  "POLICY",
  "WORKFLOW",
  "VIEW",
  "PERMISSION",
  "COMMERCIAL",
] as const;
export type WorldMutationClass = (typeof WORLD_MUTATION_CLASSES)[number];

export const WORLD_CHANGE_OPERATIONS = ["add", "replace", "remove"] as const;
export type WorldChangeOperation = (typeof WORLD_CHANGE_OPERATIONS)[number];

/**
 * WHERE in a world a change lands. Also general: an entity is an entity.
 *
 * The target decides the class, not the caller — see `classOf`.
 */
export const WORLD_CHANGE_TARGETS = [
  "entity",
  "field",
  "relation",
  "policy",
  "workflow",
  "participant",
  "view",
] as const;
export type WorldChangeTarget = (typeof WORLD_CHANGE_TARGETS)[number];

/**
 * The class each target belongs to, decided HERE.
 *
 * A caller may state the class it believes it is making; if the statement
 * disagrees with what the change actually touches, the change is refused. A
 * POLICY change arriving labelled DATA would otherwise take the permission a
 * DATA change needs.
 */
const CLASS_OF_TARGET: Readonly<Record<WorldChangeTarget, WorldMutationClass>> = Object.freeze({
  entity: "STRUCTURAL",
  field: "STRUCTURAL",
  relation: "STRUCTURAL",
  policy: "POLICY",
  workflow: "WORKFLOW",
  participant: "PERMISSION",
  view: "VIEW",
});

/**
 * The permission each class needs, taken from the scope model that already
 * exists. Nothing here invents a permission, and nothing here is a second
 * permission system.
 */
const PERMISSION_OF_CLASS: Readonly<Record<WorldMutationClass, ScopePermission>> = Object.freeze({
  DATA: "mutate",
  STRUCTURAL: "mutate",
  VIEW: "mutate",
  WORKFLOW: "mutate",
  POLICY: "manage_policies",
  PERMISSION: "manage_members",
  COMMERCIAL: "act_financially",
});

/**
 * The classes a person must authorize by READING a statement, not by a change
 * arriving. Rules and permissions decide what everyone else may do, so a
 * conversation cannot be the whole ceremony for them.
 *
 *   APPROVAL != CLICK
 */
const REQUIRES_AUTHORITY_ACT: ReadonlySet<WorldMutationClass> = new Set<WorldMutationClass>([
  "POLICY",
  "PERMISSION",
  "COMMERCIAL",
]);

/**
 * Keys a caller may never supply, anywhere in a definition or a change.
 *
 * Each one is the proposal trying to BE the decision. Mirrored against
 * `AUTHORITY_KEYS` in `model-output-trust.ts`, and a test holds the two
 * together.
 */
export const WORLD_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "ownerid",
  "scopeid",
  "principalid",
  "tenantid",
  "businessid",
  "organizationid",
  "actingscopeid",
  "membership",
  "role",
  "permission",
  "permissions",
  "permissiongranted",
  "authorized",
  "authorization",
  "approved",
  "approval",
  "approvedby",
  "policydecision",
  "policyoverride",
  // `version` is not here and is still refused: the proposal schema is
  // `.strict()` and never declared it. It stays out of this set because the
  // shared `AUTHORITY_KEYS` screens every model output in the runtime, and a
  // plan envelope's own `version: 1` is a schema field rather than a claim.
  "currentversion",
  "expectedversion",
  "status",
  "worldid",
  "worldkey",
  "visibility",
  "createdby",
]);

/**
 * Text that is a PROGRAM rather than a description.
 *
 *   MODEL -> raw database schema / SQL / eval / generated executable server
 *   code / arbitrary React or HTML  ==  never
 *
 * A world definition describes structure. The moment one carries something
 * executable, the definition has stopped being a proposal and started being
 * an instruction to a machine that never agreed to run it.
 */
const EXECUTABLE_SHAPES: readonly RegExp[] = Object.freeze([
  /<\s*script\b/i,
  /<\/\s*script\s*>/i,
  /\bjavascript\s*:/i,
  /\beval\s*\(/i,
  /\bnew\s+Function\s*\(/i,
  /\bfunction\s*\*?\s*\(/i,
  // An arrow followed by anything that could be a body. The narrower form
  // `=>\s*[{(]` let `() => true` through, which is every bit as much a program
  // as `() => { return true }`.
  /=>\s*[\w{(['"`]/,
  /\brequire\s*\(/i,
  /\bimport\s*\(/i,
  /\bprocess\s*\.\s*env\b/i,
  /\b(select|insert|update|delete|drop|alter|create)\b[\s\S]{0,40}\b(from|into|table|database|set)\b/i,
  /\bunion\b[\s\S]{0,20}\bselect\b/i,
  /\$\{/,
  /\bon(?:error|load|click)\s*=/i,
]);

export class WorldError extends Error {
  readonly code:
    | "INVALID"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "CONFLICT"
    | "NEEDS_AUTHORITY"
    | "UNSUPPORTED"
    | "STATE";
  /** Filled for CONFLICT, so a caller can rebase instead of guessing. */
  readonly currentVersion?: string;
  constructor(message: string, code: WorldError["code"], currentVersion?: string) {
    super(message);
    this.code = code;
    this.name = "WorldError";
    if (currentVersion !== undefined) this.currentVersion = currentVersion;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The proposal a model may make
// ─────────────────────────────────────────────────────────────────────────────

const KEY = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, "A key is lower-case letters, digits and underscores.");

const LABEL = z.string().trim().min(1).max(160);

/** The field types a world may declare. Exactly the canonical set, no more. */
export const WORLD_FIELD_TYPES = [
  "string", "number", "boolean", "date", "datetime", "email", "url", "uuid",
  "json", "text", "currency", "percentage", "enum", "reference", "geolocation",
] as const;

export const WorldFieldProposalSchema = z
  .object({ key: KEY, label: LABEL, type: z.enum(WORLD_FIELD_TYPES).default("string") })
  .strict();

export const WorldEntityProposalSchema = z
  .object({
    key: KEY,
    label: LABEL,
    fields: z.array(WorldFieldProposalSchema).max(60).default([]),
  })
  .strict();

export const WorldRelationProposalSchema = z
  .object({
    key: KEY,
    label: LABEL,
    from: KEY,
    to: KEY,
    cardinality: z.enum(["one_to_one", "one_to_many", "many_to_one", "many_to_many"]),
  })
  .strict();

export const WorldPolicyProposalSchema = z
  .object({
    key: KEY,
    label: LABEL,
    /** An entity key, or `*` for the whole world. Validated against reality. */
    target: z.string().trim().min(1).max(60),
    condition: z.string().trim().min(1).max(400),
    effect: z.enum(["allow", "deny", "warn", "require_approval"]),
  })
  .strict();

export const WorldWorkflowProposalSchema = z
  .object({
    key: KEY,
    label: LABEL,
    steps: z.array(z.object({ key: KEY, label: LABEL }).strict()).max(30).default([]),
  })
  .strict();

export const WorldParticipantProposalSchema = z
  .object({ key: KEY, label: LABEL, capacity: z.string().trim().min(1).max(80) })
  .strict();

/**
 * What a model may propose. Strict, and deliberately small.
 *
 * There is no `ownerId`, no `scopeId`, no `visibility`, no `version`, no
 * `status`, no `capabilities` and no `ui`. Ownership is the runtime's. A
 * capability BINDING is authority — a world that could bind its own
 * capabilities would be granting itself the right to act — so a world declares
 * structure and the runtime keeps the binding for a decision with its own
 * evidence.
 */
export const WorldDefinitionProposalSchema = z
  .object({
    title: LABEL,
    purpose: z.string().trim().max(600).optional(),
    entities: z.array(WorldEntityProposalSchema).max(40).default([]),
    relations: z.array(WorldRelationProposalSchema).max(80).default([]),
    policies: z.array(WorldPolicyProposalSchema).max(40).default([]),
    workflows: z.array(WorldWorkflowProposalSchema).max(30).default([]),
    participants: z.array(WorldParticipantProposalSchema).max(30).default([]),
  })
  .strict();
export type WorldDefinitionProposal = z.infer<typeof WorldDefinitionProposalSchema>;

/** ONE change. A ChangeSet is a list of these and is all-or-nothing. */
export const WorldChangeSchema = z
  .object({
    /** What the caller believes it is doing. Checked against reality. */
    class: z.enum(WORLD_MUTATION_CLASSES).optional(),
    operation: z.enum(WORLD_CHANGE_OPERATIONS),
    target: z.enum(WORLD_CHANGE_TARGETS),
    key: KEY,
    /** The entity a field belongs to, or the workflow a step belongs to. */
    parentKey: KEY.optional(),
    value: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type WorldChange = z.infer<typeof WorldChangeSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Untrusted until validated
// ─────────────────────────────────────────────────────────────────────────────

function walkStrings(value: unknown, visit: (text: string, path: string) => void, path = ""): void {
  if (typeof value === "string") return visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, visit, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      walkStrings(item, visit, path ? `${path}.${key}` : key);
    }
  }
}

function walkKeys(value: unknown, visit: (key: string) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkKeys(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      visit(key);
      walkKeys(item, visit);
    }
  }
}

/**
 * A proposal may not name the decision.
 *
 * Checked on the RAW input, before any schema: `.strict()` would reject an
 * unknown key with a schema error, and "unexpected key" is the wrong sentence
 * for a caller that tried to say it was approved.
 */
export function assertNoWorldAuthorityClaim(value: unknown): void {
  walkKeys(value, (key) => {
    if (WORLD_AUTHORITY_KEYS.has(key.toLowerCase())) {
      throw new WorldError(
        `«${key}» is the runtime's word, not the proposal's. A world definition may describe structure; it may not say whose it is, what it is allowed to do, or that somebody agreed.`,
        "FORBIDDEN",
      );
    }
  });
}

/** A definition describes. It never executes. */
export function assertNoExecutableCode(value: unknown): void {
  walkStrings(value, (text, path) => {
    for (const shape of EXECUTABLE_SHAPES) {
      if (shape.test(text)) {
        throw new WorldError(
          `«${path || "the definition"}» carries something executable. A world definition describes structure; generated code is not structure and is never run.`,
          "INVALID",
        );
      }
    }
  });
}

/**
 * Turn a proposal into a canonical `WorldDNA`, or refuse it.
 *
 * Reference validation is the part that matters: a relation pointing at an
 * entity nobody declared, a policy guarding a target that does not exist, a
 * key used twice. Each of those is a world that would materialize and then
 * mean nothing, which is exactly the false success this phase exists to
 * prevent.
 */
export function validateWorldDefinition(input: {
  proposal: unknown;
  worldKey: string;
  scopeId: string;
  generatedFrom?: string;
  base?: WorldDNA;
}): WorldDNA {
  assertNoWorldAuthorityClaim(input.proposal);
  assertNoExecutableCode(input.proposal);

  const parsed = WorldDefinitionProposalSchema.safeParse(input.proposal);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new WorldError(
      `The world definition is not well formed: ${first?.path.join(".") || "(root)"} — ${first?.message ?? "invalid"}.`,
      "INVALID",
    );
  }
  const proposal = parsed.data;

  const unique = (items: readonly { key: string }[], what: string): void => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.key)) {
        throw new WorldError(`«${item.key}» is declared twice as a ${what}.`, "INVALID");
      }
      seen.add(item.key);
    }
  };
  unique(proposal.entities, "entity");
  unique(proposal.relations, "relation");
  unique(proposal.policies, "policy");
  unique(proposal.workflows, "workflow");
  unique(proposal.participants, "participant");
  for (const entity of proposal.entities) unique(entity.fields, `field of «${entity.key}»`);

  const entityKeys = new Set(proposal.entities.map((entity) => entity.key));
  for (const relation of proposal.relations) {
    for (const side of [relation.from, relation.to]) {
      if (!entityKeys.has(side)) {
        throw new WorldError(
          `«${relation.key}» relates to «${side}», which this world does not declare.`,
          "INVALID",
        );
      }
    }
  }
  for (const policy of proposal.policies) {
    if (policy.target !== "*" && !entityKeys.has(policy.target)) {
      throw new WorldError(
        `«${policy.key}» guards «${policy.target}», which this world does not declare.`,
        "INVALID",
      );
    }
  }

  const now = new Date().toISOString();
  return WorldDNASchema.parse({
    id: input.worldKey,
    name: proposal.title,
    description: proposal.purpose ?? proposal.title,
    version: input.base?.version ?? "1.0.0",
    ownerId: input.scopeId,
    visibility: "private",
    purpose: proposal.purpose,
    // The whole reason a world exists: it survives the conversation that
    // asked for it. Never `ephemeral` here — an ephemeral world is a task.
    continuity: "evolving",
    participants: proposal.participants.map((participant) => ({
      id: participant.key,
      role: participant.capacity,
      label: participant.label,
      source: "intent" as const,
      capabilities: [],
      policies: [],
      metadata: {},
    })),
    entities: proposal.entities.map((entity) => ({
      id: entity.key,
      name: entity.key,
      label: entity.label,
      fields: entity.fields.map((field) => ({
        id: field.key,
        name: field.key,
        type: field.type,
        label: field.label,
      })),
      relations: [],
      permissions: [],
    })),
    relations: proposal.relations.map((relation) => ({
      id: relation.key,
      name: relation.label,
      fromEntity: relation.from,
      toEntity: relation.to,
      cardinality: relation.cardinality,
    })),
    // Empty, and deliberately. A binding is the right to ACT, and a definition
    // that could bind its own capabilities would be granting itself authority.
    capabilities: [],
    workflows: proposal.workflows.map((workflow) => ({
      id: workflow.key,
      name: workflow.label,
      steps: workflow.steps.map((step) => ({
        id: step.key,
        name: step.label,
        capabilityBinding: "",
      })),
      edges: [],
    })),
    policies: proposal.policies.map((policy) => ({
      id: policy.key,
      name: policy.label,
      type: "business_rule" as const,
      target: policy.target,
      condition: policy.condition,
      action: policy.effect,
    })),
    ui: [],
    theme: { direction: "rtl", density: "normal" },
    ...(input.generatedFrom ? { generatedFrom: input.generatedFrom } : {}),
    createdAt: input.base?.createdAt ?? now,
    updatedAt: now,
    lineage: input.base
      ? { parentWorldId: input.worldKey, parentVersion: input.base.version }
      : {},
  });
}

/** What a proposal looks like when read back OUT of a canonical world. */
export function proposalOf(world: WorldDNA): WorldDefinitionProposal {
  return {
    title: world.name,
    ...(world.purpose !== undefined ? { purpose: world.purpose } : {}),
    entities: world.entities.map((entity) => ({
      key: entity.id,
      label: entity.label,
      fields: entity.fields.map((field) => ({
        key: field.id,
        label: field.label,
        type: (WORLD_FIELD_TYPES as readonly string[]).includes(field.type)
          ? (field.type as WorldDefinitionProposal["entities"][number]["fields"][number]["type"])
          : "string",
      })),
    })),
    relations: world.relations.map((relation) => ({
      key: relation.id,
      label: relation.name,
      from: relation.fromEntity,
      to: relation.toEntity,
      cardinality: relation.cardinality,
    })),
    policies: world.policies.map((policy) => ({
      key: policy.id,
      label: policy.name,
      target: policy.target,
      condition: policy.condition,
      effect: policy.action,
    })),
    workflows: world.workflows.map((workflow) => ({
      key: workflow.id,
      label: workflow.name,
      steps: workflow.steps.map((step) => ({ key: step.id, label: step.name })),
    })),
    participants: world.participants.map((participant) => ({
      key: participant.id,
      label: participant.label,
      capacity: participant.role,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A ChangeSet — all of it, or none of it
// ─────────────────────────────────────────────────────────────────────────────

/** The class a change actually is, whatever it says it is. */
export function classOf(change: WorldChange): WorldMutationClass {
  return CLASS_OF_TARGET[change.target];
}

/** The strongest class in a set. A set is as consequential as its worst change. */
export function dominantClass(changes: readonly WorldChange[]): WorldMutationClass {
  let dominant: WorldMutationClass = "DATA";
  for (const change of changes) {
    const current = classOf(change);
    if (REQUIRES_AUTHORITY_ACT.has(current)) return current;
    if (current === "STRUCTURAL" || current === "WORKFLOW") dominant = current;
  }
  return dominant;
}

type Collection = "entities" | "relations" | "policies" | "workflows" | "participants";

const COLLECTION_OF_TARGET: Readonly<Record<Exclude<WorldChangeTarget, "field" | "view">, Collection>> =
  Object.freeze({
    entity: "entities",
    relation: "relations",
    policy: "policies",
    workflow: "workflows",
    participant: "participants",
  });

/**
 * Apply a whole ChangeSet to a proposal, IN MEMORY.
 *
 * Atomicity is structural rather than defended: nothing touches the database
 * until every change has landed on a copy. If change #4 of 5 is invalid, this
 * throws and the first three exist only in a value that is about to be
 * garbage. There is no partially materialized world to clean up because there
 * was never a partially written one.
 */
export function applyChangeSet(
  base: WorldDefinitionProposal,
  changes: readonly WorldChange[],
): WorldDefinitionProposal {
  if (changes.length === 0) {
    throw new WorldError("A change set with no changes changes nothing.", "INVALID");
  }
  if (changes.length > 50) {
    throw new WorldError("A change set of more than fifty changes is not one decision.", "INVALID");
  }
  const draft: WorldDefinitionProposal = structuredClone(base);

  changes.forEach((change, index) => {
    const position = `change ${index + 1} of ${changes.length}`;
    if (change.class && change.class !== classOf(change)) {
      throw new WorldError(
        `${position} calls itself ${change.class}, but changing a ${change.target} is a ${classOf(change)} change. The runtime decides which it is.`,
        "FORBIDDEN",
      );
    }
    if (change.value) {
      assertNoWorldAuthorityClaim(change.value);
      assertNoExecutableCode(change.value);
    }

    if (change.target === "view") {
      // A view is presentation. It is a recognised class so a caller can say
      // what it meant, and it carries no canonical structure of its own.
      throw new WorldError(
        `${position} changes a view. A world's surface comes from its canonical state, so there is nothing here to store — UI != WORLD.`,
        "UNSUPPORTED",
      );
    }

    if (change.target === "field") {
      const entityKey = change.parentKey;
      if (!entityKey) {
        throw new WorldError(`${position} changes a field without saying of which entity.`, "INVALID");
      }
      const entity = draft.entities.find((item) => item.key === entityKey);
      if (!entity) {
        throw new WorldError(`${position} changes a field of «${entityKey}», which this world does not have.`, "NOT_FOUND");
      }
      const existing = entity.fields.findIndex((item) => item.key === change.key);
      if (change.operation === "remove") {
        if (existing < 0) throw new WorldError(`${position} removes «${change.key}», which is not there.`, "NOT_FOUND");
        entity.fields.splice(existing, 1);
        return;
      }
      const field = WorldFieldProposalSchema.parse({ key: change.key, ...(change.value ?? {}) });
      if (change.operation === "add") {
        if (existing >= 0) throw new WorldError(`${position} adds «${change.key}», which «${entityKey}» already has.`, "CONFLICT");
        entity.fields.push(field);
        return;
      }
      if (existing < 0) throw new WorldError(`${position} replaces «${change.key}», which is not there.`, "NOT_FOUND");
      entity.fields[existing] = field;
      return;
    }

    const collection = COLLECTION_OF_TARGET[change.target];
    const list = draft[collection] as { key: string }[];
    const existing = list.findIndex((item) => item.key === change.key);

    if (change.operation === "remove") {
      if (existing < 0) throw new WorldError(`${position} removes «${change.key}», which is not there.`, "NOT_FOUND");
      list.splice(existing, 1);
      return;
    }

    const schema = {
      entity: WorldEntityProposalSchema,
      relation: WorldRelationProposalSchema,
      policy: WorldPolicyProposalSchema,
      workflow: WorldWorkflowProposalSchema,
      participant: WorldParticipantProposalSchema,
    }[change.target];
    const parsed = schema.safeParse({ key: change.key, ...(change.value ?? {}) });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new WorldError(
        `${position} is not a well-formed ${change.target}: ${first?.path.join(".") || "(root)"} — ${first?.message ?? "invalid"}.`,
        "INVALID",
      );
    }
    if (change.operation === "add") {
      if (existing >= 0) throw new WorldError(`${position} adds «${change.key}», which is already there.`, "CONFLICT");
      list.push(parsed.data as { key: string });
      return;
    }
    if (existing < 0) throw new WorldError(`${position} replaces «${change.key}», which is not there.`, "NOT_FOUND");
    list[existing] = parsed.data as { key: string };
  });

  return draft;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scope, authority and policy — before anything is written
// ─────────────────────────────────────────────────────────────────────────────

export type WorldAuthorization = {
  readonly mutationClass: WorldMutationClass;
  readonly permission: ScopePermission;
  readonly policy: PolicyDecision;
  readonly requiresAuthorityAct: boolean;
};

/**
 * May this scope do this, and does a person have to read a statement first?
 *
 * Three separate questions in the order they have to be asked, and none of
 * them answerable by the caller:
 *
 *   PERMISSION  does the acting scope hold the verb?  (memberships)
 *   POLICY      does a rule of this scope forbid it?  (scope policies)
 *   AUTHORITY   must a person read and cite a statement? (the act registry)
 */
export async function authorizeWorldMutation(input: {
  scope: ActingScope;
  mutationClass: WorldMutationClass;
  action: string;
  parameters?: Record<string, unknown>;
}): Promise<WorldAuthorization> {
  const permission = PERMISSION_OF_CLASS[input.mutationClass];
  const allowed = await authorizeScopeAction({
    principalId: input.scope.principalId,
    scopeId: input.scope.scopeId,
    permission,
  });
  if (!allowed.ok) {
    throw new WorldError(
      `This scope may not make that change: ${allowed.reason}.`,
      "FORBIDDEN",
    );
  }
  const policy = await evaluatePolicies({
    scopeId: input.scope.scopeId,
    action: input.action,
    parameters: {
      ...(input.parameters ?? {}),
      mutationClass: input.mutationClass,
    },
  });
  if (policy.outcome === "DENIED") {
    throw new WorldError(
      `A rule of this scope forbids that change (${policy.reasons[0]?.policyKey ?? "policy"}).`,
      "FORBIDDEN",
    );
  }
  if (policy.outcome === "UNSUPPORTED_POLICY") {
    //   UNKNOWN POLICY SEMANTICS != ALLOW
    throw new WorldError(
      "A rule of this scope claims to govern this and cannot be read. Nothing proceeds past a rule nobody can evaluate.",
      "FORBIDDEN",
    );
  }
  return {
    mutationClass: input.mutationClass,
    permission,
    policy,
    // Policy may DEMAND a ceremony a class would not have needed. It can never
    // remove one a class does need.
    requiresAuthorityAct:
      REQUIRES_AUTHORITY_ACT.has(input.mutationClass) || policy.outcome === "REQUIRES_APPROVAL",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Materialization and mutation
// ─────────────────────────────────────────────────────────────────────────────

let service: GeneratedWorldService | undefined;
function worlds(): GeneratedWorldService {
  service ??= new GeneratedWorldService(new DrizzleGeneratedWorldRepository());
  return service;
}

export type WorldRecord = {
  readonly worldId: string;
  readonly scopeId: string;
  readonly title: string;
  readonly status: string;
  readonly version: string;
  readonly definition: WorldDefinitionProposal;
  readonly entityCount: number;
  readonly policyCount: number;
  readonly workflowCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/**
 * A world's id, derived rather than invented.
 *
 * Deterministic in (scope, requestKey), which is what makes a retried
 * materialization find the world it already made instead of making a second
 * one. The unique index on (scopeId, worldKey) is the part that cannot be
 * argued with.
 */
export function worldKeyFor(scopeId: string, requestKey: string): string {
  return `wld_${createHash("sha256").update(`${scopeId}\u0000${requestKey}`).digest("hex").slice(0, 32)}`;
}

function recordOf(system: GeneratedWorldSystem): WorldRecord {
  const world = system.activeWorld;
  return {
    worldId: system.worldKey,
    scopeId: system.scopeId,
    title: system.name,
    status: system.status,
    version: system.version,
    definition: proposalOf(world),
    entityCount: world.entities.length,
    policyCount: world.policies.length,
    workflowCount: world.workflows.length,
    createdAt: system.createdAt,
    updatedAt: system.updatedAt,
  };
}

async function emit(input: {
  type: "WORLD_MATERIALIZED" | "WORLD_VERSION_CREATED" | "WORLD_STATUS_CHANGED";
  scopeId: string;
  worldId: string;
  version: string;
  message: string;
  extra?: Record<string, string | number | boolean>;
}): Promise<void> {
  await db.insert(events).values({
    type: input.type,
    source: "runtime",
    // Scope-aware, ordered by the serial id, and resumable from it. That is
    // what a later realtime transport will subscribe to — and this phase
    // builds the ledger, not the transport.
    ownerId: input.scopeId,
    correlationId: input.worldId,
    message: input.message,
    payload: {
      worldId: input.worldId,
      version: input.version,
      ...(input.extra ?? {}),
    },
  });
}

/**
 * A conversation asked for a durable system, and gets one or gets nothing.
 *
 *   ROUTED != MATERIALIZED
 *
 * Idempotent in `requestKey`: the same request retried returns the same world
 * at the same version, and `created` says which of the two happened.
 */
export async function materializeWorld(input: {
  proposal: unknown;
  scope: ActingScope;
  requestKey: string;
  conversationId?: number;
  statedAs?: string;
}): Promise<{ record: WorldRecord; created: boolean; authorization: WorldAuthorization }> {
  if (!input.requestKey?.trim()) {
    throw new WorldError("A materialization needs a stable request key.", "INVALID");
  }
  const worldKey = worldKeyFor(input.scope.scopeId, input.requestKey);

  // Validation BEFORE authorization is deliberate: refusing a malformed
  // definition needs no permission, and telling somebody they lack permission
  // for something that was never valid is a worse answer.
  const definition = validateWorldDefinition({
    proposal: input.proposal,
    worldKey,
    scopeId: input.scope.scopeId,
    ...(input.statedAs ? { generatedFrom: input.statedAs } : {}),
  });

  const authorization = await authorizeWorldMutation({
    scope: input.scope,
    // Creating a durable system is structural by definition.
    mutationClass: "STRUCTURAL",
    action: "world.materialize",
    parameters: { title: definition.name, entities: definition.entities.length },
  });

  const repository = new DrizzleGeneratedWorldRepository();
  // Idempotency, read first. The unique index on (scopeId, worldKey) is what
  // makes it true under a race; this is what makes it a calm answer instead of
  // a constraint violation.
  const existing = await repository.findScopedSystem(input.scope.scopeId, worldKey);
  if (existing) {
    return { record: recordOf(existing), created: false, authorization };
  }

  const principalId = Number(input.scope.principalId);
  if (!Number.isInteger(principalId) || principalId <= 0) {
    throw new WorldError("A world is created by a principal the runtime knows.", "INVALID");
  }
  const result = await worlds().persistApproved({
    world: definition,
    ownerId: principalId,
    scopeId: input.scope.scopeId,
    requestKey: `materialize:${input.requestKey}`,
    changeRequest: input.statedAs ?? "materialize",
    ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
  });

  const stored = await repository.findScopedSystem(input.scope.scopeId, worldKey);
  //   MATERIALIZED != CONFIGURED, and "the insert returned" != materialized.
  // The world is read BACK before anybody is told it exists.
  if (!stored || stored.version !== result.version) {
    throw new WorldError(
      "The world did not come back from storage at the version that was just written. Nothing is reported as created.",
      "STATE",
    );
  }
  await emit({
    type: "WORLD_MATERIALIZED",
    scopeId: input.scope.scopeId,
    worldId: worldKey,
    version: stored.version,
    message: `A durable world was materialized: ${stored.name}.`,
    extra: { entities: definition.entities.length, policies: definition.policies.length },
  });
  return { record: recordOf(stored), created: true, authorization };
}

/**
 * Change a world that already exists.
 *
 *   World v1 -> ChangeSet -> World v2 -> ChangeSet -> World v3
 *
 * `expectedVersion` is a PRECONDITION and is required. A caller that read v7
 * while somebody else wrote v8 is told to rebase; it does not win by arriving
 * second. A conflict is a state, not an error to swallow:
 *
 *   NO LAST-WRITE-WINS FOR AUTHORITY-BEARING STRUCTURAL STATE
 */
export async function applyWorldChangeSet(input: {
  worldId: string;
  scope: ActingScope;
  changes: readonly WorldChange[];
  expectedVersion: string;
  requestKey: string;
  conversationId?: number;
  statedAs?: string;
  /** Proof a person read a statement, when the class demands one. */
  authorityGranted?: boolean;
}): Promise<{
  record: WorldRecord;
  unchanged: boolean;
  mutationClass: WorldMutationClass;
  changeCount: number;
}> {
  if (!input.requestKey?.trim()) {
    throw new WorldError("A change set needs a stable request key.", "INVALID");
  }
  const repository = new DrizzleGeneratedWorldRepository();
  const system = await repository.findScopedSystem(input.scope.scopeId, input.worldId);
  // Not found and not permitted are the SAME answer across scopes. Telling a
  // stranger that a world exists is already telling them something.
  if (!system) throw new WorldError("No such world in this scope.", "NOT_FOUND");
  if (system.status === "archived") {
    throw new WorldError("An archived world must be restored before it can change.", "STATE");
  }

  const parsedChanges = z.array(WorldChangeSchema).min(1).max(50).safeParse(input.changes);
  if (!parsedChanges.success) {
    const first = parsedChanges.error.issues[0];
    throw new WorldError(
      `The change set is not well formed: ${first?.path.join(".") || "(root)"} — ${first?.message ?? "invalid"}.`,
      "INVALID",
    );
  }
  const changes = parsedChanges.data;
  const mutationClass = dominantClass(changes);

  const authorization = await authorizeWorldMutation({
    scope: input.scope,
    mutationClass,
    action: `world.${mutationClass.toLowerCase()}`,
    parameters: { worldId: input.worldId, changes: changes.length },
  });
  if (authorization.requiresAuthorityAct && input.authorityGranted !== true) {
    throw new WorldError(
      `A ${mutationClass} change decides what everyone else in this scope may do. It is performed as an authority act — a statement read and cited — not by asking in a conversation.`,
      "NEEDS_AUTHORITY",
    );
  }

  // Replay safety, decided by IDENTITY and before anything is recomputed.
  //
  // A change set is written against the world the caller read. Replayed after
  // it landed, re-applying it would fail — «adds x, which is already there» —
  // and that is the wrong answer to "did this already happen". The stable
  // request key answers it; the digest below catches the same change arriving
  // under a different key.
  const replayed = await worlds().hasRequestKey(
    system.ownerId,
    input.worldId,
    `changeset:${input.requestKey}`,
  );
  if (replayed) {
    return {
      record: recordOf(system),
      unchanged: true,
      mutationClass,
      changeCount: changes.length,
    };
  }

  // Every change lands on a copy first. Nothing below runs unless all of them
  // did, which is why there is no partially materialized world to undo.
  const next = applyChangeSet(proposalOf(system.activeWorld), changes);
  const definition = validateWorldDefinition({
    proposal: next,
    worldKey: input.worldId,
    scopeId: input.scope.scopeId,
    base: system.activeWorld,
    ...(input.statedAs ? { generatedFrom: input.statedAs } : {}),
  });

  let result;
  try {
    result = await worlds().persistApproved({
      world: definition,
      ownerId: system.ownerId,
      scopeId: input.scope.scopeId,
      expectedVersion: input.expectedVersion,
      requestKey: `changeset:${input.requestKey}`,
      changeRequest: input.statedAs ?? `${mutationClass} change set`,
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
    });
  } catch (error) {
    if (error instanceof WorldVersionConflictError) {
      throw new WorldError(error.message, "CONFLICT", error.currentVersion);
    }
    throw error;
  }

  const stored = await repository.findScopedSystem(input.scope.scopeId, input.worldId);
  if (!stored || stored.version !== result.version) {
    throw new WorldError(
      "The world did not come back from storage at the version that was just written.",
      "STATE",
    );
  }
  if (!result.unchanged) {
    await emit({
      type: "WORLD_VERSION_CREATED",
      scopeId: input.scope.scopeId,
      worldId: input.worldId,
      version: stored.version,
      message: `A ${mutationClass} change set moved the world to ${stored.version}.`,
      extra: { mutationClass, changes: changes.length, from: input.expectedVersion },
    });
  }
  return {
    record: recordOf(stored),
    unchanged: result.unchanged,
    mutationClass,
    changeCount: changes.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading it back — which is the only thing that proves it persisted
// ─────────────────────────────────────────────────────────────────────────────

export async function readWorld(input: {
  worldId: string;
  scope: ActingScope;
}): Promise<WorldRecord | undefined> {
  const system = await new DrizzleGeneratedWorldRepository().findScopedSystem(
    input.scope.scopeId,
    input.worldId,
  );
  return system ? recordOf(system) : undefined;
}

export async function listWorlds(scope: ActingScope): Promise<readonly WorldRecord[]> {
  const systems = await new DrizzleGeneratedWorldRepository().listScopedSystems(scope.scopeId);
  return systems.map(recordOf);
}

export type WorldVersionSummary = {
  readonly version: string;
  readonly status: string;
  readonly parentVersion?: string;
  readonly changeRequest?: string;
  readonly createdAt: string;
};

/**
 * History, and the whole point of keeping it: an old version stays
 * INSPECTABLE. Nothing here erases anything to simulate a rollback.
 */
export async function worldHistory(input: {
  worldId: string;
  scope: ActingScope;
}): Promise<readonly WorldVersionSummary[]> {
  const repository = new DrizzleGeneratedWorldRepository();
  const system = await repository.findScopedSystem(input.scope.scopeId, input.worldId);
  if (!system) throw new WorldError("No such world in this scope.", "NOT_FOUND");
  const versions: GeneratedWorldVersion[] = await repository.listVersions(system);
  return versions.map((version) => ({
    version: version.version,
    status: version.status,
    ...(version.parentVersion ? { parentVersion: version.parentVersion } : {}),
    ...(version.changeRequest ? { changeRequest: version.changeRequest } : {}),
    createdAt: version.createdAt,
  }));
}

/** One superseded version, still readable. */
export async function readWorldVersion(input: {
  worldId: string;
  scope: ActingScope;
  version: string;
}): Promise<WorldDefinitionProposal | undefined> {
  const repository = new DrizzleGeneratedWorldRepository();
  const system = await repository.findScopedSystem(input.scope.scopeId, input.worldId);
  if (!system) throw new WorldError("No such world in this scope.", "NOT_FOUND");
  const found = (await repository.listVersions(system)).find(
    (version) => version.version === input.version,
  );
  return found ? proposalOf(found.world) : undefined;
}

/**
 * Durable world events, oldest first, resumable from a cursor.
 *
 * This is the whole of the realtime preparation §19 asks for and none of the
 * transport it forbids. A later subscriber reads from `after` and misses
 * nothing; today the surface polls and never claims «مباشر».
 */
export async function worldEventsSince(input: {
  scope: ActingScope;
  worldId: string;
  after?: number;
  limit?: number;
}): Promise<readonly { cursor: number; type: string; version: string; message: string }[]> {
  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.ownerId, input.scope.scopeId), eq(events.correlationId, input.worldId)))
    .orderBy(events.id)
    .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));
  return rows
    .filter((row) => (input.after === undefined ? true : row.id > input.after))
    .map((row) => ({
      cursor: row.id,
      type: row.type,
      version: String((row.payload as Record<string, unknown>).version ?? ""),
      message: row.message ?? "",
    }));
}

/**
 * The canonical projection — what a surface is allowed to show.
 *
 *   UI != WORLD
 *   UI != CANONICAL STATE
 *
 * Counts and names, read from stored state. No provider is implied by a world
 * naming one, and nothing here is a dashboard: both surfaces render this
 * through the generic primitive they already have.
 */
export function projectWorld(record: WorldRecord): Record<string, unknown> {
  return {
    worldId: record.worldId,
    title: record.title,
    status: record.status,
    version: record.version,
    entities: record.definition.entities.map((entity) => ({
      key: entity.key,
      label: entity.label,
      fields: entity.fields.length,
    })),
    policies: record.definition.policies.map((policy) => ({
      key: policy.key,
      label: policy.label,
      effect: policy.effect,
    })),
    workflows: record.definition.workflows.map((workflow) => ({
      key: workflow.key,
      label: workflow.label,
      steps: workflow.steps.length,
    })),
    counts: {
      entities: record.entityCount,
      policies: record.policyCount,
      workflows: record.workflowCount,
    },
    //   CONFIGURED != EXTERNALLY_CONNECTED
    // A world that mentions a provider has not connected one, and nothing in
    // this projection may suggest otherwise.
    providerBindings: 0,
    externallyConnected: false,
    updatedAt: record.updatedAt,
  };
}

/**
 * Which world this conversation is already talking about.
 *
 *   «أنشئ لي نظاماً دائماً» … «أضف له المورد الذي اخترناه»
 *
 * «له» resolves through the canonical attachment the world service writes on
 * every commit — `conversations.context.activeWorldId` — and never through an
 * ordinal position on a screen. A reference a surface invented would stop
 * meaning anything the moment the surface re-ordered.
 */
export async function conversationWorldRef(input: {
  ownerId: string;
  conversationId: string;
}): Promise<string | undefined> {
  const ownerId = Number(input.ownerId);
  const conversationId = Number(input.conversationId);
  if (!Number.isInteger(ownerId) || !Number.isInteger(conversationId)) return undefined;
  const [row] = await db
    .select({ context: conversations.context })
    .from(conversations)
    .where(and(eq(conversations.id, conversationId), eq(conversations.userId, ownerId)))
    .limit(1);
  const context = row?.context as Record<string, unknown> | null | undefined;
  return typeof context?.activeWorldId === "string" ? context.activeWorldId : undefined;
}
