/** Verify, bind and execute learned capabilities without loading source into JASIM. */

import { createHash, type KeyLike } from "node:crypto";
import {
  SignedCapabilityBindingSchema,
  SandboxResourcePolicySchema,
  type SignedCapabilityBinding,
  type SandboxResourcePolicy,
} from "@contracts/capability-sandbox";
import type { CapabilityPackageBundle } from "@contracts/capability-package";
import type { ConnectorExecutionContext, RuntimeConnector } from "@contracts/runtime-connector";
import {
  CapabilityPackageSigner,
  capabilityPackageDigest,
  capabilityPackagePayloadDigest,
  verifyBundleIntegrity,
} from "./capability-package-signing";
import type { CapabilitySandboxProvider } from "./capability-sandbox-provider";
import { assertJsonContract, assertSupportedJsonSchema } from "./json-schema-contract";
import type { RuntimeConnectorRegistry } from "./runtime-connector-registry";

type TrustedKey = KeyLike | string | Buffer;

export interface CapabilityReleaseKeyStore {
  get(keyId: string): TrustedKey | undefined;
}

export interface CapabilityBindingStateSink {
  updateBinding(binding: SignedCapabilityBinding): Promise<void>;
}

export class StaticCapabilityReleaseKeyStore implements CapabilityReleaseKeyStore {
  constructor(private readonly keys: Readonly<Record<string, TrustedKey>>) {}
  get(keyId: string): TrustedKey | undefined { return this.keys[keyId]; }
}

export interface BindSignedCapabilityInput {
  bundle: CapabilityPackageBundle;
  capabilityId: string;
  createdBy: string;
  status?: "canary" | "active";
  resourcePolicy?: Partial<SandboxResourcePolicy>;
}

export class SignedCapabilityBinder {
  private readonly bindings = new Map<string, SignedCapabilityBinding>();
  private readonly bundles = new Map<string, CapabilityPackageBundle>();
  private readonly signer = new CapabilityPackageSigner();

  constructor(
    private readonly keys: CapabilityReleaseKeyStore,
    private readonly sandbox: CapabilitySandboxProvider,
    private readonly connectors: RuntimeConnectorRegistry,
    private readonly stateSink?: CapabilityBindingStateSink,
  ) {}

  bind(input: BindSignedCapabilityInput): SignedCapabilityBinding {
    const { bundle } = input;
    verifyBundleIntegrity(bundle);
    const manifest = bundle.envelope.manifest;
    const evaluation = bundle.envelope.evaluation;
    const signature = bundle.envelope.signature;
    if (!signature || signature.scope !== "execution_release") throw new Error("Package has no execution-release signature");
    const publicKey = this.keys.get(signature.keyId);
    if (!publicKey || !this.signer.verify(bundle, publicKey)) throw new Error("Package execution-release signature is not trusted");
    const payloadDigest = capabilityPackagePayloadDigest(bundle);
    if (!evaluation?.passed || evaluation.mode !== "isolated" || !evaluation.executionPerformed ||
      !evaluation.eligibleForExecutionRelease || evaluation.packageDigest !== payloadDigest) {
      throw new Error("Package has no matching passing isolated evaluation");
    }
    if (evaluation.checks.some((check) => !check.passed) ||
      evaluation.findings.some((finding) => finding.severity === "error" || finding.severity === "critical")) {
      throw new Error("Package isolated evaluation contains blocking findings");
    }
    if (evaluation.isolationProvider !== this.sandbox.id) throw new Error("Package was evaluated by a different isolation provider");
    if (!this.sandbox.supports(manifest.runtime)) throw new Error(`Sandbox does not support ${manifest.runtime}`);
    if (manifest.permissions.length > 0) {
      throw new Error("Learned packages are pure compute; external effects must use mediated JASIM connectors");
    }
    if (manifest.dependencies.length > 0) throw new Error("Learned packages must be self-contained before execution release");
    const entrypoint = manifest.files.find((file) => file.path === manifest.entrypoint);
    if (manifest.files.length !== 1 || !entrypoint || entrypoint.digest !== manifest.sourceDigest) {
      throw new Error("Learned package must contain exactly its reviewed content-addressed source");
    }
    if (!/^package:[a-zA-Z0-9._-]{2,160}$/.test(input.capabilityId)) throw new Error("Learned capability ID must use the package namespace");
    assertSupportedJsonSchema(manifest.inputSchema, "$inputSchema");
    assertSupportedJsonSchema(manifest.outputSchema, "$outputSchema");
    if (manifest.inputSchema.type !== "object" || manifest.inputSchema.additionalProperties !== false) {
      throw new Error("Learned capability input contract must be a closed object schema");
    }
    if (typeof manifest.outputSchema.type !== "string" ||
      (manifest.outputSchema.type === "object" && manifest.outputSchema.additionalProperties !== false)) {
      throw new Error("Learned capability output contract must declare a closed type");
    }

    const packageDigest = capabilityPackageDigest(bundle);
    const resourcePolicy = SandboxResourcePolicySchema.parse(input.resourcePolicy ?? {});
    const binding = SignedCapabilityBindingSchema.parse({
      id: `binding-${createHash("sha256").update(`${input.capabilityId}:${packageDigest}`).digest("hex").slice(0, 24)}`,
      packageId: manifest.packageId,
      packageVersion: manifest.version,
      packageDigest,
      payloadDigest,
      sourceDigest: manifest.sourceDigest,
      candidateId: manifest.candidateId,
      capabilityId: input.capabilityId,
      runtime: manifest.runtime,
      sandboxProvider: this.sandbox.id,
      signingKeyId: signature.keyId,
      status: input.status ?? "canary",
      resourcePolicy,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      executions: 0,
      failures: 0,
      safetyIncidents: 0,
    });
    const existing = this.bindings.get(binding.id);
    if (existing && existing.packageDigest !== packageDigest) throw new Error("Capability binding ID collision");
    this.bindings.set(binding.id, binding);
    this.bundles.set(binding.id, structuredClone(bundle));
    this.register(binding);
    return structuredClone(binding);
  }

  /** Restore a durable release only after re-running every signature and policy check. */
  hydrate(bindingInput: SignedCapabilityBinding, bundle: CapabilityPackageBundle): SignedCapabilityBinding {
    const binding = SignedCapabilityBindingSchema.parse(bindingInput);
    if (binding.status !== "active" && binding.status !== "canary") {
      throw new Error("Only executable release bindings can be hydrated");
    }
    const rebuilt = this.bind({
      bundle,
      capabilityId: binding.capabilityId,
      createdBy: binding.createdBy,
      status: binding.status,
      resourcePolicy: binding.resourcePolicy,
    });
    const identityMatches = rebuilt.id === binding.id && rebuilt.packageDigest === binding.packageDigest &&
      rebuilt.payloadDigest === binding.payloadDigest && rebuilt.sourceDigest === binding.sourceDigest &&
      rebuilt.candidateId === binding.candidateId && rebuilt.packageId === binding.packageId &&
      rebuilt.packageVersion === binding.packageVersion && rebuilt.sandboxProvider === binding.sandboxProvider &&
      rebuilt.signingKeyId === binding.signingKeyId;
    if (!identityMatches) {
      this.unbind(rebuilt.id);
      throw new Error("Durable capability release identity does not match its signed package");
    }
    this.bindings.set(binding.id, binding);
    this.bundles.set(binding.id, structuredClone(bundle));
    this.register(binding);
    return structuredClone(binding);
  }

  get(bindingId: string): SignedCapabilityBinding | undefined {
    const binding = this.bindings.get(bindingId);
    return binding ? structuredClone(binding) : undefined;
  }

  attachGeneVersion(bindingId: string, geneVersionId: string): SignedCapabilityBinding {
    const binding = this.require(bindingId);
    const updated = SignedCapabilityBindingSchema.parse({ ...binding, geneVersionId });
    this.bindings.set(bindingId, updated);
    return structuredClone(updated);
  }

  promote(bindingId: string): SignedCapabilityBinding {
    const binding = this.require(bindingId);
    if (binding.status !== "canary") throw new Error("Only a canary capability binding can be promoted");
    const updated = { ...binding, status: "active" as const };
    this.bindings.set(bindingId, updated);
    this.register(updated);
    return structuredClone(updated);
  }

  disable(bindingId: string): SignedCapabilityBinding {
    const binding = this.require(bindingId);
    const updated = { ...binding, status: "disabled" as const };
    this.bindings.set(bindingId, updated);
    this.register(updated);
    return structuredClone(updated);
  }

  unbind(bindingId: string): void {
    const binding = this.bindings.get(bindingId);
    if (binding) this.connectors.unregister(this.connectorId(binding));
    this.bindings.delete(bindingId);
    this.bundles.delete(bindingId);
  }

  async invoke(bindingId: string, inputs: Record<string, unknown>, context: ConnectorExecutionContext): Promise<unknown> {
    let binding = this.require(bindingId);
    if (binding.status !== "active" && binding.status !== "canary") throw new Error("Capability binding is not executable");
    const bundle = this.bundles.get(bindingId);
    if (!bundle) throw new Error("Signed capability payload is unavailable");
    await this.verifyStillTrusted(binding, bundle);
    assertJsonContract(inputs, bundle.envelope.manifest.inputSchema, "$input");
    const result = await this.sandbox.execute(bundle, inputs, context, binding.resourcePolicy);
    const now = new Date().toISOString();
    if (result.status !== "success") {
      const safetyIncident = result.status === "policy_violation" ? 1 : 0;
      binding = SignedCapabilityBindingSchema.parse({
        ...binding,
        status: safetyIncident ? "quarantined" : binding.status,
        executions: binding.executions + 1,
        failures: binding.failures + 1,
        safetyIncidents: binding.safetyIncidents + safetyIncident,
        lastExecutedAt: now,
      });
      this.bindings.set(bindingId, binding);
      if (safetyIncident) this.register(binding);
      await this.persist(binding);
      throw new Error(result.errorMessage ?? `Sandbox execution failed: ${result.status}`);
    }
    const outputBytes = Buffer.byteLength(JSON.stringify(result.output ?? null), "utf8");
    if (result.metrics.outputBytes !== outputBytes || outputBytes > binding.resourcePolicy.maxOutputBytes) {
      const quarantined = this.quarantine(binding, now);
      await this.persist(quarantined);
      throw new Error("Sandbox output violated the signed resource policy");
    }
    try {
      assertJsonContract(result.output, bundle.envelope.manifest.outputSchema, "$output");
    } catch (error) {
      const quarantined = this.quarantine(binding, now);
      await this.persist(quarantined);
      throw error;
    }
    const updated = SignedCapabilityBindingSchema.parse({ ...binding, executions: binding.executions + 1, lastExecutedAt: now });
    this.bindings.set(bindingId, updated);
    await this.persist(updated);
    return result.output;
  }

  private async verifyStillTrusted(binding: SignedCapabilityBinding, bundle: CapabilityPackageBundle): Promise<void> {
    const signature = bundle.envelope.signature;
    const publicKey = signature ? this.keys.get(signature.keyId) : undefined;
    if (!signature || signature.scope !== "execution_release" || !publicKey || !this.signer.verify(bundle, publicKey) ||
      capabilityPackageDigest(bundle) !== binding.packageDigest || capabilityPackagePayloadDigest(bundle) !== binding.payloadDigest) {
      const quarantined = this.quarantine(binding, new Date().toISOString());
      await this.persist(quarantined);
      throw new Error("Capability release changed or is no longer trusted");
    }
  }

  private quarantine(binding: SignedCapabilityBinding, now: string): SignedCapabilityBinding {
    const updated = SignedCapabilityBindingSchema.parse({
      ...binding,
      status: "quarantined",
      failures: binding.failures + 1,
      safetyIncidents: binding.safetyIncidents + 1,
      lastExecutedAt: now,
    });
    this.bindings.set(binding.id, updated);
    this.register(updated);
    return updated;
  }

  private async persist(binding: SignedCapabilityBinding): Promise<void> {
    if (this.stateSink) await this.stateSink.updateBinding(binding);
  }

  private register(binding: SignedCapabilityBinding): void {
    const id = this.connectorId(binding);
    this.connectors.unregister(id);
    const connector: RuntimeConnector = {
      manifest: {
        id,
        name: `Signed learned capability: ${binding.packageId}`,
        version: binding.packageVersion,
        provider: binding.sandboxProvider,
        capabilities: [binding.capabilityId],
        scopes: ["jasim_internal"],
        effect: "none",
        requiredPermissions: [],
        trust: { level: "verified", score: 0.96 },
        health: { status: binding.status === "quarantined" ? "offline" : "healthy", checkedAt: new Date().toISOString() },
        sendsUserDataExternally: false,
        enabled: binding.status === "active",
        priority: 85,
        estimatedLatencyMs: binding.resourcePolicy.timeoutMs,
        costClass: "low",
      },
      execute: (inputs, context) => this.invoke(binding.id, inputs, context),
    };
    this.connectors.register(connector);
  }

  private connectorId(binding: SignedCapabilityBinding): string { return `jasim.signed.${binding.id}`; }

  private require(bindingId: string): SignedCapabilityBinding {
    const binding = this.bindings.get(bindingId);
    if (!binding) throw new Error("Signed capability binding not found");
    return binding;
  }
}
