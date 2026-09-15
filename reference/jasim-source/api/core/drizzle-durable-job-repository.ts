import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import { runtimeJobEvents, runtimeJobs } from "@db/schema";
import { db } from "../queries/connection";
import { DurableJobEventSchema, DurableJobSchema, type DurableJob, type DurableJobEvent } from "@contracts/durable-job";
import type { DurableJobRepository } from "./durable-job-queue";

function duplicate(error: unknown): boolean {
  const record = error as { code?: string; cause?: { code?: string } };
  return record?.code === "ER_DUP_ENTRY" || record?.cause?.code === "ER_DUP_ENTRY";
}

export class DrizzleDurableJobRepository implements DurableJobRepository {
  async insert(job: DurableJob): Promise<boolean> {
    try { await db.insert(runtimeJobs).values(this.values(job)); return true; }
    catch (error) { if (duplicate(error)) return false; throw error; }
  }

  async get(id: string): Promise<DurableJob | undefined> {
    const row = await db.query.runtimeJobs.findFirst({ where: eq(runtimeJobs.id, id) });
    return row ? this.fromRow(row) : undefined;
  }

  async findByIdempotency(kind: string, idempotencyKey: string): Promise<DurableJob | undefined> {
    const row = await db.query.runtimeJobs.findFirst({ where: and(eq(runtimeJobs.kind, kind), eq(runtimeJobs.idempotencyKey, idempotencyKey)) });
    return row ? this.fromRow(row) : undefined;
  }

  async listClaimable(now: string, limit: number): Promise<DurableJob[]> {
    const rows = await db.select().from(runtimeJobs).where(and(eq(runtimeJobs.status, "queued"), lte(runtimeJobs.availableAt, new Date(now))))
      .orderBy(desc(runtimeJobs.priority), asc(runtimeJobs.createdAt)).limit(limit);
    return rows.map((row) => this.fromRow(row));
  }

  async listExpired(now: string, limit: number): Promise<DurableJob[]> {
    const rows = await db.select().from(runtimeJobs).where(and(
      inArray(runtimeJobs.status, ["claimed", "running"]),
      lte(runtimeJobs.leaseExpiresAt, new Date(now)),
    )).orderBy(asc(runtimeJobs.leaseExpiresAt)).limit(limit);
    return rows.map((row) => this.fromRow(row));
  }

  async compareAndSet(id: string, expectedRevision: number, next: DurableJob): Promise<boolean> {
    const result = await db.update(runtimeJobs).set(this.values(next)).where(and(eq(runtimeJobs.id, id), eq(runtimeJobs.revision, expectedRevision)));
    const header = Array.isArray(result) ? result[0] : result;
    const affected = (header as { affectedRows?: number } | undefined)?.affectedRows;
    if (affected !== undefined) return affected === 1;
    const current = await this.get(id);
    return current?.revision === next.revision;
  }

  async appendEvent(event: DurableJobEvent): Promise<void> {
    try {
      await db.insert(runtimeJobEvents).values({
        ...event,
        previousStatus: event.previousStatus,
        createdAt: new Date(event.createdAt),
      });
    } catch (error) { if (!duplicate(error)) throw error; }
  }

  async listEvents(jobId: string): Promise<DurableJobEvent[]> {
    const rows = await db.select().from(runtimeJobEvents).where(eq(runtimeJobEvents.jobId, jobId)).orderBy(asc(runtimeJobEvents.createdAt), asc(runtimeJobEvents.id));
    return rows.map((row) => DurableJobEventSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  private values(job: DurableJob): typeof runtimeJobs.$inferInsert {
    return {
      ...job,
      payload: job.payload,
      result: job.result,
      availableAt: new Date(job.availableAt),
      leaseExpiresAt: job.leaseExpiresAt ? new Date(job.leaseExpiresAt) : null,
      cancellationRequestedAt: job.cancellationRequestedAt ? new Date(job.cancellationRequestedAt) : null,
      createdAt: new Date(job.createdAt),
      updatedAt: new Date(job.updatedAt),
      completedAt: job.completedAt ? new Date(job.completedAt) : null,
    };
  }

  private fromRow(row: typeof runtimeJobs.$inferSelect): DurableJob {
    return DurableJobSchema.parse({
      ...row,
      payload: row.payload,
      result: row.result,
      availableAt: row.availableAt.toISOString(),
      leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
      cancellationRequestedAt: row.cancellationRequestedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    });
  }
}

