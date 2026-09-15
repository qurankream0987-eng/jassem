import { DNA_PRIMITIVES } from "@contracts/jasim";
import type {
  ConnectorExecutionContext,
  RuntimeConnector,
  RuntimeConnectorManifest,
} from "@contracts/runtime-connector";

export interface DiscoverableEntity {
  id: string;
  type: string;
  name: string;
  attributes: Record<string, unknown>;
  capabilities: string[];
  reputation?: { score: number; reviews: number; trustLevel: string };
  availability?: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface JasimEntityDirectory {
  listDiscoverable(): Promise<DiscoverableEntity[]>;
  findById(id: string): Promise<DiscoverableEntity | undefined>;
  findByIdempotency(type: string, idempotencyKey: string): Promise<DiscoverableEntity | undefined>;
  create(input: Omit<DiscoverableEntity, "id">): Promise<DiscoverableEntity>;
}

const now = () => new Date().toISOString();

export class JasimInternalDiscoveryConnector implements RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: "jasim.internal.discovery.v1",
    name: "JASIM internal intent and entity discovery",
    version: "1.0.0",
    provider: "jasim",
    capabilities: [DNA_PRIMITIVES.SEARCH],
    scopes: ["jasim_internal"],
    effect: "read",
    requiredPermissions: [],
    trust: { level: "system", score: 1 },
    health: { status: "healthy", checkedAt: now() },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 90,
    estimatedLatencyMs: 100,
    costClass: "free",
  };

  constructor(private readonly directory: JasimEntityDirectory) {}

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    const query = this.queryText(inputs);
    const tokens = this.tokens(query);
    const entities = await this.directory.listDiscoverable();
    const items = entities
      .filter((entity) => Number(entity.metadata.ownerUserId) !== context.userId)
      .map((entity) => ({ entity, score: this.score(entity, tokens) }))
      .filter((item) => item.score > 0 || tokens.length === 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 25)
      .map(({ entity, score }) => ({
        id: entity.id,
        type: entity.type,
        name: entity.name,
        attributes: entity.attributes,
        capabilities: entity.capabilities,
        reputation: entity.reputation,
        availability: entity.availability,
        relevance: score,
        source: "jasim_internal",
      }));
    return { items, total: items.length, query, scope: "jasim_internal" };
  }

  private queryText(inputs: Record<string, unknown>): string {
    if (typeof inputs.query === "string") return inputs.query;
    if (typeof inputs.role === "string") return inputs.role;
    return JSON.stringify(inputs.offer ?? inputs.subject ?? "");
  }

  private tokens(value: string): string[] {
    return [...new Set(value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2))];
  }

  private score(entity: DiscoverableEntity, tokens: string[]): number {
    const haystack = `${entity.name} ${entity.type} ${JSON.stringify(entity.attributes)} ${entity.capabilities.join(" ")}`.toLowerCase();
    const matches = tokens.filter((token) => haystack.includes(token)).length;
    const reputation = entity.reputation?.score ?? 0;
    const available = entity.availability && entity.availability.available !== false ? 1 : 0;
    return Math.round((matches * 10 + reputation + available) * 100) / 100;
  }
}

abstract class JasimIdempotentWriteConnector implements RuntimeConnector {
  abstract readonly manifest: RuntimeConnectorManifest;
  abstract execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown>;
  constructor(protected readonly directory: JasimEntityDirectory) {}

  protected async createOnce(
    type: string,
    name: string,
    attributes: Record<string, unknown>,
    context: ConnectorExecutionContext,
    visibility: "private" | "shared",
  ): Promise<DiscoverableEntity> {
    const existing = await this.directory.findByIdempotency(type, context.idempotencyKey);
    if (existing) return existing;
    return this.directory.create({
      type,
      name,
      attributes,
      capabilities: [],
      metadata: {
        ownerUserId: context.userId,
        worldId: context.worldId,
        planId: context.planId,
        stepId: context.stepId,
        approvalId: context.approvalId,
        idempotencyKey: context.idempotencyKey,
        visibility,
        discoverable: visibility === "shared",
        generatedBy: "jasim_runtime",
        createdAt: now(),
      },
    });
  }
}

export class JasimOfferPublisherConnector extends JasimIdempotentWriteConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: "jasim.internal.offer-publisher.v1",
    name: "JASIM generated offer publisher",
    version: "1.0.0",
    provider: "jasim",
    capabilities: [DNA_PRIMITIVES.LIST],
    scopes: ["jasim_internal"],
    effect: "write",
    requiredPermissions: [],
    trust: { level: "system", score: 1 },
    health: { status: "healthy", checkedAt: now() },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 95,
    estimatedLatencyMs: 120,
    costClass: "free",
  };

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    const presentation = inputs.presentation as Record<string, unknown> | undefined;
    const name = String(presentation?.title ?? inputs.title ?? "Generated offer");
    const entity = await this.createOnce("generated_offer", name, {
      presentation: presentation ?? inputs,
      status: "published",
    }, context, "shared");
    return { reference: `jasim:entity:${entity.id}`, status: "published", entityId: entity.id, surface: "jasim_internal" };
  }
}

export class JasimCommitmentConnector extends JasimIdempotentWriteConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: "jasim.internal.exchange-commitment.v1",
    name: "JASIM exchange commitment writer",
    version: "1.0.0",
    provider: "jasim",
    capabilities: [DNA_PRIMITIVES.BUY, DNA_PRIMITIVES.SELL],
    scopes: ["jasim_internal"],
    effect: "write",
    requiredPermissions: [],
    trust: { level: "system", score: 1 },
    health: { status: "healthy", checkedAt: now() },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 95,
    estimatedLatencyMs: 120,
    costClass: "free",
  };

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    const entity = await this.createOnce("exchange_commitment", "Approved exchange commitment", {
      terms: inputs.terms,
      offer: inputs.offer,
      selection: inputs.selection,
      status: "committed_inside_jasim",
      paymentTransferred: false,
    }, context, "private");
    return {
      transaction: `jasim:commitment:${entity.id}`,
      status: "committed_inside_jasim",
      paymentTransferred: false,
      entityId: entity.id,
    };
  }
}

export class JasimFulfillmentAssignmentConnector extends JasimIdempotentWriteConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: "jasim.internal.fulfillment-assignment.v1",
    name: "JASIM generic fulfillment assignment",
    version: "1.0.0",
    provider: "jasim",
    capabilities: [DNA_PRIMITIVES.DELEGATE],
    scopes: ["jasim_internal"],
    effect: "external_change",
    requiredPermissions: [],
    trust: { level: "system", score: 1 },
    health: { status: "healthy", checkedAt: now() },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 95,
    estimatedLatencyMs: 120,
    costClass: "free",
  };

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    if (!context.approvalId) throw new Error("Fulfillment assignment requires scoped user approval");
    const entity = await this.createOnce("fulfillment_assignment", "Approved fulfillment assignment", {
      assignee: inputs.assignee,
      task: inputs.task,
      status: "assigned",
    }, context, "private");
    return {
      assignmentId: `jasim:assignment:${entity.id}`,
      status: "assigned",
      paymentTransferred: false,
      entityId: entity.id,
    };
  }
}

export class JasimProgressTrackingConnector implements RuntimeConnector {
  readonly manifest: RuntimeConnectorManifest = {
    id: "jasim.internal.progress-tracking.v1",
    name: "JASIM generic progress tracking",
    version: "1.0.0",
    provider: "jasim",
    capabilities: [DNA_PRIMITIVES.TRACK],
    scopes: ["jasim_internal"],
    effect: "read",
    requiredPermissions: [],
    trust: { level: "system", score: 1 },
    health: { status: "healthy", checkedAt: now() },
    sendsUserDataExternally: false,
    enabled: true,
    priority: 95,
    estimatedLatencyMs: 80,
    costClass: "free",
  };

  constructor(private readonly directory: JasimEntityDirectory) {}

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    const reference = this.findReference(inputs.target ?? inputs);
    const id = reference?.replace(/^jasim:(?:assignment|commitment):/, "");
    const entity = id ? await this.directory.findById(id) : undefined;
    if (!entity || Number(entity.metadata.ownerUserId) !== context.userId) {
      return { status: "not_found", current: null, history: [], reference };
    }
    return {
      status: String(entity.attributes.status ?? "unknown"),
      current: entity.attributes,
      history: [],
      reference,
      updatedAt: String(entity.metadata.createdAt ?? now()),
    };
  }

  private findReference(value: unknown): string | undefined {
    if (typeof value === "string" && /^jasim:(assignment|commitment):/.test(value)) return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findReference(item);
        if (found) return found;
      }
    }
    if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) {
        const found = this.findReference(item);
        if (found) return found;
      }
    }
    return undefined;
  }
}
