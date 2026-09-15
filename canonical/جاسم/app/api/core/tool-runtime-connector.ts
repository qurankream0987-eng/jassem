import type {
  ConnectorExecutionContext,
  RuntimeConnector,
  RuntimeConnectorManifest,
} from "@contracts/runtime-connector";

interface ToolRecord { id: number; name: string }
interface ToolRuntimePort {
  list(): Promise<ToolRecord[]>;
  invoke(
    toolId: number,
    inputs: Record<string, unknown>,
    context: {
      taskId: string;
      stepId: string;
      userId: string;
      correlationId: string;
      metadata: Record<string, unknown>;
    },
  ): Promise<{ success: boolean; output: unknown; error?: string }>;
}

export class ToolRuntimeConnector implements RuntimeConnector {
  constructor(
    readonly manifest: RuntimeConnectorManifest,
    private readonly toolRuntime: ToolRuntimePort,
    private readonly toolName: string,
    private readonly mapInputs: (inputs: Record<string, unknown>) => Record<string, unknown>,
  ) {}

  async execute(inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    const tools = await this.toolRuntime.list();
    const tool = tools.find((candidate) => candidate.name === this.toolName);
    if (!tool) throw new Error(`Tool ${this.toolName} is not registered`);
    const result = await this.toolRuntime.invoke(tool.id, this.mapInputs(inputs), {
      taskId: String(context.taskId),
      stepId: context.stepId,
      userId: String(context.userId),
      correlationId: context.idempotencyKey.slice(0, 36),
      metadata: {
        planId: context.planId,
        worldId: context.worldId,
        approvalId: context.approvalId,
        connectorId: this.manifest.id,
        idempotencyKey: context.idempotencyKey,
      },
    });
    if (!result.success) throw new Error(result.error ?? `Tool ${this.toolName} failed`);
    return result.output;
  }
}

export function mapSearchInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const query = typeof inputs.query === "string"
    ? inputs.query
    : typeof inputs.subject === "string"
      ? inputs.subject
      : "";
  if (!query) throw new Error("Public search requires a textual query");
  return { query, filters: inputs.filters ?? { maxResults: 10 } };
}

export function mapVisionInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  const evidence = Array.isArray(inputs.evidence) ? inputs.evidence : [inputs.evidence];
  const attachment = evidence.find((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).url === "string") as Record<string, unknown> | undefined;
  const image = attachment?.url ?? (typeof inputs.image === "string" ? inputs.image : undefined);
  if (!image) throw new Error("Vision requires an attached image");
  return {
    image,
    prompt: `Analyze this evidence for the requested subject: ${String(inputs.subject ?? "subject")}. Describe observable facts only; do not invent provenance, authenticity or value.`,
    detail: "high",
    responseFormat: "json",
  };
}
