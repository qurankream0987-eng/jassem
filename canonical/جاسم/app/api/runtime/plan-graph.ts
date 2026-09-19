/**
 * JASIM — PlanGraph. HOW a goal becomes work, and nothing about doing it.
 *
 * ─── THE GAP, PROVEN ON THE ACTIVE PATH BEFORE THIS EXISTED ─────────────────
 *
 * A conversational turn reaches `createExecutionProposalsForIntent`, which does
 * exactly this:
 *
 *     const capabilities = [...new Set(intent.requiredCapabilities)];
 *     capabilities.map((capability) => createExecutionProposal({ ... }))
 *
 * One proposal per capability label, every one receiving the SAME
 * `intent.inputs`, and `dependencies` never supplied — `input.dependencies ?? []`
 * is always `[]`. So every plan the product builds from a conversation is a
 * flat, dependency-free set of independent steps.
 *
 * There was exactly one exception on the turn path: `createResearchImageComposition`,
 * reached only when `isResearchImageCompositionIntent` matches. It hand-writes
 * three nodes with real `dependencies` and real `__runtimeBindings`. It is a
 * special case, not a planner — it can only ever build that one shape.
 *
 * And `composeRequirementGraph` in `semantic-fabric.ts` does topological
 * ordering and capability matching, is exposed as `fabric.composeGoal`, and is
 * never called from the turn path.
 *
 * So: JASIM executes dependency graphs beautifully and could not produce one.
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 *   GOAL = WHAT SHOULD HAPPEN   (goal-spec.ts)
 *   PLAN = HOW IT SHOULD HAPPEN (here)
 *   RUN  = IT HAPPENING         (the existing durable DAG — untouched)
 *
 * This is the missing SEMANTIC layer between them. It is not an executor. It
 * owns no ordering algorithm, no lease, no retry, no attempt ledger, no
 * verification and no compensation — every one of those already exists and is
 * reused. `materializePlanGraph` hands plain `RuntimeDagNodeInput`s to
 * `createRuntimeDag`, which does what it has always done.
 *
 * ─── AND WHAT IT REFUSES TO BE ──────────────────────────────────────────────
 *
 * There is no node type here named after anything in the world. No
 * CarPurchaseNode, no JobApplicationNode, no CommercePlanNode. A node names a
 * capability and its dependencies; selling a lathe, hiring a translator and
 * booking a hall are the same three shapes with different ids in them.
 *
 * Examples populate a graph. They may never define its schema.
 */

import { z } from "zod";
import {
  GOAL_DIMENSIONS,
  type GoalConstraint,
  type GoalEvaluation,
} from "./goal-spec";
import { getTrustedCapability, capabilityEffectContract } from "./capability-registry";
import { sanitizeModelStructuredOutput } from "./model-output-trust";

// ── Plan kind: not every goal is a DAG ───────────────────────────────────────

/**
 * How a goal becomes work at all.
 *
 * Six kinds, and each exists because it routes to a materially different place.
 * None of them is a domain: «سجلني دخول» and «سجلني خروج» are both
 * IDENTITY_CHANGE, «أرني جدول مبيعاتي» and «شغل لي الخريطة» are both
 * DIRECT_READ, and none of those is an Agent, a module or a tab.
 *
 *   DAG               steps with dependencies, run by the durable DAG.
 *   MONITORING        a standing condition that acts only if it becomes true.
 *                     Forcing this into a one-shot DAG answers a different
 *                     question — «راقب السعر» is not «ما السعر».
 *   PERSISTENT_WORLD  materialises a durable system. Not every request earns
 *                     one; creating a World per turn is how a runtime fills up
 *                     with worlds nobody asked for.
 *   DIRECT_READ       answerable from what the runtime can already read. No
 *                     run, no proposal, no effect — «كم سعر هذا؟» should not
 *                     manufacture an execution graph.
 *   IDENTITY_CHANGE   changes WHO the runtime operates as. This is not a DAG
 *                     effect and must never become one: every other
 *                     authorization check in the system is evaluated against
 *                     the identity, so a step that changes it cannot be a step
 *                     whose result is a receipt.
 *   SETTING_MUTATION  changes a stored preference on the owner's own account.
 *                     A trusted product action, not a plan.
 */
export const PLAN_KINDS = [
  "DAG",
  "MONITORING",
  "PERSISTENT_WORLD",
  "DIRECT_READ",
  "IDENTITY_CHANGE",
  "SETTING_MUTATION",
] as const;
export type PlanKind = (typeof PLAN_KINDS)[number];

/** The kinds that become nodes in the execution DAG. Everything else routes away. */
const DAG_KINDS: ReadonlySet<PlanKind> = new Set<PlanKind>(["DAG", "PERSISTENT_WORLD"]);

// ── Authority ────────────────────────────────────────────────────────────────

/**
 * What a step needs beyond the goal having been stated.
 *
 * Authorizing «رتب لي الخيارات» does not authorize «ادفع». The planner MARKS a
 * requirement; the trusted runtime decides and enforces it. Ordered weakest
 * first — the order is load-bearing, see `strongerAuthority`.
 */
export const PLAN_AUTHORITIES = [
  "NONE",
  "OWNER_APPROVAL",
  "BUDGET_AUTHORITY",
  "REAUTHENTICATION",
] as const;
export type PlanAuthority = (typeof PLAN_AUTHORITIES)[number];

/**
 * The stronger of two requirements.
 *
 * A plan may only ever RAISE what the capability registry already demands.
 * A model that marks a payment step `NONE` must not thereby make it need less
 * than it needs — this is the same downgrade-only rule as
 * `applyCompletionDecision`, pointed the other way.
 */
function strongerAuthority(left: PlanAuthority, right: PlanAuthority): PlanAuthority {
  return PLAN_AUTHORITIES.indexOf(left) >= PLAN_AUTHORITIES.indexOf(right) ? left : right;
}

// ── The contract ─────────────────────────────────────────────────────────────

/**
 * One value flowing from a finished step into a later one.
 *
 * The model names a PLAN key and a path. It never names a run id or a node id,
 * because those are identities the runtime assigns — a model that could supply
 * one could point a binding at another owner's run. `.strict()` is what
 * enforces that: `sourceNodeId` and `sourceRunId` are not fields here, so a
 * proposal carrying them is rejected rather than trimmed.
 */
export const PlanBindingSchema = z
  .object({
    /** A key in this plan's own nodes, which must also be a dependency. */
    fromNode: z.string().trim().min(1).max(80),
    /** Where in the upstream result the value is. */
    valuePath: z.string().trim().min(1).max(200),
    /** Which input key on this node receives it. */
    targetKey: z.string().trim().min(1).max(80),
  })
  .strict();

export type PlanBinding = z.infer<typeof PlanBindingSchema>;

export const PlanNodeSchema = z
  .object({
    key: z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),
    /**
     * WHAT is required, never WHO provides it. Provider resolution happens
     * later and elsewhere; see `CAPABILITY != PROVIDER` in the header of
     * `capability-provider.ts`.
     */
    capabilityId: z.string().trim().min(1).max(120),
    inputs: z.record(z.string(), z.unknown()).default({}),
    dependsOn: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
    bindings: z.array(PlanBindingSchema).max(12).default([]),
    /**
     * Indices into the goal's `constraints` that THIS step is responsible for.
     *
     * Not every constraint belongs on every node — forcing a deadline onto a
     * read-only lookup is noise that makes the real owner harder to find. What
     * matters is that every HARD constraint has SOME owner, which
     * `validatePlanGraph` checks.
     */
    enforces: z.array(z.number().int().min(0).max(19)).max(20).default([]),
    /** What this step needs beyond the goal. The runtime may raise it, never lower it. */
    authority: z.enum(PLAN_AUTHORITIES).default("NONE"),
  })
  .strict();

export type PlanNode = z.infer<typeof PlanNodeSchema>;

export const PlanGraphSchema = z
  .object({
    version: z.literal(1),
    kind: z.enum(PLAN_KINDS),
    /** Empty for the kinds that are not DAGs. */
    nodes: z.array(PlanNodeSchema).max(20).default([]),
    /**
     * What the planner could not resolve. A blocker is honest; a plan that
     * quietly omits the part it could not work out is not.
     */
    blockers: z.array(z.string().trim().min(1).max(400)).max(10).default([]),
  })
  .strict();

export type PlanGraph = z.infer<typeof PlanGraphSchema>;

// ── Authority keys a plan may never carry ────────────────────────────────────

/**
 * Mirrored into the shared `AUTHORITY_KEYS`, and tested against it.
 *
 * A plan says how work would proceed. It may not declare that the work was
 * approved, that a provider is trusted, or that an effect occurred.
 */
export const PLAN_AUTHORITY_KEYS: ReadonlySet<string> = new Set([
  "planapproved",
  "plantrusted",
  "providertrusted",
  "trustedprovider",
  "skipapproval",
  "approvalnotrequired",
  "authorityoverride",
  "executed",
  "executionverified",
]);

// ── Validation ───────────────────────────────────────────────────────────────

export type PlanViolation = {
  readonly code:
    | "UNKNOWN_CAPABILITY"
    | "UNKNOWN_DEPENDENCY"
    | "SELF_DEPENDENCY"
    | "DUPLICATE_NODE_KEY"
    | "CYCLE"
    | "BINDING_WITHOUT_DEPENDENCY"
    | "BINDING_TARGET_COLLISION"
    | "UNKNOWN_CONSTRAINT_INDEX"
    | "NODES_ON_NON_DAG_PLAN"
    | "EMPTY_DAG_PLAN";
  readonly detail: string;
  readonly nodeKey?: string;
};

/** Where a HARD requirement ended up. Never "nowhere". */
export type ConstraintDisposition = {
  readonly constraintIndex: number;
  readonly dimension: (typeof GOAL_DIMENSIONS)[number];
  readonly hardness: GoalConstraint["hardness"];
  readonly status: "ENFORCED" | "UNSATISFIABLE" | "NEEDS_INPUT" | "BLOCKED";
  readonly nodeKeys: readonly string[];
  readonly detail: string;
};

export type PlanReadiness =
  /** Structurally sound, every hard requirement owned. Execution may proceed. */
  | "EXECUTABLE"
  /** The goal has open questions. Ask before planning further. */
  | "NEEDS_INPUT"
  /** The goal itself cannot be satisfied. No plan can fix that. */
  | "UNSATISFIABLE"
  /** A hard requirement has no owner, or the plan is structurally broken. */
  | "BLOCKED";

export type PlanValidation = {
  readonly readiness: PlanReadiness;
  readonly violations: readonly PlanViolation[];
  readonly dispositions: readonly ConstraintDisposition[];
  /** Per node, after the registry's floor has been applied. */
  readonly authority: ReadonlyMap<string, PlanAuthority>;
  /** Execution order the DAG will honour. Empty when the plan is not a DAG. */
  readonly order: readonly string[];
};

/** The authority a capability demands regardless of what a plan says. */
function registryAuthorityFloor(capabilityId: string): PlanAuthority {
  const capability = getTrustedCapability(capabilityId);
  if (!capability) return "NONE";
  // An external side effect always needs the owner. `high`/`critical` risk
  // needs it too, whatever the capability's side-effect class claims.
  if (capability.sideEffects === "external") return "OWNER_APPROVAL";
  if (capability.risk === "high" || capability.risk === "critical") return "OWNER_APPROVAL";
  return "NONE";
}

/** Reverse-post-order over dependencies. Returns `null` when a cycle exists. */
function topologicalOrder(nodes: readonly PlanNode[]): string[] | null {
  const dependencies = new Map(nodes.map((node) => [node.key, node.dependsOn]));
  const order: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  let cyclic = false;

  const visit = (key: string): void => {
    if (cyclic || done.has(key)) return;
    if (visiting.has(key)) {
      cyclic = true;
      return;
    }
    visiting.add(key);
    for (const dependency of dependencies.get(key) ?? []) {
      if (dependencies.has(dependency)) visit(dependency);
    }
    visiting.delete(key);
    done.add(key);
    order.push(key);
  };

  for (const node of nodes) visit(node.key);
  return cyclic ? null : order;
}

/**
 * Check a proposed plan against the goal it claims to serve.
 *
 * Pure: no database, no provider, no clock, no model. A plan validates the same
 * way on a machine with every provider configured and on one with none — which
 * is the property §10 of the phase brief depends on.
 */
export function validatePlanGraph(input: {
  plan: PlanGraph;
  goal: GoalEvaluation;
}): PlanValidation {
  const { plan, goal } = input;
  const violations: PlanViolation[] = [];
  const keys = new Set<string>();

  for (const node of plan.nodes) {
    if (keys.has(node.key)) {
      violations.push({ code: "DUPLICATE_NODE_KEY", detail: `Two nodes share the key «${node.key}».`, nodeKey: node.key });
    }
    keys.add(node.key);
  }

  if (!DAG_KINDS.has(plan.kind) && plan.nodes.length > 0) {
    violations.push({
      code: "NODES_ON_NON_DAG_PLAN",
      // A goal routed away from the DAG must not also carry DAG steps: one of
      // the two is wrong, and guessing which would pick a side silently.
      detail: `A ${plan.kind} plan does not execute as a DAG, so it may not carry nodes.`,
    });
  }
  if (plan.kind === "DAG" && plan.nodes.length === 0 && plan.blockers.length === 0) {
    violations.push({
      code: "EMPTY_DAG_PLAN",
      detail: "A DAG plan with no nodes and no blockers explains nothing.",
    });
  }

  for (const node of plan.nodes) {
    if (!getTrustedCapability(node.capabilityId)) {
      violations.push({
        code: "UNKNOWN_CAPABILITY",
        detail: `«${node.capabilityId}» is not a trusted capability.`,
        nodeKey: node.key,
      });
    }
    for (const dependency of node.dependsOn) {
      if (dependency === node.key) {
        violations.push({ code: "SELF_DEPENDENCY", detail: `«${node.key}» depends on itself.`, nodeKey: node.key });
      } else if (!keys.has(dependency)) {
        violations.push({
          code: "UNKNOWN_DEPENDENCY",
          detail: `«${node.key}» depends on «${dependency}», which is not in this plan.`,
          nodeKey: node.key,
        });
      }
    }
    const dependsOn = new Set(node.dependsOn);
    const targets = new Set<string>();
    for (const binding of node.bindings) {
      if (!dependsOn.has(binding.fromNode)) {
        violations.push({
          code: "BINDING_WITHOUT_DEPENDENCY",
          // Reading a value from a step that is not a dependency is reading it
          // before it has run. The ordering is the guarantee; a binding that
          // sidesteps it is a race written down.
          detail: `«${node.key}» binds from «${binding.fromNode}», which it does not depend on.`,
          nodeKey: node.key,
        });
      }
      if (targets.has(binding.targetKey)) {
        violations.push({
          code: "BINDING_TARGET_COLLISION",
          detail: `Two bindings on «${node.key}» both write «${binding.targetKey}».`,
          nodeKey: node.key,
        });
      }
      targets.add(binding.targetKey);
    }
    for (const index of node.enforces) {
      if (index >= goal.goal.constraints.length) {
        violations.push({
          code: "UNKNOWN_CONSTRAINT_INDEX",
          detail: `«${node.key}» claims to enforce constraint ${index}, which the goal does not have.`,
          nodeKey: node.key,
        });
      }
    }
  }

  const order = topologicalOrder(plan.nodes);
  if (order === null) {
    violations.push({ code: "CYCLE", detail: "The plan's dependencies contain a cycle." });
  }

  // ── Every hard requirement gets an outcome ────────────────────────────────
  const dispositions: ConstraintDisposition[] = goal.goal.constraints.map(
    (constraint, index): ConstraintDisposition => {
      const owners = plan.nodes
        .filter((node) => node.enforces.includes(index))
        .map((node) => node.key);

      if (goal.readiness === "UNSATISFIABLE" && constraint.hardness === "HARD") {
        return {
          constraintIndex: index,
          dimension: constraint.dimension,
          hardness: constraint.hardness,
          status: "UNSATISFIABLE",
          nodeKeys: owners,
          detail: "The goal's own hard bounds collide; no plan can satisfy this one.",
        };
      }
      if (goal.readiness === "NEEDS_INPUT") {
        return {
          constraintIndex: index,
          dimension: constraint.dimension,
          hardness: constraint.hardness,
          status: "NEEDS_INPUT",
          nodeKeys: owners,
          detail: "The goal has an open question; this requirement waits on the answer.",
        };
      }
      if (owners.length > 0) {
        return {
          constraintIndex: index,
          dimension: constraint.dimension,
          hardness: constraint.hardness,
          status: "ENFORCED",
          nodeKeys: owners,
          detail: `Owned by ${owners.join(", ")}.`,
        };
      }
      return {
        constraintIndex: index,
        dimension: constraint.dimension,
        hardness: constraint.hardness,
        // A soft preference with no owner is a preference nobody ranked by —
        // disappointing, not wrong. A HARD one with no owner is a wall the plan
        // cannot see, which is exactly the silent omission this phase forbids.
        status: "BLOCKED",
        nodeKeys: [],
        detail:
          constraint.hardness === "HARD"
            ? `No step in this plan enforces the hard ${constraint.dimension} requirement.`
            : `No step ranks by the ${constraint.dimension} preference.`,
      };
    },
  );

  const authority = new Map<string, PlanAuthority>(
    plan.nodes.map((node) => [
      node.key,
      strongerAuthority(node.authority, registryAuthorityFloor(node.capabilityId)),
    ]),
  );

  const hardBlocked = dispositions.some(
    (disposition) => disposition.hardness === "HARD" && disposition.status === "BLOCKED",
  );

  const readiness: PlanReadiness =
    goal.readiness === "UNSATISFIABLE"
      ? "UNSATISFIABLE"
      : violations.length > 0 || hardBlocked || plan.blockers.length > 0
        ? "BLOCKED"
        : goal.readiness === "NEEDS_INPUT"
          ? "NEEDS_INPUT"
          : "EXECUTABLE";

  return { readiness, violations, dispositions, authority, order: order ?? [] };
}

/**
 * Parse a model's proposed plan, refusing authority and unexpected shape.
 *
 * A model is an untrusted planner. It may say what it thinks should happen and
 * in what order; it may not say that any of it is approved, trusted, executed
 * or verified, and it may not name a runtime-assigned identity.
 */
export function parseProposedPlanGraph(value: unknown): PlanGraph {
  const sanitized = sanitizeModelStructuredOutput(value, {
    label: "plan graph",
    // `capabilityId` is an IDENTITY key everywhere else in the system, and
    // rightly so: a model naming one is usually claiming an identity the
    // server assigns. Here it is the entire content of a step, so this
    // boundary declares it — and it is safe to declare ONLY because
    // `validatePlanGraph` resolves every id against the closed trusted
    // registry and rejects anything that is not in it. The model chooses from
    // a list; it does not mint a name.
    allowKeys: ["capabilityId"],
    // A step's inputs are an opaque descriptive payload the planner never
    // reads as a decision — the sanitiser's own documented case. Without this,
    // a plan for somebody whose data happens to contain a field called
    // `verified` would be rejected as an authority claim.
    freeFormKeys: ["inputs"],
  });
  return PlanGraphSchema.parse(sanitized.value);
}

// ── Materialization into the DAG that already exists ─────────────────────────

/**
 * Exactly the shape `createRuntimeDag` already takes. Nothing new is invented.
 *
 * Note what is absent: attempt policy. `createRuntimeDag` has its own default
 * and its own bounds, and a planner that could set them would be deciding how
 * many times a real-world effect may be attempted — which is an execution
 * decision wearing a planning hat. A first draft of this type carried an
 * optional `maxAttempts` that nothing ever set; the eval that asserts
 * BLIND_RETRY = 0 caught it.
 */
export type MaterializedDagNode = {
  nodeKey: string;
  capabilityId: string;
  inputs: Record<string, unknown>;
  dependencies: string[];
};

/**
 * Turn a validated plan into durable DAG nodes.
 *
 * `__runtimeBindings` is the existing `RuntimeInputBinding` channel, unchanged:
 * the runtime resolves `sourceNodeKey` to a real node it owns at execution
 * time, after the owner and dependency checks it already performs. The plan
 * supplies a key and a path; the runtime supplies identity. That split is the
 * whole reason a model may be allowed to propose a binding at all.
 */
export function materializePlanGraph(plan: PlanGraph): MaterializedDagNode[] {
  if (!DAG_KINDS.has(plan.kind)) return [];
  return plan.nodes.map((node) => ({
    nodeKey: node.key,
    capabilityId: node.capabilityId,
    inputs: {
      ...node.inputs,
      ...(node.bindings.length > 0
        ? {
            __runtimeBindings: node.bindings.map((binding) => ({
              kind: "dag_node" as const,
              sourceNodeKey: binding.fromNode,
              targetKey: binding.targetKey,
              valuePath: binding.valuePath,
            })),
          }
        : {}),
    },
    dependencies: node.dependsOn,
  }));
}

/**
 * What is known about undoing each step, read from the capability registry.
 *
 * Derived, never declared. `CompensationPolicy` remains the authority once an
 * effect has actually happened; this only answers "if this step does something,
 * what class of undo exists", which is information a person deserves BEFORE
 * approving rather than after. Nothing here requests, performs or verifies a
 * compensation, and none of those three is the same thing as the others.
 */
export function planCompensationOutlook(
  plan: PlanGraph,
): ReadonlyArray<{ nodeKey: string; reversibility: string }> {
  return plan.nodes.map((node) => {
    try {
      return {
        nodeKey: node.key,
        reversibility: capabilityEffectContract(node.capabilityId).compensation.reversibility,
      };
    } catch {
      // An unknown capability is already a validation violation; it does not
      // also get to claim a reversibility.
      return { nodeKey: node.key, reversibility: "IRREVERSIBLE" };
    }
  });
}
