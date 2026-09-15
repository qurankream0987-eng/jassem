/** Generic worker. Only reviewed handlers bind an open job kind to execution. */
import type { DurableJob, DurableJobKind } from "@contracts/durable-job";
import type { ImmutableArtifact } from "@contracts/immutable-artifact";
import type { ImmutableArtifactStore } from "./immutable-artifact-store";
import type { DurableJobQueue } from "./durable-job-queue";

export interface DurableJobHandlerContext {
  job: DurableJob;
  payload: Uint8Array;
  signal: AbortSignal;
  artifacts: ImmutableArtifactStore;
}

export type DurableJobHandler = (context: DurableJobHandlerContext) => Promise<ImmutableArtifact>;

export interface DurableJobWorkerOptions {
  id: string;
  queue: DurableJobQueue;
  artifacts: ImmutableArtifactStore;
  handlers: ReadonlyMap<DurableJobKind | string, DurableJobHandler>;
  leaseMs?: number;
  pollMs?: number;
  heartbeatMs?: number;
}

export class DurableJobWorker {
  private readonly leaseMs: number;
  private readonly pollMs: number;
  private readonly heartbeatMs: number;
  private stopped = false;
  private readonly options: DurableJobWorkerOptions;

  constructor(options: DurableJobWorkerOptions) {
    this.options = options;
    this.leaseMs = Math.max(5_000, options.leaseMs ?? 60_000);
    this.pollMs = Math.max(100, options.pollMs ?? 1_000);
    this.heartbeatMs = Math.max(500, Math.min(options.heartbeatMs ?? Math.floor(this.leaseMs / 3), Math.floor(this.leaseMs / 2)));
  }

  stop(): void { this.stopped = true; }

  async run(signal?: AbortSignal): Promise<void> {
    while (!this.stopped && !signal?.aborted) {
      await this.options.queue.recoverExpired(`${this.options.id}:recovery`);
      const worked = await this.runOnce();
      if (!worked) await new Promise<void>((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  async runOnce(): Promise<boolean> {
    const claim = await this.options.queue.claim(this.options.id, this.leaseMs);
    if (!claim) return false;
    const handler = this.options.handlers.get(claim.job.kind);
    if (!handler) {
      await this.options.queue.quarantine(claim.job.id, claim.leaseToken, this.options.id, `No reviewed handler is registered for ${claim.job.kind}`);
      return true;
    }

    const controller = new AbortController();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let executionTimer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    try {
      const running = await this.options.queue.start(claim.job.id, claim.leaseToken, this.options.id);
      if (running.status === "cancelled") return true;
      heartbeat = setInterval(() => {
        if (controller.signal.aborted) return;
        void this.options.queue.heartbeat(running.id, claim.leaseToken, this.options.id, this.leaseMs)
          .then((state) => { if (state.cancellationRequested) controller.abort(); })
          .catch(() => controller.abort());
      }, this.heartbeatMs);
      executionTimer = setTimeout(() => { timedOut = true; controller.abort(); }, running.timeoutMs);
      const payload = await this.options.artifacts.get(running.payload.uri);
      const aborted = new Promise<never>((_resolve, reject) => {
        const fail = () => reject(new Error(timedOut ? "Job execution timed out" : "Job execution was cancelled"));
        if (controller.signal.aborted) fail(); else controller.signal.addEventListener("abort", fail, { once: true });
      });
      const result = await Promise.race([handler({ job: running, payload, signal: controller.signal, artifacts: this.options.artifacts }), aborted]);
      await this.options.queue.complete(running.id, claim.leaseToken, this.options.id, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker failure";
      try {
        if (timedOut) await this.options.queue.timeOut(claim.job.id, claim.leaseToken, this.options.id);
        else await this.options.queue.fail(claim.job.id, claim.leaseToken, this.options.id, controller.signal.aborted ? "aborted" : "handler_failed", message, !controller.signal.aborted);
      } catch {
        // A stale worker must never overwrite a recovered job's newer lease.
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (executionTimer) clearTimeout(executionTimer);
    }
    return true;
  }
}
