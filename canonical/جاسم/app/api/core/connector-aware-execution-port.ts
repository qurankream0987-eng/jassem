import { createHash } from "node:crypto";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import {
  ConnectorScopeSchema,
  RuntimeInputRequirementSchema,
  type ConnectorScope,
  type RuntimeInputRequirement,
} from "@contracts/runtime-connector";
import type { ExternalActionLedger, ExternalActionRecord } from "@contracts/external-action";
import type {
  CapabilityExecutionContext,
  ExecutableCapabilityDescriptor,
  GeneratedCapabilityExecutionPort,
} from "./generated-plan-executor";
import type { RuntimeConnectorRegistry } from "./runtime-connector-registry";

const CONNECTOR_REQUIRED = new Set<string>([
  DNA_PRIMITIVES.VISION,
  DNA_PRIMITIVES.SEARCH,
  DNA_PRIMITIVES.LIST,
  DNA_PRIMITIVES.BUY,
  DNA_PRIMITIVES.SELL,
  DNA_PRIMITIVES.DELEGATE,
  DNA_PRIMITIVES.TRACK,
  DNA_PRIMITIVES.EXECUTE,
]);

export class ConnectorAwareExecutionPort implements GeneratedCapabilityExecutionPort {
  constructor(
    private readonly fallback: GeneratedCapabilityExecutionPort,
    private readonly connectors: RuntimeConnectorRegistry,
    private readonly actions?: ExternalActionLedger,
  ) {}

  describe(capabilityId: string): Promise<ExecutableCapabilityDescriptor> {
    return this.fallback.describe(capabilityId);
  }

  async inputRequirements(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<RuntimeInputRequirement | undefined> {
    const candidates = this.discover(capabilityId, inputs, context);
    const selected = candidates[0]?.connector;
    if (!selected?.inputRequirements) return undefined;
    const requirement = await selected.inputRequirements(inputs, context);
    return requirement ? RuntimeInputRequirementSchema.parse(requirement) : undefined;
  }

  async invoke(
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<unknown> {
    const allSupporting = this.connectors.list().filter((connector) => connector.manifest.capabilities.includes(capabilityId));
    const scopes = this.readScopes(inputs);
    const candidates = this.discover(capabilityId, inputs, context);

    if (candidates.length === 0) {
      if (allSupporting.length > 0 || CONNECTOR_REQUIRED.has(capabilityId)) {
        throw new Error(`No eligible trusted connector for ${capabilityId}; execution was not simulated`);
      }
      return this.fallback.invoke(capabilityId, inputs, context);
    }

    if (capabilityId === DNA_PRIMITIVES.SEARCH && scopes.length > 1) {
      return this.executeFederatedSearch(candidates, scopes, inputs, context);
    }

    let lastError: unknown;
    for (const candidate of candidates) {
      try {
        const action = await this.beginExternalAction(candidate.connector, capabilityId, inputs, context);
        const result = await candidate.connector.execute(inputs, context);
        if (action && this.actions) {
          await this.actions.transition(action.id, ["executing"], {
            status: "succeeded",
            providerReference: candidate.connector.providerReference?.(result),
            resultDigest: this.digest(result),
            errorCode: undefined,
          });
        }
        this.connectors.recordSuccess(candidate.connector.manifest.id);
        return {
          result,
          provenance: {
            connectorId: candidate.connector.manifest.id,
            provider: candidate.connector.manifest.provider,
            scope: candidate.connector.manifest.scopes,
            trust: candidate.connector.manifest.trust,
            score: candidate.score,
            reasons: candidate.reasons,
          },
        };
      } catch (error) {
        this.connectors.recordFailure(candidate.connector.manifest.id, error);
        await this.finishFailedExternalAction(candidate.connector.manifest.id, context.idempotencyKey, error);
        lastError = error;
        if (!["none", "read"].includes(candidate.connector.manifest.effect)) break;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`Connector execution failed for ${capabilityId}`);
  }

  private discover(capabilityId: string, inputs: Record<string, unknown>, context: CapabilityExecutionContext) {
    const scopes = this.readScopes(inputs);
    const allowExternalData = inputs.consent === "user_requested_analysis" || inputs.allowExternalData === true;
    return this.connectors.discover({
      capabilityId,
      preferredScopes: scopes,
      grantedPermissions: Array.isArray(inputs.connectorPermissions)
        ? inputs.connectorPermissions.filter((item): item is string => typeof item === "string")
        : [],
      minimumTrustScore: 0.7,
      approvalGranted: Boolean(context.approvalId),
      allowExternalData,
    });
  }

  private async executeFederatedSearch(
    candidates: ReturnType<RuntimeConnectorRegistry["discover"]>,
    scopes: ConnectorScope[],
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<unknown> {
    const selected = scopes.flatMap((scope) => {
      const candidate = candidates.find((item) => item.connector.manifest.scopes.includes(scope));
      return candidate ? [candidate] : [];
    }).filter((candidate, index, all) =>
      all.findIndex((item) => item.connector.manifest.id === candidate.connector.manifest.id) === index,
    );
    const settled = await Promise.allSettled(selected.map(async (candidate) => {
      try {
        const result = await candidate.connector.execute(inputs, context);
        this.connectors.recordSuccess(candidate.connector.manifest.id);
        return { candidate, result };
      } catch (error) {
        this.connectors.recordFailure(candidate.connector.manifest.id, error);
        throw error;
      }
    }));
    const successes = settled.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
    if (successes.length === 0) throw new Error("All eligible search connectors failed");

    const items = successes.flatMap(({ result }) => {
      if (!result || typeof result !== "object") return [];
      const record = result as Record<string, unknown>;
      const values = Array.isArray(record.items) ? record.items : Array.isArray(record.results) ? record.results : [];
      return values;
    });
    return {
      result: {
        items,
        total: items.length,
        partial: successes.length < selected.length,
      },
      provenance: successes.map(({ candidate }) => ({
        connectorId: candidate.connector.manifest.id,
        provider: candidate.connector.manifest.provider,
        scope: candidate.connector.manifest.scopes,
        trust: candidate.connector.manifest.trust,
        score: candidate.score,
      })),
    };
  }

  private readScopes(inputs: Record<string, unknown>): ConnectorScope[] {
    const raw = inputs.connectorScopes ?? inputs.searchScopes ?? inputs.searchScope;
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const declared = values.flatMap((value) => {
      const parsed = ConnectorScopeSchema.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
    const provenance = this.provenanceScopes(inputs);
    if (provenance.length === 0) return declared;
    const narrowed = declared.filter((scope) => provenance.includes(scope));
    return narrowed.length > 0 ? narrowed : declared;
  }

  private provenanceScopes(value: unknown): ConnectorScope[] {
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    if (record.provenance !== undefined) return this.scopesInsideProvenance(record.provenance);
    return Object.values(record).flatMap((item) => this.provenanceScopes(item));
  }

  private scopesInsideProvenance(value: unknown): ConnectorScope[] {
    if (Array.isArray(value)) return [...new Set(value.flatMap((item) => this.scopesInsideProvenance(item)))];
    if (!value || typeof value !== "object") return [];
    const record = value as Record<string, unknown>;
    const raw = record.scope;
    const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const direct = values.flatMap((item) => {
      const parsed = ConnectorScopeSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
    return [...new Set([...direct, ...Object.values(record).flatMap((item) => this.scopesInsideProvenance(item))])];
  }

  private async beginExternalAction(
    connector: ReturnType<RuntimeConnectorRegistry["list"]>[number],
    capabilityId: string,
    inputs: Record<string, unknown>,
    context: CapabilityExecutionContext,
  ): Promise<ExternalActionRecord | undefined> {
    if (!this.actions || ["none", "read"].includes(connector.manifest.effect)) return undefined;
    const action = await this.actions.begin({
      connectorId: connector.manifest.id,
      capabilityId,
      effect: connector.manifest.effect,
      taskId: context.taskId,
      userId: context.userId,
      planId: context.planId,
      worldId: context.worldId,
      stepId: context.stepId,
      idempotencyKey: context.idempotencyKey,
      approvalId: context.approvalId,
      inputDigest: this.digest(inputs),
      reconciliationData: connector.reconciliationData?.(inputs, context) ?? {},
    });
    if (action.status === "succeeded") {
      throw Object.assign(new Error(`External action ${action.id} already succeeded`), { outcomeUncertain: true, countsTowardCircuit: false });
    }
    if (["executing", "uncertain", "reconciling", "manual_review"].includes(action.status)) {
      throw Object.assign(new Error(`External action ${action.id} requires reconciliation`), { outcomeUncertain: true, countsTowardCircuit: false });
    }
    if (action.status === "failed") throw Object.assign(new Error(`External action ${action.id} already failed definitively`), { countsTowardCircuit: false });
    return this.actions.transition(action.id, ["prepared"], { status: "executing" });
  }

  private async finishFailedExternalAction(connectorId: string, idempotencyKey: string, error: unknown): Promise<void> {
    if (!this.actions) return;
    const id = createHash("sha256").update(`${connectorId}:${idempotencyKey}`).digest("hex");
    const action = await this.actions.get(id);
    if (!action || action.status !== "executing") return;
    const uncertain = Boolean(error && typeof error === "object" && "outcomeUncertain" in error &&
      (error as { outcomeUncertain?: unknown }).outcomeUncertain === true);
    await this.actions.transition(id, ["executing"], {
      status: uncertain ? "uncertain" : "failed",
      errorCode: uncertain ? "outcome_uncertain" : "connector_rejected",
      nextReconcileAt: uncertain ? new Date(Date.now() + 30_000).toISOString() : undefined,
    });
  }

  private digest(value: unknown): string {
    return createHash("sha256").update(this.canonicalize(value)).digest("hex");
  }

  private canonicalize(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map((item) => this.canonicalize(item)).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => `${JSON.stringify(key)}:${this.canonicalize(item)}`).join(",")}}`;
    }
    return JSON.stringify(value);
  }
}
