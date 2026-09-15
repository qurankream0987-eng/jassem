/** Durable, domain-neutral scheduling with optimistic leases and idempotency. */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  CreateDurableJobSchema,
  DurableJobEventSchema,
  DurableJobSchema,
  TerminalDurableJobStatuses,
  type ClaimedDurableJob,
  type CreateDurableJob,
  type DurableJob,
  type DurableJobEvent,
  type DurableJobStatus,
} from "@contracts/durable-job";

export interface DurableJobRepository {
  insert(job: DurableJob): Promise<boolean>;
  get(id: string): Promise<DurableJob | undefined>;
  findByIdempotency(kind: string, idempotencyKey: string): Promise<DurableJob | undefined>;
  listClaimable(now: string, limit: number): Promise<DurableJob[]>;
  listExpired(now: string, limit: number): Promise<DurableJob[]>;
  compareAndSet(id: string, expectedRevision: number, next: DurableJob): Promise<boolean>;
  appendEvent(event: DurableJobEvent): Promise<void>;
  listEvents(jobId: string): Promise<DurableJobEvent[]>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : canonical(value)).digest("hex");
}

function copyJob(job: DurableJob): DurableJob {
  return DurableJobSchema.parse(structuredClone(job));
}

export class MemoryDurableJobRepository implements DurableJobRepository {
  private readonly jobs = new Map<string, DurableJob>();
  private readonly idempotency = new Map<string, string>();
  private readonly events = new Map<string, DurableJobEvent[]>();

  async insert(input: DurableJob): Promise<boolean> {
    const job = copyJob(input);
    const key = `${job.kind}\0${job.idempotencyKey}`;
    if (this.jobs.has(job.id) || this.idempotency.has(key)) return false;
    this.jobs.set(job.id, job);
    this.idempotency.set(key, job.id);
    return true;
  }

  async get(id: string): Promise<DurableJob | undefined> {
    const job = this.jobs.get(id);
    return job ? copyJob(job) : undefined;
  }

  async findByIdempotency(kind: string, idempotencyKey: string): Promise<DurableJob | undefined> {
    const id = this.idempotency.get(`${kind}\0${idempotencyKey}`);
    return id ? this.get(id) : undefined;
  }

  async listClaimable(now: string, limit: number): Promise<DurableJob[]> {
    return [...this.jobs.values()]
      .filter((job) => job.status === "queued" && job.availableAt <= now)
      .sort((left, right) => right.priority - left.priority || left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit).map(copyJob);
  }

  async listExpired(now: string, limit: number): Promise<DurableJob[]> {
    return [...this.jobs.values()]
      .filter((job) => (job.status === "claimed" || job.status === "running") && job.leaseExpiresAt !== null && job.leaseExpiresAt <= now)
      .sort((left, right) => (left.leaseExpiresAt ?? "").localeCompare(right.leaseExpiresAt ?? ""))
      .slice(0, limit).map(copyJob);
  }

  async compareAndSet(id: string, expectedRevision: number, input: DurableJob): Promise<boolean> {
    const current = this.jobs.get(id);
    if (!current || current.revision !== expectedRevision || input.id !== id || input.revision !== expectedRevision + 1) return false;
    this.jobs.set(id, copyJob(input));
    return true;
  }

  async appendEvent(input: DurableJobEvent): Promise<void> {
    const event = DurableJobEventSchema.parse(input);
    const list = this.events.get(event.jobId) ?? [];
    if (list.some((item) => item.id === event.id || item.eventDigest === event.eventDigest)) return;
    list.push(structuredClone(event));
    this.events.set(event.jobId, list);
  }

  async listEvents(jobId: string): Promise<DurableJobEvent[]> {
    return structuredClone(this.events.get(jobId) ?? []);
  }
}

export class DurableJobConflictError extends Error {}
export class DurableJobLeaseError extends Error {}

export interface DurableJobQueueOptions {
  repository: DurableJobRepository;
  now?: () => Date;
  defaultLeaseMs?: number;
  baseRetryDelayMs?: number;
}

export class DurableJobQueue {
  private readonly repository: DurableJobRepository;
  private readonly now: () => Date;
  private readonly defaultLeaseMs: number;
  private readonly baseRetryDelayMs: number;

  constructor(options: DurableJobQueueOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.defaultLeaseMs = Math.max(5_000, options.defaultLeaseMs ?? 60_000);
    this.baseRetryDelayMs = Math.max(100, options.baseRetryDelayMs ?? 2_000);
  }

  async create(raw: CreateDurableJob): Promise<DurableJob> {
    const input = CreateDurableJobSchema.parse(raw);
    const existing = await this.repository.findByIdempotency(input.kind, input.idempotencyKey);
    if (existing) return this.assertIdempotent(existing, input);
    const now = this.now().toISOString();
    const job: DurableJob = DurableJobSchema.parse({
      id: `job_${digest(`${input.kind}\0${input.idempotencyKey}`).slice(0, 48)}`,
      ...input,
      availableAt: input.availableAt ?? now,
      status: "queued",
      attempts: 0,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      cancellationRequestedAt: null,
      result: null,
      errorCode: null,
      errorSummary: null,
      revision: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    });
    if (!(await this.repository.insert(job))) {
      const raced = await this.repository.findByIdempotency(input.kind, input.idempotencyKey);
      if (!raced) throw new DurableJobConflictError("Job insert lost without an idempotent record");
      return this.assertIdempotent(raced, input);
    }
    await this.record(job, null, "created", input.createdBy, {});
    return job;
  }

  async get(id: string): Promise<DurableJob | undefined> { return this.repository.get(id); }
  async events(id: string): Promise<DurableJobEvent[]> { return this.repository.listEvents(id); }

  async claim(workerId: string, leaseMs = this.defaultLeaseMs): Promise<ClaimedDurableJob | undefined> {
    const now = this.now();
    for (const current of await this.repository.listClaimable(now.toISOString(), 20)) {
      const leaseToken = randomBytes(32).toString("hex");
      const next = this.next(current, {
        status: "claimed",
        attempts: current.attempts + 1,
        leaseOwner: workerId,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
        errorCode: null,
        errorSummary: null,
      });
      if (await this.repository.compareAndSet(current.id, current.revision, next)) {
        await this.record(next, current.status, "claimed", workerId, { attempt: next.attempts });
        return { job: next, leaseToken };
      }
    }
    return undefined;
  }

  async start(id: string, leaseToken: string, actor: string): Promise<DurableJob> {
    return this.transition(id, actor, "started", (current) => {
      this.assertLease(current, leaseToken, ["claimed"]);
      if (current.cancellationRequestedAt) return this.terminal(current, "cancelled", "cancel_requested", "Cancelled before execution");
      return this.next(current, { status: "running" });
    });
  }

  async heartbeat(id: string, leaseToken: string, actor: string, leaseMs = this.defaultLeaseMs): Promise<{ job: DurableJob; cancellationRequested: boolean }> {
    const job = await this.transition(id, actor, "heartbeat", (current) => {
      this.assertLease(current, leaseToken, ["claimed", "running"]);
      return this.next(current, { leaseExpiresAt: new Date(this.now().getTime() + leaseMs).toISOString() });
    });
    return { job, cancellationRequested: job.cancellationRequestedAt !== null };
  }

  async complete(id: string, leaseToken: string, actor: string, result: DurableJob["result"]): Promise<DurableJob> {
    return this.transition(id, actor, "succeeded", (current) => {
      this.assertLease(current, leaseToken, ["running"]);
      if (current.cancellationRequestedAt) return this.terminal(current, "cancelled", "cancel_requested", "Cancelled while running");
      return this.terminal({ ...current, result }, "succeeded", null, null);
    });
  }

  async fail(id: string, leaseToken: string, actor: string, code: string, summary: string, retryable = true): Promise<DurableJob> {
    return this.transition(id, actor, "failed", (current) => {
      this.assertLease(current, leaseToken, ["claimed", "running"]);
      if (current.cancellationRequestedAt) return this.terminal(current, "cancelled", "cancel_requested", "Cancelled while running");
      if (retryable && current.attempts < current.maxAttempts) {
        const delay = this.baseRetryDelayMs * (2 ** Math.max(0, current.attempts - 1));
        return this.next(current, {
          status: "queued",
          availableAt: new Date(this.now().getTime() + delay).toISOString(),
          leaseOwner: null, leaseToken: null, leaseExpiresAt: null,
          errorCode: code.slice(0, 160), errorSummary: summary.slice(0, 2000),
        });
      }
      return this.terminal(current, "failed", code, summary);
    });
  }

  async quarantine(id: string, leaseToken: string, actor: string, summary: string): Promise<DurableJob> {
    return this.transition(id, actor, "quarantined", (current) => {
      this.assertLease(current, leaseToken, ["claimed", "running"]);
      return this.terminal(current, "quarantined", "unhandled_job_kind", summary);
    });
  }

  async timeOut(id: string, leaseToken: string, actor: string): Promise<DurableJob> {
    return this.transition(id, actor, "timed_out", (current) => {
      this.assertLease(current, leaseToken, ["claimed", "running"]);
      if (current.cancellationRequestedAt) return this.terminal(current, "cancelled", "cancel_requested", "Cancelled while running");
      return this.terminal(current, "timed_out", "execution_timeout", `Execution exceeded ${current.timeoutMs}ms`);
    });
  }

  async requestCancel(id: string, actor: string): Promise<DurableJob> {
    return this.transition(id, actor, "cancel_requested", (current) => {
      if (TerminalDurableJobStatuses.has(current.status)) return current;
      const requestedAt = this.now().toISOString();
      if (current.status === "queued") return this.terminal({ ...current, cancellationRequestedAt: requestedAt }, "cancelled", "cancel_requested", "Cancelled before claim");
      return this.next(current, { cancellationRequestedAt: current.cancellationRequestedAt ?? requestedAt });
    }, true);
  }

  async recoverExpired(actor: string, limit = 100): Promise<number> {
    let recovered = 0;
    const now = this.now().toISOString();
    for (const expired of await this.repository.listExpired(now, limit)) {
      const next = expired.cancellationRequestedAt
        ? this.terminal(expired, "cancelled", "cancel_requested", "Lease expired after cancellation")
        : expired.attempts >= expired.maxAttempts
          ? this.terminal(expired, "timed_out", "lease_expired", "Worker lease expired and attempts were exhausted")
          : this.next(expired, { status: "queued", availableAt: now, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, errorCode: "lease_expired", errorSummary: "Previous worker lease expired" });
      if (await this.repository.compareAndSet(expired.id, expired.revision, next)) {
        await this.record(next, expired.status, next.status === "queued" ? "lease_recovered" : next.status === "cancelled" ? "cancelled" : "timed_out", actor, {});
        recovered += 1;
      }
    }
    return recovered;
  }

  private assertIdempotent(existing: DurableJob, input: ReturnType<typeof CreateDurableJobSchema.parse>): DurableJob {
    if (existing.payload.digest !== input.payload.digest || existing.subjectType !== input.subjectType || existing.subjectId !== input.subjectId || existing.payloadSchemaVersion !== input.payloadSchemaVersion) {
      throw new DurableJobConflictError("Idempotency key was already used for different work");
    }
    return existing;
  }

  private assertLease(job: DurableJob, token: string, statuses: DurableJobStatus[]): void {
    if (!statuses.includes(job.status) || job.leaseToken !== token || !job.leaseExpiresAt || job.leaseExpiresAt <= this.now().toISOString()) {
      throw new DurableJobLeaseError("Job lease is absent, stale or owned by another worker");
    }
  }

  private next(job: DurableJob, patch: Partial<DurableJob>): DurableJob {
    return DurableJobSchema.parse({ ...job, ...patch, revision: job.revision + 1, updatedAt: this.now().toISOString() });
  }

  private terminal(job: DurableJob, status: Extract<DurableJobStatus, "succeeded" | "failed" | "timed_out" | "cancelled" | "quarantined">, errorCode: string | null, errorSummary: string | null): DurableJob {
    return this.next(job, { status, leaseOwner: null, leaseToken: null, leaseExpiresAt: null, errorCode, errorSummary, completedAt: this.now().toISOString() });
  }

  private async transition(id: string, actor: string, eventType: DurableJobEvent["type"], mutate: (job: DurableJob) => DurableJob, allowNoop = false): Promise<DurableJob> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.repository.get(id);
      if (!current) throw new Error(`Durable job not found: ${id}`);
      const next = mutate(current);
      if (next === current || next.revision === current.revision) {
        if (allowNoop) return current;
        throw new DurableJobConflictError("Job transition produced no state change");
      }
      if (await this.repository.compareAndSet(id, current.revision, next)) {
        const effectiveType = eventType === "failed" && next.status === "queued" ? "retry_scheduled"
          : eventType === "started" && next.status === "cancelled" ? "cancelled"
          : eventType === "succeeded" && next.status === "cancelled" ? "cancelled" : eventType;
        await this.record(next, current.status, effectiveType, actor, { errorCode: next.errorCode });
        return next;
      }
    }
    throw new DurableJobConflictError("Concurrent job updates exceeded retry budget");
  }

  private async record(job: DurableJob, previousStatus: DurableJobStatus | null, type: DurableJobEvent["type"], actor: string, detail: Record<string, unknown>): Promise<void> {
    const events = await this.repository.listEvents(job.id);
    const previousEventDigest = events.at(-1)?.eventDigest ?? null;
    const createdAt = this.now().toISOString();
    const unsigned = { jobId: job.id, type, actor, previousStatus, nextStatus: job.status, detail, previousEventDigest, createdAt, revision: job.revision };
    await this.repository.appendEvent(DurableJobEventSchema.parse({
      id: `evt_${randomUUID()}`,
      ...unsigned,
      eventDigest: digest(unsigned),
    }));
  }
}
