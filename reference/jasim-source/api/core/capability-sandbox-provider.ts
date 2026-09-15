/** Remote sandbox boundary. JASIM never evaluates learned source in its own process. */

import {
  CapabilityEvaluationSchema,
  type CapabilityEvaluation,
  type CapabilityPackageBundle,
  type PackageRuntime,
} from "@contracts/capability-package";
import {
  SandboxExecutionResultSchema,
  SandboxResourcePolicySchema,
  type CapabilityTestCase,
  type SandboxExecutionResult,
  type SandboxResourcePolicy,
} from "@contracts/capability-sandbox";
import type { ConnectorExecutionContext } from "@contracts/runtime-connector";
import { capabilityPackagePayloadDigest, verifyBundleIntegrity } from "./capability-package-signing";

export interface CapabilitySandboxProvider {
  readonly id: string;
  supports(runtime: PackageRuntime): boolean;
  evaluate(
    bundle: CapabilityPackageBundle,
    testCases: CapabilityTestCase[],
    policy: SandboxResourcePolicy,
  ): Promise<CapabilityEvaluation>;
  execute(
    bundle: CapabilityPackageBundle,
    inputs: Record<string, unknown>,
    context: ConnectorExecutionContext,
    policy: SandboxResourcePolicy,
  ): Promise<SandboxExecutionResult>;
}

export interface RemoteCapabilitySandboxOptions {
  baseUrl: string;
  token: string;
  providerId?: string;
  supportedRuntimes?: PackageRuntime[];
  maxResponseBytes?: number;
  allowInsecureLocalhost?: boolean;
}

export class RemoteCapabilitySandboxProvider implements CapabilitySandboxProvider {
  readonly id: string;
  private readonly baseUrl: URL;
  private readonly token: string;
  private readonly runtimes: Set<PackageRuntime>;
  private readonly maxResponseBytes: number;

  constructor(options: RemoteCapabilitySandboxOptions) {
    this.baseUrl = new URL(options.baseUrl);
    const local = ["127.0.0.1", "localhost", "::1"].includes(this.baseUrl.hostname);
    if (this.baseUrl.protocol !== "https:" && !(options.allowInsecureLocalhost && local)) {
      throw new Error("Capability sandbox URL must use HTTPS");
    }
    if (this.baseUrl.username || this.baseUrl.password || this.baseUrl.search || this.baseUrl.hash) {
      throw new Error("Capability sandbox URL cannot contain credentials, query or fragment");
    }
    if (options.token.length < 16) throw new Error("Capability sandbox token is too short");
    this.id = options.providerId ?? `remote-sandbox:${this.baseUrl.hostname}`;
    this.token = options.token;
    this.runtimes = new Set(options.supportedRuntimes ?? ["javascript", "typescript", "python", "declarative"]);
    this.maxResponseBytes = Math.min(options.maxResponseBytes ?? 1_048_576, 4_194_304);
  }

  supports(runtime: PackageRuntime): boolean {
    return this.runtimes.has(runtime);
  }

  async evaluate(bundle: CapabilityPackageBundle, testCases: CapabilityTestCase[], policy: SandboxResourcePolicy): Promise<CapabilityEvaluation> {
    verifyBundleIntegrity(bundle);
    if (testCases.length === 0) throw new Error("Isolated release evaluation requires at least one test case");
    const payloadDigest = capabilityPackagePayloadDigest(bundle);
    const response = CapabilityEvaluationSchema.parse(await this.post("v1/evaluate", {
      bundle,
      testCases,
      policy: SandboxResourcePolicySchema.parse(policy),
      expectedPackageDigest: payloadDigest,
    }, policy.timeoutMs + 2_000));
    if (response.packageDigest !== payloadDigest || response.mode !== "isolated" || response.isolationProvider !== this.id) {
      throw new Error("Sandbox evaluation identity does not match the submitted package");
    }
    return response;
  }

  async execute(
    bundle: CapabilityPackageBundle,
    inputs: Record<string, unknown>,
    context: ConnectorExecutionContext,
    policy: SandboxResourcePolicy,
  ): Promise<SandboxExecutionResult> {
    verifyBundleIntegrity(bundle);
    const payloadDigest = capabilityPackagePayloadDigest(bundle);
    const response = SandboxExecutionResultSchema.parse(await this.post("v1/execute", {
      bundle,
      inputs,
      context: {
        taskId: context.taskId,
        userId: context.userId,
        planId: context.planId,
        worldId: context.worldId,
        stepId: context.stepId,
        idempotencyKey: context.idempotencyKey,
        approvalId: context.approvalId,
      },
      policy: SandboxResourcePolicySchema.parse(policy),
      expectedPackageDigest: payloadDigest,
    }, policy.timeoutMs + 2_000));
    if (response.packageDigest !== payloadDigest) throw new Error("Sandbox executed a different package payload");
    return response;
  }

  private async post(path: string, body: unknown, timeoutMs: number): Promise<unknown> {
    const target = new URL(path, this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`));
    if (target.origin !== this.baseUrl.origin) throw new Error("Sandbox endpoint escaped its configured origin");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(target, {
        method: "POST",
        redirect: "error",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Capability sandbox rejected the request (${response.status})`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > this.maxResponseBytes) throw new Error("Capability sandbox response is too large");
      const text = await response.text();
      if (Buffer.byteLength(text, "utf8") > this.maxResponseBytes) throw new Error("Capability sandbox response is too large");
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Capability sandbox timed out");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

