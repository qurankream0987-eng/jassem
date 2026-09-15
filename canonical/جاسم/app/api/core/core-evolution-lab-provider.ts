/** Remote-only asynchronous isolation boundary for kernel evolution. */
import {
  CoreLabJobReportResponseSchema,
  CoreLabJobSubmissionSchema,
  CoreLabJobViewSchema,
  type CoreLabJobView,
} from "@contracts/core-evolution-job";
import {
  CoreLabEvaluationReportSchema,
  CoreLabEvaluationRequestSchema,
  type CoreLabEvaluationReport,
  type CoreLabEvaluationRequest,
} from "@contracts/core-evolution";

export type CoreLabFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface CoreEvolutionLabProvider {
  readonly id: string;
  submit(request: CoreLabEvaluationRequest, idempotencyKey: string, actor: string): Promise<CoreLabJobView>;
  get(jobId: string): Promise<CoreLabJobView>;
  report(jobId: string, request: CoreLabEvaluationRequest): Promise<CoreLabEvaluationReport>;
  cancel(jobId: string, actor: string): Promise<CoreLabJobView>;
}
export interface RemoteCoreEvolutionLabOptions {
  baseUrl: string;
  token: string;
  providerId?: string;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  allowInsecureLocalhost?: boolean;
  fetchImpl?: CoreLabFetch;
}

export class RemoteCoreEvolutionLabProvider implements CoreEvolutionLabProvider {
  readonly id: string;
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly maxResponseBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: CoreLabFetch;

  constructor(options: RemoteCoreEvolutionLabOptions) {
    this.baseUrl = new URL(options.baseUrl);
    const local = ["127.0.0.1", "localhost", "::1"].includes(this.baseUrl.hostname);
    if (this.baseUrl.protocol !== "https:" && !(options.allowInsecureLocalhost && local)) throw new Error("Core Evolution Lab URL must use HTTPS");
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash) throw new Error("Core Evolution Lab URL cannot contain credentials, query or fragment");
    if (options.token.length < 24) throw new Error("Core Evolution Lab token is too short");
    this.id = options.providerId ?? `core-lab:${this.baseUrl.hostname}`;
    this.token = options.token;
    this.maxResponseBytes = Math.min(options.maxResponseBytes ?? 4_194_304, 16_777_216);
    this.requestTimeoutMs = Math.min(Math.max(options.requestTimeoutMs ?? 10_000, 1_000), 30_000);
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async submit(input: CoreLabEvaluationRequest, idempotencyKey: string, actor: string): Promise<CoreLabJobView> {
    const request = CoreLabEvaluationRequestSchema.parse(input);
    const response = await this.request("v1/core-evolution-jobs", "POST", request, { "idempotency-key": idempotencyKey, "x-jasim-actor": actor });
    const job = CoreLabJobSubmissionSchema.parse(response).job;
    if (job.candidateId !== request.candidateId) throw new Error("Core lab accepted a job for a different candidate");
    return job;
  }

  async get(jobId: string): Promise<CoreLabJobView> {
    return CoreLabJobSubmissionSchema.parse(await this.request(`v1/core-evolution-jobs/${encodeURIComponent(jobId)}`, "GET")).job;
  }

  async report(jobId: string, input: CoreLabEvaluationRequest): Promise<CoreLabEvaluationReport> {
    const request = CoreLabEvaluationRequestSchema.parse(input);
    const parsed = CoreLabJobReportResponseSchema.parse(await this.request(`v1/core-evolution-jobs/${encodeURIComponent(jobId)}/report`, "GET"));
    const report = CoreLabEvaluationReportSchema.parse(parsed.report);
    this.verifyReport(request, report);
    return report;
  }

  async cancel(jobId: string, actor: string): Promise<CoreLabJobView> {
    return CoreLabJobSubmissionSchema.parse(await this.request(`v1/core-evolution-jobs/${encodeURIComponent(jobId)}/cancel`, "POST", undefined, { "x-jasim-actor": actor })).job;
  }

  private verifyReport(request: CoreLabEvaluationRequest, report: CoreLabEvaluationReport): void {
    if (report.mode !== "isolated" || report.isolationProvider !== this.id) throw new Error("Core lab report did not come from the configured isolated provider");
    if (report.candidateId !== request.candidateId || report.baselineId !== request.baselineId) throw new Error("Core lab report identity does not match the submitted candidate");
    if (report.sourceDigest !== request.expectedSourceDigest || report.baselineKernelDigest !== request.expectedKernelDigest) throw new Error("Core lab evaluated different source or baseline content");
    const expected = [...request.replayFixtures].sort((a, b) => a.id.localeCompare(b.id));
    const actual = report.replayCases.map(({ candidate: _candidate, ...fixture }) => fixture).sort((a, b) => a.id.localeCompare(b.id));
    if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Core lab replay fixtures do not match the requested suite");
  }

  private async request(endpoint: string, method: "GET" | "POST", body?: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    const base = this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`);
    const target = new URL(endpoint, base);
    if (target.origin !== this.baseUrl.origin) throw new Error("Core lab endpoint escaped its configured origin");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(target, {
        method, redirect: "error", signal: controller.signal,
        headers: { authorization: `Bearer ${this.token}`, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }), ...extraHeaders },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new Error(`Core Evolution Lab rejected the request (${response.status})`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > this.maxResponseBytes) throw new Error("Core Evolution Lab response is too large");
      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > this.maxResponseBytes) throw new Error("Core Evolution Lab response is too large");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Core Evolution Lab control request timed out");
      throw error;
    } finally { clearTimeout(timer); }
  }
}

