/** Async adapter: core evolution is one reviewed handler on the generic queue. */
import {
  CORE_EVOLUTION_EVALUATION_JOB_KIND,
  CoreLabJobViewSchema,
  type CoreLabJobView,
} from "@contracts/core-evolution-job";
import {
  CoreLabEvaluationReportSchema,
  CoreLabEvaluationRequestSchema,
  type CoreLabEvaluationReport,
} from "@contracts/core-evolution";
import type { DurableJob } from "@contracts/durable-job";
import type { DurableJobQueue } from "../../api/core/durable-job-queue";
import type { DurableJobHandler } from "../../api/core/durable-job-worker";
import type { ImmutableArtifactStore } from "../../api/core/immutable-artifact-store";
import type { CoreEvolutionLabEvaluationService } from "./evaluation-service";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

export class CoreEvolutionLabJobService {
  readonly handler: DurableJobHandler;

  constructor(
    private readonly queue: DurableJobQueue,
    private readonly artifacts: ImmutableArtifactStore,
    evaluator: CoreEvolutionLabEvaluationService,
  ) {
    this.handler = async ({ job, payload, signal, artifacts }) => {
      if (job.kind !== CORE_EVOLUTION_EVALUATION_JOB_KIND) throw new Error("Core Lab handler received the wrong job kind");
      const request = CoreLabEvaluationRequestSchema.parse(JSON.parse(Buffer.from(payload).toString("utf8")));
      if (request.candidateId !== job.subjectId) throw new Error("Core Lab payload subject does not match its durable job");
      const report = await evaluator.evaluate(request, signal);
      return artifacts.put(Buffer.from(canonical(report), "utf8"), { mediaType: "application/vnd.jasim.core-evolution-report+json" });
    };
  }

  async submit(input: unknown, idempotencyKey: string, actor: string): Promise<CoreLabJobView> {
    const request = CoreLabEvaluationRequestSchema.parse(input);
    const payload = await this.artifacts.put(Buffer.from(canonical(request), "utf8"), {
      mediaType: "application/vnd.jasim.core-evolution-request+json",
    });
    const job = await this.queue.create({
      kind: CORE_EVOLUTION_EVALUATION_JOB_KIND,
      subjectType: "core_patch_candidate",
      subjectId: request.candidateId,
      payloadSchemaVersion: 1,
      payload,
      idempotencyKey,
      priority: 100,
      maxAttempts: 3,
      timeoutMs: request.policy.timeoutMs,
      createdBy: actor,
    });
    return this.view(job);
  }

  async get(id: string): Promise<CoreLabJobView | undefined> {
    const job = await this.queue.get(id);
    if (!job || job.kind !== CORE_EVOLUTION_EVALUATION_JOB_KIND) return undefined;
    return this.view(job);
  }

  async report(id: string): Promise<{ job: CoreLabJobView; report: CoreLabEvaluationReport } | undefined> {
    const job = await this.queue.get(id);
    if (!job || job.kind !== CORE_EVOLUTION_EVALUATION_JOB_KIND) return undefined;
    if (job.status !== "succeeded" || !job.result) throw new Error("Core Lab report is not ready");
    const report = CoreLabEvaluationReportSchema.parse(JSON.parse((await this.artifacts.get(job.result.uri)).toString("utf8")));
    if (report.candidateId !== job.subjectId) throw new Error("Stored Core Lab report identity mismatch");
    return { job: this.view(job), report };
  }

  async cancel(id: string, actor: string): Promise<CoreLabJobView | undefined> {
    const existing = await this.queue.get(id);
    if (!existing || existing.kind !== CORE_EVOLUTION_EVALUATION_JOB_KIND) return undefined;
    return this.view(await this.queue.requestCancel(id, actor));
  }

  private view(job: DurableJob): CoreLabJobView {
    return CoreLabJobViewSchema.parse({
      id: job.id,
      kind: job.kind,
      candidateId: job.subjectId,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      timeoutMs: job.timeoutMs,
      cancellationRequested: job.cancellationRequestedAt !== null,
      result: job.result,
      errorCode: job.errorCode,
      errorSummary: job.errorSummary,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
    });
  }
}
