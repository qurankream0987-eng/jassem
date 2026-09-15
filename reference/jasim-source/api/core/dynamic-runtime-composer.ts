/**
 * Goal-driven runtime composition.
 *
 * This module does not know FoodAgent, FleetAgent, restaurant screens or any
 * other domain application. It composes a temporary world from generic
 * operations: understand, discover, retrieve, match, confirm, commit,
 * delegate, track and verify.
 */

import { createHash } from "node:crypto";
import {
  ExecutionPlanSchema,
  WorldDNASchema,
  type ExecutionPlan,
  type IntentStructure,
  type WorldDNA,
} from "@contracts/dna";
import {
  DNA_PRIMITIVES,
  type BubbleSchema,
} from "@contracts/jasim";
import type { GeneVersion } from "@contracts/generative-dna";
import { GenerativeBubbleCompiler } from "./generative-bubble-compiler";

export interface TemporaryAgentSpec {
  id: string;
  goal: string;
  stepIds: string[];
  capabilities: string[];
  permissions: string[];
  lifetime: "task";
  disposeWhen: "task_terminal";
}

export interface DynamicRuntimeComposition {
  id: string;
  world: WorldDNA;
  plan: ExecutionPlan;
  agents: TemporaryAgentSpec[];
  bubbles: BubbleSchema[];
  activeGeneVersionIds: string[];
  generatedAt: string;
}

export interface DynamicRuntimeCompositionOptions {
  baseWorld?: WorldDNA;
  conversationId?: number;
}

interface GoalNeeds {
  acquire: boolean;
  offer: boolean;
  createEnvironment: boolean;
  discovery: boolean;
  network: boolean;
  visualEvidence: boolean;
  appraisal: boolean;
  negotiation: boolean;
  fulfillment: boolean;
  proximity: boolean;
  tracking: boolean;
  sourceHint?: string;
  resourceHint: string;
  interactionAction?: string;
}

interface StepDraft {
  id: string;
  name: string;
  capabilityId: string;
  inputs: Record<string, unknown>;
  dependencies: string[];
  risk: "none" | "low" | "medium" | "high" | "critical";
  requiresApproval?: boolean;
  verification: { type: "schema" | "predicate" | "manual" | "none"; config: Record<string, unknown> };
}

export class DynamicRuntimeComposer {
  private readonly bubbleCompiler = new GenerativeBubbleCompiler();

  compose(intent: IntentStructure, genes: GeneVersion[] = [], options: DynamicRuntimeCompositionOptions = {}): DynamicRuntimeComposition {
    const generatedAt = new Date().toISOString();
    const digest = createHash("sha256").update(`${intent.goal}\n${generatedAt}`).digest("hex").slice(0, 16);
    const compositionId = `runtime_${digest}`;
    const derived = this.deriveNeeds(intent);
    const createSeparateWorld = options.baseWorld ? this.requestsSeparateWorld(intent) : false;
    const baseWorld = createSeparateWorld ? undefined : options.baseWorld;
    const evolvesBase = baseWorld ? this.requestsWorldEvolution(intent) : false;
    const needs = baseWorld ? { ...derived, createEnvironment: evolvesBase } : derived;
    const steps = this.composeSteps(intent, needs, genes);
    const generatedWorld = this.composeWorld(intent, needs, steps, genes, compositionId, generatedAt);
    const world = baseWorld
      ? evolvesBase
        ? this.evolveWorld(baseWorld, generatedWorld, intent, generatedAt)
        : this.contextualTaskWorld(baseWorld, generatedWorld, intent, generatedAt)
      : generatedWorld;
    const plan = ExecutionPlanSchema.parse({
      id: `plan_${digest}`,
      name: `Runtime plan: ${intent.goal.slice(0, 80)}`,
      description: "Composed from generic capabilities for this goal only",
      steps: steps.map((step) => ({
        ...step,
        inputs: step.capabilityId === DNA_PRIMITIVES.PERSIST
          ? { ...step.inputs, world, conversationId: options.conversationId }
          : step.inputs,
        outputs: {},
      })),
      edges: steps.flatMap((step) => step.dependencies.map((dependency) => ({ from: dependency, to: step.id }))),
      onFailure: "replan",
      maxRetries: 3,
      worldId: world.id,
      generatedAt,
    });

    return {
      id: compositionId,
      world,
      plan,
      agents: this.composeAgents(steps, compositionId),
      bubbles: this.bubbleCompiler.compile(world),
      activeGeneVersionIds: genes.filter((gene) => gene.status === "active").map((gene) => gene.id),
      generatedAt,
    };
  }

  private deriveNeeds(intent: IntentStructure): GoalNeeds {
    const text = `${intent.goal} ${intent.actions.join(" ")} ${intent.domainHints.join(" ")}`.toLowerCase();
    const acquire = /(أريد|اريد|اطلب|طلب|شراء|اشتر|order|buy|purchase|want|acquire)/i.test(text);
    const offer = /(أبيع|ابيع|بيع|أعرض|اعرض|انشر|sell|offer|list|publish)/i.test(text) || intent.actions.includes("sell");
    const createEnvironment = /(منصة|نظام|مساحة|بيئة|مجتمع|platform|system|workspace|environment|community)/i.test(text) ||
      intent.actions.some((action) => ["build", "compose", "create_environment", "evolve_environment"].includes(action));
    const discovery = intent.actions.some((action) => ["search", "browse", "discover", "find"].includes(action)) ||
      /(ابحث|بحث|تصفح|اكتشف|search|browse|discover|find)/i.test(text);
    const network = /(يجمع|تجمع|اجمع|يربط|اربط|عدة|شركات|باحثين|مشاركين|أطراف|اطراف|connect|network|multi|community|participants|between)/i.test(text) || intent.actors.length > 2;
    const visualEvidence = /(صورة|صور|تصوير|مرفق|image|photo|picture|attachment|vision)/i.test(text) ||
      intent.objects.some((object) => Object.keys(object.attributes).some((key) => /image|photo|picture|attachment|visual/i.test(key)));
    const appraisal = offer || /(قيم|تقييم|السعر|سعر|appraise|value|valuation|price|estimate)/i.test(text);
    const negotiation = offer || /(فاوض|تفاوض|عرض|مزاد|negotiate|haggle|bid|counteroffer)/i.test(text);
    const fulfillment = /(سائق|مندوب|توصيل|يوصل|وصل|driver|courier|deliver|fulfil|fulfill)/i.test(text);
    const proximity = /(قريب|الأقرب|اقرب|near|nearby|closest|location)/i.test(text) ||
      intent.constraints.some((constraint) => constraint.type === "location");
    const tracking = fulfillment || /(تتبع|تابع|track|monitor)/i.test(text);
    const sourceMatch = intent.goal.match(/(?:من|from)\s+(?:مطعم|متجر|محل|restaurant|store|shop)?\s*([\p{L}\p{N}_-]+(?:\s+[\p{L}\p{N}_-]+){0,3})/iu);
    const resource = intent.objects.find((object) => object.type === "resource" || object.type === "product")?.name
      ?? intent.objects[0]?.name
      ?? "Requested resource";
    return {
      acquire: acquire && !offer && !createEnvironment,
      offer,
      createEnvironment,
      discovery,
      network,
      visualEvidence,
      appraisal,
      negotiation,
      fulfillment,
      proximity,
      tracking,
      sourceHint: sourceMatch?.[1]?.trim(),
      resourceHint: resource,
      interactionAction: this.primaryInteraction(intent),
    };
  }

  private requestsWorldEvolution(intent: IntentStructure): boolean {
    const text = `${intent.goal} ${intent.actions.join(" ")}`;
    return /(أضف|اضف|إضافة|اضافة|احذف|إحذف|عدل|عدّل|غير|غيّر|طوّر|طور|وسّع|وسع|اجعل|add|remove|delete|update|modify|change|evolve|extend)/i.test(text) ||
      intent.actions.some((action) => ["evolve_environment", "modify_environment", "update_environment"].includes(action));
  }

  private requestsSeparateWorld(intent: IntentStructure): boolean {
    const text = `${intent.goal} ${intent.actions.join(" ")}`;
    return /(منصة جديدة|نظام جديد|مساحة جديدة|بيئة جديدة|new platform|new system|new workspace|separate platform)/i.test(text);
  }

  private composeSteps(intent: IntentStructure, needs: GoalNeeds, genes: GeneVersion[]): StepDraft[] {
    const steps: StepDraft[] = [];
    const add = (step: StepDraft) => steps.push(step);

    add({
      id: "step_understand_goal",
      name: "Understand requested outcome",
      capabilityId: DNA_PRIMITIVES.UNDERSTAND,
      inputs: { goal: intent.goal, constraints: intent.constraints },
      dependencies: [],
      risk: "none",
      verification: { type: "schema", config: { required: ["intent"] } },
    });

    if (needs.createEnvironment) {
      add({
        id: "step_model_environment",
        name: "Model the requested reusable world",
        capabilityId: DNA_PRIMITIVES.ANALYZE,
        inputs: { intent, inferParticipants: true, inferRelations: true, inferPolicies: true },
        dependencies: ["step_understand_goal"],
        risk: "none",
        verification: { type: "schema", config: { required: ["entities", "relations", "capabilities"] } },
      });
      add({
        id: "step_generate_environment",
        name: "Generate the world definition and its interfaces",
        capabilityId: DNA_PRIMITIVES.GENERATE,
        inputs: { model: "${step_model_environment}", noDomainComponents: true },
        dependencies: ["step_model_environment"],
        risk: "low",
        verification: { type: "schema", config: { required: ["world", "ui"] } },
      });
    }

    // Discovery is a semantic operation, not a domain route. When a user asks
    // for a reusable world (lending, research, clubs, or something unseen),
    // compose a searchable surface for the generated subject itself.
    const hasGenericDiscovery = needs.discovery && !needs.acquire && !needs.appraisal && !needs.offer && !needs.fulfillment;
    if (hasGenericDiscovery) {
      add({
        id: "step_discover_subjects",
        name: "Discover subjects relevant to the requested interaction",
        capabilityId: DNA_PRIMITIVES.SEARCH,
        inputs: {
          query: needs.resourceHint,
          interaction: needs.interactionAction,
          constraints: intent.constraints,
          searchScope: "generated_world",
        },
        dependencies: [needs.createEnvironment ? "step_generate_environment" : "step_understand_goal"],
        risk: "none",
        verification: { type: "schema", config: { required: ["items"] } },
      });
    }

    if (needs.visualEvidence || needs.offer) {
      const suppliedEvidence = intent.objects.flatMap((object) =>
        Object.entries(object.attributes)
          .filter(([name]) => /image|photo|picture|attachment|visual|evidence/i.test(name))
          .flatMap(([, value]) => Array.isArray(value) ? value : [value]),
      );
      add({
        id: "step_understand_evidence",
        name: "Understand available evidence about the subject",
        capabilityId: needs.visualEvidence ? DNA_PRIMITIVES.VISION : DNA_PRIMITIVES.EXTRACT,
        inputs: {
          subject: needs.resourceHint,
          evidence: suppliedEvidence.length > 0 ? suppliedEvidence : "user_supplied_or_requested",
          connectorScopes: ["external_partner"],
          consent: suppliedEvidence.length > 0 ? "user_requested_analysis" : undefined,
        },
        dependencies: ["step_understand_goal"],
        risk: "none",
        verification: { type: "schema", config: { required: ["observations"] } },
      });
    }

    if (needs.appraisal) {
      add({
        id: "step_research_context",
        name: "Research comparable evidence and current context",
        capabilityId: DNA_PRIMITIVES.SEARCH,
        inputs: {
          query: needs.resourceHint,
          evidence: "${step_understand_evidence}",
          searchScope: "public_web",
          allowExternalData: true,
        },
        dependencies: [needs.visualEvidence || needs.offer ? "step_understand_evidence" : "step_understand_goal"],
        risk: "none",
        verification: { type: "schema", config: { required: ["items"] } },
      });
      add({
        id: "step_appraise_subject",
        name: "Estimate a defensible value range",
        capabilityId: DNA_PRIMITIVES.ANALYZE,
        inputs: { subject: needs.resourceHint, comparables: "${step_research_context}", constraints: intent.constraints },
        dependencies: ["step_research_context"],
        risk: "low",
        verification: { type: "schema", config: { required: ["range", "confidence", "evidence"] } },
      });
    }

    if (needs.offer) {
      add({
        id: "step_generate_presentation",
        name: "Generate an accurate presentation for the subject",
        capabilityId: DNA_PRIMITIVES.GENERATE,
        inputs: { subject: needs.resourceHint, evidence: "${step_understand_evidence}", appraisal: "${step_appraise_subject}" },
        dependencies: [needs.appraisal ? "step_appraise_subject" : "step_understand_evidence"],
        risk: "low",
        verification: { type: "schema", config: { required: ["title", "description", "disclosures"] } },
      });
    }

    if (needs.acquire) {
      add({
        id: "step_discover_source",
        name: "Discover a source for the requested resource",
        capabilityId: DNA_PRIMITIVES.SEARCH,
        inputs: {
          query: needs.resourceHint,
          preferredSource: needs.sourceHint,
          goal: intent.goal,
          searchScopes: ["jasim_internal", "public_web"],
          allowExternalData: true,
        },
        dependencies: ["step_understand_goal"],
        risk: "none",
        verification: { type: "schema", config: { required: ["items"] } },
      });
      add({
        id: "step_retrieve_options",
        name: "Retrieve currently available options",
        capabilityId: DNA_PRIMITIVES.RETRIEVE,
        inputs: { source: "${step_discover_source}" },
        dependencies: ["step_discover_source"],
        risk: "none",
        verification: { type: "schema", config: { required: ["items"] } },
      });
      add({
        id: "step_match_resource",
        name: "Match options to the user's request",
        capabilityId: DNA_PRIMITIVES.MATCH,
        inputs: { candidates: "${step_retrieve_options}", constraints: intent.constraints },
        dependencies: ["step_retrieve_options"],
        risk: "low",
        verification: { type: "predicate", config: { predicate: "selected != null" } },
      });
    }

    if (needs.fulfillment) {
      add({
        id: "step_discover_fulfiller",
        name: "Discover an available fulfillment provider",
        capabilityId: DNA_PRIMITIVES.SEARCH,
        inputs: {
          role: "fulfillment_provider",
          near: needs.proximity ? "user_location" : undefined,
          searchScope: "jasim_internal",
        },
        dependencies: ["step_understand_goal"],
        risk: "none",
        verification: { type: "schema", config: { required: ["items"] } },
      });
      add({
        id: "step_match_fulfiller",
        name: "Match a provider by distance, availability and constraints",
        capabilityId: DNA_PRIMITIVES.MATCH,
        inputs: { candidates: "${step_discover_fulfiller}", rankBy: needs.proximity ? ["distance", "availability"] : ["availability"] },
        dependencies: ["step_discover_fulfiller"],
        risk: "low",
        verification: { type: "predicate", config: { predicate: "selected != null" } },
      });
    }

    const matchDependencies = [
      ...(needs.acquire ? ["step_match_resource"] : []),
      ...(needs.fulfillment ? ["step_match_fulfiller"] : []),
      ...(needs.offer ? ["step_generate_presentation"] : []),
      ...(needs.createEnvironment ? ["step_generate_environment"] : []),
      ...(hasGenericDiscovery ? ["step_discover_subjects"] : []),
    ];
    const hasCommitment = needs.acquire || needs.offer || needs.createEnvironment || needs.fulfillment;
    if (hasCommitment) {
      add({
        id: "step_confirm_commitment",
        name: "Request user confirmation before an external or persistent change",
        capabilityId: DNA_PRIMITIVES.CONFIRM,
        inputs: {
          subject: needs.acquire ? "${step_match_resource}" : needs.offer ? "${step_generate_presentation}" : intent.goal,
          fulfiller: needs.fulfillment ? "${step_match_fulfiller}" : undefined,
        },
        dependencies: matchDependencies.length > 0 ? matchDependencies : ["step_understand_goal"],
        risk: "medium",
        requiresApproval: true,
        verification: { type: "manual", config: { actor: "user" } },
      });
    }

    if (needs.createEnvironment) {
      add({
        id: "step_persist_environment",
        name: "Persist the approved generated world as a versioned system",
        capabilityId: DNA_PRIMITIVES.PERSIST,
        inputs: { world: "${step_generate_environment}", approval: "${step_confirm_commitment}" },
        dependencies: ["step_confirm_commitment"],
        risk: "high",
        requiresApproval: true,
        verification: { type: "schema", config: { required: ["worldId", "version", "status"] } },
      });
    }

    if (needs.offer) {
      add({
        id: "step_publish_offer",
        name: "Publish the approved offer to relevant discovery surfaces",
        capabilityId: DNA_PRIMITIVES.LIST,
        inputs: {
          presentation: "${step_generate_presentation}",
          approval: "${step_confirm_commitment}",
          connectorScopes: ["jasim_internal"],
        },
        dependencies: ["step_confirm_commitment"],
        risk: "high",
        requiresApproval: true,
        verification: { type: "schema", config: { required: ["reference", "status"] } },
      });
      add({
        id: "step_discover_counterparties",
        name: "Discover relevant interested counterparties",
        capabilityId: DNA_PRIMITIVES.SEARCH,
        inputs: {
          offer: "${step_publish_offer}",
          rankBy: ["relevance", "trust", "intent"],
          searchScope: "jasim_internal",
        },
        dependencies: ["step_publish_offer"],
        risk: "none",
        verification: { type: "schema", config: { required: ["items"] } },
      });
      add({
        id: "step_match_counterparty",
        name: "Match interest, trust and constraints",
        capabilityId: DNA_PRIMITIVES.MATCH,
        inputs: { candidates: "${step_discover_counterparties}", constraints: intent.constraints },
        dependencies: ["step_discover_counterparties"],
        risk: "low",
        verification: { type: "predicate", config: { predicate: "selected != null" } },
      });
      if (needs.negotiation) {
        add({
          id: "step_negotiate_exchange",
          name: "Assist with a bounded and transparent negotiation",
          capabilityId: DNA_PRIMITIVES.NEGOTIATE,
          inputs: { counterpart: "${step_match_counterparty}", appraisal: "${step_appraise_subject}" },
          dependencies: ["step_match_counterparty"],
          risk: "medium",
          verification: { type: "schema", config: { required: ["proposal", "status"] } },
        });
      }
      add({
        id: "step_confirm_exchange",
        name: "Confirm the final exchange terms",
        capabilityId: DNA_PRIMITIVES.CONFIRM,
        inputs: { terms: needs.negotiation ? "${step_negotiate_exchange}" : "${step_match_counterparty}" },
        dependencies: [needs.negotiation ? "step_negotiate_exchange" : "step_match_counterparty"],
        risk: "high",
        requiresApproval: true,
        verification: { type: "manual", config: { actor: "user" } },
      });
      add({
        id: "step_commit_exchange",
        name: "Create the approved exchange commitment",
        capabilityId: DNA_PRIMITIVES.SELL,
        inputs: {
          offer: "${step_publish_offer}",
          terms: "${step_confirm_exchange}",
          connectorScopes: ["jasim_internal"],
        },
        dependencies: ["step_confirm_exchange"],
        risk: "high",
        requiresApproval: true,
        verification: { type: "schema", config: { required: ["transaction", "status"] } },
      });
    }

    if (needs.acquire) {
      add({
        id: "step_create_commitment",
        name: "Create the approved acquisition commitment",
        capabilityId: DNA_PRIMITIVES.BUY,
        inputs: {
          selection: "${step_match_resource}",
          approval: "${step_confirm_commitment}",
          connectorScopes: ["jasim_internal", "external_partner"],
          allowExternalData: true,
        },
        dependencies: ["step_confirm_commitment"],
        risk: "high",
        requiresApproval: true,
        verification: { type: "schema", config: { required: ["transaction", "status"] } },
      });
    }

    if (needs.fulfillment) {
      add({
        id: "step_delegate_fulfillment",
        name: "Delegate fulfillment to the selected provider",
        capabilityId: DNA_PRIMITIVES.DELEGATE,
        inputs: {
          assignee: "${step_match_fulfiller}",
          task: needs.acquire ? "${step_create_commitment}" : needs.offer ? "${step_commit_exchange}" : intent.goal,
          connectorScopes: ["jasim_internal", "external_partner"],
          allowExternalData: true,
        },
        dependencies: [needs.acquire ? "step_create_commitment" : needs.offer ? "step_commit_exchange" : "step_confirm_commitment"],
        risk: "medium",
        requiresApproval: true,
        verification: { type: "schema", config: { required: ["assignmentId"] } },
      });
    }

    if (needs.tracking) {
      add({
        id: "step_track_outcome",
        name: "Track progress until the outcome is delivered",
        capabilityId: DNA_PRIMITIVES.TRACK,
        inputs: {
          target: needs.fulfillment ? "${step_delegate_fulfillment}" : needs.offer ? "${step_commit_exchange}" : "${step_create_commitment}",
          connectorScopes: ["jasim_internal", "external_partner"],
          allowExternalData: true,
        },
        dependencies: [needs.fulfillment ? "step_delegate_fulfillment" : needs.offer ? "step_commit_exchange" : "step_create_commitment"],
        risk: "none",
        verification: { type: "predicate", config: { predicate: "status in ['completed','delivered']" } },
      });
      add({
        id: "step_verify_outcome",
        name: "Verify completion against the original goal",
        capabilityId: DNA_PRIMITIVES.VERIFY,
        inputs: { goal: intent.goal, result: "${step_track_outcome}" },
        dependencies: ["step_track_outcome"],
        risk: "low",
        verification: { type: "schema", config: { required: ["valid"] } },
      });
    }

    for (const gene of genes.filter((item) => item.status === "active" && item.proposal.kind === "capability" && item.proposal.executorRef)) {
      if (!this.geneMatchesGoal(gene, intent.goal)) continue;
      add({
        id: `step_gene_${gene.id.replace(/[^a-zA-Z0-9]/g, "_").slice(-40)}`,
        name: `Use learned capability: ${gene.proposal.name}`,
        capabilityId: gene.proposal.executorRef!.replace(/^capability:/, ""),
        inputs: { goal: intent.goal },
        dependencies: ["step_understand_goal"],
        risk: gene.proposal.risk,
        verification: { type: "schema", config: gene.proposal.outputSchema ?? {} },
      });
    }

    return steps;
  }

  private composeWorld(
    intent: IntentStructure,
    needs: GoalNeeds,
    steps: StepDraft[],
    genes: GeneVersion[],
    compositionId: string,
    generatedAt: string,
  ): WorldDNA {
    const continuity = needs.createEnvironment ? "evolving" as const : "ephemeral" as const;
    const participantInputs = intent.actors.length > 0
      ? intent.actors
      : [{ role: "initiator", description: "The participant who expressed the goal" }];
    const participants = participantInputs
      .filter((actor, index, all) => all.findIndex((candidate) => candidate.role === actor.role) === index)
      .map((actor, index) => ({
        id: `participant_${index}_${this.safeId(actor.role)}`,
        role: actor.role,
        label: actor.description ?? actor.role,
        description: actor.description,
        source: "intent" as const,
        capabilities: [...new Set(steps.map((step) => step.capabilityId))],
        policies: [],
        metadata: { generatedFromActor: true },
      }));

    const requestName = needs.interactionAction
      ? `${this.semanticName(needs.interactionAction)}Request`
      : "GoalRequest";
    const interactionLifecycle = this.interactionLifecycle(needs.interactionAction);
    const entities: Array<Record<string, unknown>> = [this.entity("request", intent.goal.slice(0, 80), [
      this.field("request", "goal", "Goal", "text", true),
      this.field("request", "status", "Status", "string", true),
      this.field("request", "context", "Context", "json", false),
    ], { name: requestName, lifecycle: interactionLifecycle })];

    const subjectIds: string[] = [];
    for (const [index, object] of intent.objects.entries()) {
      const baseEntityId = this.safeId(object.name).toLowerCase();
      const entityId = subjectIds.includes(baseEntityId) ? `${baseEntityId}_${index}` : baseEntityId;
      subjectIds.push(entityId);
      const attributeFields = Object.entries(object.attributes).map(([name, value]) =>
        this.field(entityId, this.safeId(name), name, this.inferFieldType(value), false),
      );
      const subjectName = this.semanticName(
        object.name,
        ["product", "resource"].includes(object.type) ? "Item" : undefined,
      );
      entities.push(this.entity(entityId, object.name, [
        this.field(entityId, "name", object.name, "string", true),
        ...attributeFields,
        ...(["borrow", "lend", "rent"].includes(needs.interactionAction ?? "") ? [
          this.field(entityId, "availability", "Availability", "boolean", true),
        ] : []),
        this.field(entityId, "evidence", "Evidence", "json", false),
        this.field(entityId, "status", "Status", "string", true),
        ...(needs.appraisal ? [
          this.field(entityId, "estimated_value", "Estimated value", "currency", false),
          this.field(entityId, "confidence", "Confidence", "percentage", false),
        ] : []),
      ], { name: subjectName }));
    }

    for (const participant of participants) {
      entities.push(this.entity(participant.id, participant.label, [
        this.field(participant.id, "identity", participant.label, "reference", true),
        this.field(participant.id, "capabilities", "Capabilities", "json", false),
        this.field(participant.id, "state", "State", "string", true),
      ]));
    }

    if (needs.acquire) {
      entities.push(this.entity("resource_candidate", "Resource Candidate", [
        this.field("resource_candidate", "name", "Name", "string", true),
        this.field("resource_candidate", "source", "Source", "string", true),
        this.field("resource_candidate", "price", "Price", "currency", false),
        this.field("resource_candidate", "available", "Available", "boolean", true),
      ]));
    }
    if (needs.offer) {
      entities.push(this.entity("generated_offer", `Offer for ${needs.resourceHint}`, [
        this.field("generated_offer", "title", "Title", "string", true),
        this.field("generated_offer", "description", "Description", "rich_text", true),
        this.field("generated_offer", "evidence", "Evidence", "json", true),
        this.field("generated_offer", "value_range", "Value range", "json", false),
        this.field("generated_offer", "disclosures", "Disclosures", "json", false),
        this.field("generated_offer", "status", "Status", "string", true),
      ]));
      entities.push(this.entity("counterparty_signal", "Relevant interest", [
        this.field("counterparty_signal", "identity", "Identity", "reference", true),
        this.field("counterparty_signal", "intent", "Intent", "text", true),
        this.field("counterparty_signal", "trust", "Trust", "percentage", false),
        this.field("counterparty_signal", "proposal", "Proposal", "json", false),
      ]));
    }
    if (needs.fulfillment) {
      entities.push(this.entity("fulfillment_candidate", "Fulfillment Candidate", [
        this.field("fulfillment_candidate", "identity", "Provider", "string", true),
        this.field("fulfillment_candidate", "location", "Location", "geolocation", true),
        this.field("fulfillment_candidate", "availability", "Availability", "boolean", true),
        this.field("fulfillment_candidate", "eta", "ETA", "number", false),
      ]));
    }
    if (needs.acquire || needs.offer || needs.fulfillment || needs.createEnvironment) {
      entities.push(this.entity("commitment", "Runtime Commitment", [
        this.field("commitment", "reference", "Reference", "string", true),
        this.field("commitment", "status", "Status", "string", true),
        this.field("commitment", "total", "Total", "currency", false),
      ]));
    }

    const uniqueCapabilities = [...new Set(steps.map((step) => step.capabilityId))];
    const relations: Array<Record<string, unknown>> = [];
    const primarySubject = subjectIds[0] ?? "request";
    for (const participant of participants) {
      relations.push({
        id: `relation_${participant.id}_${primarySubject}`,
        name: intent.actions[0] ?? "participates_in",
        fromEntity: participant.id,
        toEntity: primarySubject,
        type: "generated_from_intent",
        cardinality: "many_to_many",
        required: false,
      });
    }
    if (needs.offer && subjectIds.length > 0) {
      relations.push({
        id: `relation_${primarySubject}_offer`,
        name: "represented_by",
        fromEntity: primarySubject,
        toEntity: "generated_offer",
        type: "composition",
        cardinality: "one_to_many",
        required: true,
      });
      relations.push({
        id: "relation_offer_interest",
        name: "receives_interest",
        fromEntity: "generated_offer",
        toEntity: "counterparty_signal",
        type: "association",
        cardinality: "one_to_many",
        required: false,
      });
    }

    const entityById = new Map(entities.map((entity) => [String(entity.id), entity]));
    const ui: Array<Record<string, unknown>> = steps.map((step) => {
      const entityId = this.targetEntityForCapability(step.capabilityId, {
        primarySubject,
        acquire: needs.acquire,
        offer: needs.offer,
        fulfillment: needs.fulfillment,
        persistent: needs.createEnvironment,
      });
      const entity = entityById.get(entityId);
      const fields = Array.isArray(entity?.fields)
        ? (entity.fields as Array<{ id: string }>).map((field) => field.id)
        : [];
      return {
        id: `ui_${step.id}`,
        type: this.uiPrimitiveForCapability(step.capabilityId, entity),
        entityId,
        title: step.name,
        description: `Generated for: ${intent.goal}`,
        fields,
        actions: [{
          id: `action_${step.id}`,
          label: step.name,
          capabilityBinding: step.capabilityId,
          variant: step.requiresApproval ? "primary" : "secondary",
        }],
        layout: {
          searchable: step.capabilityId === DNA_PRIMITIVES.SEARCH,
          filterable: [DNA_PRIMITIVES.SEARCH, DNA_PRIMITIVES.MATCH].includes(step.capabilityId as never),
          sortable: [DNA_PRIMITIVES.SEARCH, DNA_PRIMITIVES.ANALYZE, DNA_PRIMITIVES.RANK].includes(step.capabilityId as never),
          density: step.requiresApproval ? "compact" : "normal",
        },
        dataSource: { type: "capability", sourceId: step.capabilityId },
      };
    });

    return WorldDNASchema.parse({
      id: `world_${compositionId}`,
      name: intent.goal.slice(0, 100),
      description: needs.createEnvironment
        ? "Versioned world generated to persist and evolve through conversation"
        : "Goal-scoped world generated for the requested outcome",
      version: "1.0.0",
      visibility: needs.network ? "shared" : "private",
      purpose: intent.goal,
      continuity,
      participants,
      entities,
      relations,
      capabilities: uniqueCapabilities.map((capabilityId) => ({
        capabilityId,
        targetEntity: this.targetEntityForCapability(capabilityId, {
          primarySubject,
          acquire: needs.acquire,
          offer: needs.offer,
          fulfillment: needs.fulfillment,
          persistent: needs.createEnvironment,
        }),
      })),
      workflows: [{
        id: `workflow_${compositionId}`,
        name: "Generated goal workflow",
        trigger: "user_goal",
        steps: steps.map((step) => ({
          id: step.id,
          name: step.name,
          capabilityBinding: step.capabilityId,
          inputs: step.inputs,
          conditions: [],
        })),
        edges: steps.flatMap((step) => step.dependencies.map((from) => ({ from, to: step.id }))),
      }],
      policies: [
        ...steps.filter((step) => step.requiresApproval).map((step) => ({
          id: `policy_approval_${step.id}`,
          name: `Approval before ${step.name}`,
          type: "authorization" as const,
          target: step.capabilityId,
          condition: "approval.granted == true",
          action: "require_approval" as const,
        })),
        ...genes.filter((gene) => gene.status === "active" && gene.proposal.kind === "policy").map((gene) => ({
          id: `policy_gene_${gene.id}`,
          name: gene.proposal.name,
          type: "business_rule" as const,
          target: compositionId,
          condition: `active_gene == '${gene.id}'`,
          action: "warn" as const,
          message: gene.proposal.summary,
        })),
      ],
      ui,
      theme: { direction: "rtl", density: "normal" },
      generatedFrom: intent.goal,
      confidence: Math.max(0.65, intent.confidence),
      createdAt: generatedAt,
      lineage: { changeRequest: needs.createEnvironment ? intent.goal : undefined },
    });
  }

  private evolveWorld(base: WorldDNA, generated: WorldDNA, intent: IntentStructure, generatedAt: string): WorldDNA {
    const merge = <T>(left: T[], right: T[], key: (item: T) => string): T[] => {
      const values = new Map(left.map((item) => [key(item), item]));
      for (const item of right) values.set(key(item), item);
      return [...values.values()];
    };
    return WorldDNASchema.parse({
      ...base,
      id: base.id,
      name: base.name,
      description: base.description,
      version: base.version,
      ownerId: base.ownerId,
      tenantId: base.tenantId,
      visibility: base.visibility,
      purpose: base.purpose,
      continuity: base.continuity === "ephemeral" ? "evolving" : base.continuity,
      participants: merge(base.participants, generated.participants, (item) => item.role),
      entities: merge(base.entities, generated.entities, (item) => item.id),
      relations: merge(base.relations, generated.relations, (item) => item.id),
      capabilities: merge(base.capabilities, generated.capabilities,
        (item) => `${item.capabilityId}:${item.targetEntity ?? "world"}`),
      workflows: merge(base.workflows, generated.workflows, (item) => item.id),
      policies: merge(base.policies, generated.policies, (item) => item.id),
      ui: merge(base.ui, generated.ui, (item) => item.id),
      theme: base.theme,
      generatedFrom: intent.goal,
      confidence: Math.min(base.confidence, generated.confidence),
      createdAt: base.createdAt,
      updatedAt: generatedAt,
      lineage: {
        parentWorldId: base.id,
        parentVersion: base.version,
        changeRequest: intent.goal,
      },
    });
  }

  private contextualTaskWorld(base: WorldDNA, generated: WorldDNA, intent: IntentStructure, generatedAt: string): WorldDNA {
    const contextual = this.evolveWorld(base, generated, intent, generatedAt);
    return WorldDNASchema.parse({
      ...contextual,
      id: generated.id,
      name: generated.name,
      description: "Ephemeral operational view composed inside an attached generated world",
      version: "1.0.0",
      purpose: intent.goal,
      continuity: "ephemeral",
      generatedFrom: intent.goal,
      createdAt: generatedAt,
      updatedAt: generatedAt,
      lineage: {
        parentWorldId: base.id,
        parentVersion: base.version,
        changeRequest: undefined,
      },
    });
  }

  private composeAgents(steps: StepDraft[], compositionId: string): TemporaryAgentSpec[] {
    const stages = new Map<string, number>();
    const stageOf = (step: StepDraft, visiting = new Set<string>()): number => {
      const cached = stages.get(step.id);
      if (cached !== undefined) return cached;
      if (visiting.has(step.id)) return 0;
      visiting.add(step.id);
      const depth = step.dependencies.length === 0
        ? 0
        : 1 + Math.max(...step.dependencies.map((dependency) => {
          const parent = steps.find((candidate) => candidate.id === dependency);
          return parent ? stageOf(parent, visiting) : 0;
        }));
      stages.set(step.id, depth);
      return depth;
    };
    for (const step of steps) stageOf(step);

    const grouped = new Map<number, StepDraft[]>();
    for (const step of steps) {
      const stage = stages.get(step.id) ?? 0;
      grouped.set(stage, [...(grouped.get(stage) ?? []), step]);
    }

    return [...grouped.entries()].sort(([a], [b]) => a - b).map(([stage, selected]) => ({
      id: `temp_agent_${compositionId}_stage_${stage}`,
      goal: selected.map((step) => step.name).join("; "),
      stepIds: selected.map((step) => step.id),
      capabilities: [...new Set(selected.map((step) => step.capabilityId))],
      permissions: [...new Set(selected.flatMap((step) =>
        step.requiresApproval || ["high", "critical"].includes(step.risk)
          ? ["read", "write", "approval"]
          : step.risk === "medium" ? ["read", "write"] : ["read"],
      ))],
      lifetime: "task" as const,
      disposeWhen: "task_terminal" as const,
    }));
  }

  private targetEntityForCapability(
    capabilityId: string,
    context: { primarySubject: string; acquire: boolean; offer: boolean; fulfillment: boolean; persistent: boolean },
  ): string {
    if (context.fulfillment && [DNA_PRIMITIVES.DELEGATE, DNA_PRIMITIVES.TRACK].includes(capabilityId as never)) return "fulfillment_candidate";
    if (context.offer && [DNA_PRIMITIVES.LIST, DNA_PRIMITIVES.NEGOTIATE, DNA_PRIMITIVES.SELL].includes(capabilityId as never)) return "generated_offer";
    if (context.offer && [DNA_PRIMITIVES.SEARCH, DNA_PRIMITIVES.MATCH].includes(capabilityId as never)) return "counterparty_signal";
    if (context.acquire && [DNA_PRIMITIVES.SEARCH, DNA_PRIMITIVES.RETRIEVE, DNA_PRIMITIVES.MATCH].includes(capabilityId as never)) return "resource_candidate";
    if ([DNA_PRIMITIVES.CONFIRM, DNA_PRIMITIVES.BUY, DNA_PRIMITIVES.PERSIST].includes(capabilityId as never)) return "commitment";
    return context.primarySubject;
  }

  private uiPrimitiveForCapability(capabilityId: string, entity?: Record<string, unknown>): string {
    if (capabilityId === DNA_PRIMITIVES.VISION) return "gallery";
    if (capabilityId === DNA_PRIMITIVES.SEARCH) return "search";
    if ([DNA_PRIMITIVES.COMPARE, DNA_PRIMITIVES.ANALYZE, DNA_PRIMITIVES.RANK].includes(capabilityId as never)) return "comparison";
    if (capabilityId === DNA_PRIMITIVES.MATCH) return "list";
    if (capabilityId === DNA_PRIMITIVES.CONFIRM) return "confirmation";
    if ([DNA_PRIMITIVES.TRACK, DNA_PRIMITIVES.MONITOR].includes(capabilityId as never)) return "progress";
    if (capabilityId === DNA_PRIMITIVES.NEGOTIATE) return "actions";
    if ([DNA_PRIMITIVES.PERSIST, DNA_PRIMITIVES.GENERATE].includes(capabilityId as never)) return "detail";
    const fields = Array.isArray(entity?.fields) ? entity.fields as Array<{ type?: string }> : [];
    if (fields.some((field) => field.type === "geolocation")) return "map";
    if (fields.some((field) => field.type === "image")) return "gallery";
    return "detail";
  }

  private entity(
    id: string,
    label: string,
    fields: Array<Record<string, unknown>>,
    options: { name?: string; lifecycle?: Record<string, unknown> } = {},
  ): Record<string, unknown> {
    return {
      id,
      name: options.name ?? id,
      label,
      fields,
      relations: [],
      lifecycle: options.lifecycle ?? { states: ["draft", "active", "completed", "cancelled"], transitions: [], initialState: "draft" },
      permissions: [],
    };
  }

  private field(entityId: string, name: string, label: string, type: string, required: boolean): Record<string, unknown> {
    return { id: `${entityId}_${name}`, name, label, type, validation: { required }, searchable: true, filterable: true, sortable: true, comparable: true, displayable: true, editable: true, hidden: false };
  }

  private inferFieldType(value: unknown): string {
    if (typeof value === "number") return "number";
    if (typeof value === "boolean") return "boolean";
    if (Array.isArray(value) || (value !== null && typeof value === "object")) return "json";
    const text = String(value ?? "").toLowerCase();
    if (/^https?:\/\//.test(text)) return "url";
    if (/image|photo|picture|\.(png|jpe?g|webp)$/i.test(text)) return "image";
    return "string";
  }

  private safeId(value: string): string {
    const normalized = value.normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
    if (!normalized) return "generated";
    return normalized.slice(0, 48);
  }

  private primaryInteraction(intent: IntentStructure): string | undefined {
    const structuralActions = new Set([
      "search", "find", "browse", "discover", "filter", "compare", "sort",
      "build", "compose", "create_environment", "evolve_environment",
      "vision", "analyze", "verify", "confirm", "contact", "track", "read",
    ]);
    return intent.actions.find((action) => !structuralActions.has(action));
  }

  private semanticName(value: string, suffix?: string): string {
    const normalized = this.safeId(value);
    const words = normalized.split("_").filter(Boolean);
    const base = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join("") || "Generated";
    if (!suffix || base.toLowerCase().endsWith(suffix.toLowerCase())) return base;
    return `${base}${suffix}`;
  }

  private interactionLifecycle(action?: string): Record<string, unknown> {
    if (["borrow", "lend", "rent"].includes(action ?? "")) {
      return {
        states: ["draft", "submitted", "approved", "active", "returned", "completed", "cancelled"],
        transitions: [
          { from: "draft", to: "submitted", trigger: "generic.CONFIRM" },
          { from: "submitted", to: "approved", trigger: "generic.CONFIRM" },
          { from: "approved", to: "active", trigger: "generic.UPDATE" },
          { from: "active", to: "returned", trigger: "generic.VERIFY" },
          { from: "returned", to: "completed", trigger: "generic.VERIFY" },
        ],
        initialState: "draft",
      };
    }
    return { states: ["draft", "active", "completed", "cancelled"], transitions: [], initialState: "draft" };
  }

  private geneMatchesGoal(gene: GeneVersion, goal: string): boolean {
    const haystack = `${gene.proposal.name} ${gene.proposal.summary} ${gene.proposal.tags.join(" ")}`.toLowerCase();
    return goal.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((term) => term.length >= 3 && haystack.includes(term));
  }
}
