/**
 * JASIM — Shared Runtime Initialization
 *
 * Lazily initializes all core runtime components as singletons.
 * Routers import from here instead of creating their own instances.
 */

import { getCytoplasm } from "./cytoplasm";
import { CapabilityRegistry } from "./capability-registry";
import { ToolRuntime } from "./tool-runtime";
import { AgentRuntime } from "./agent-runtime";
import { TaskRuntime } from "./task-runtime";
import { Planner } from "./planner";
import { CommerceRuntime } from "./commerce-runtime";
import { DNAVersionRegistry } from "./dna-version-registry";
import { AssimilationEngine } from "./assimilation-engine";
import { DrizzleDNARepository } from "./dna-repository";
import { GenerativeDNAService } from "./generative-dna-service";
import { FilesystemDNAArtifactStore } from "./dna-artifact-store";
import { CapabilityPackageBuilder } from "./capability-package";
import { StaticCapabilityPackageEvaluator } from "./capability-package-evaluator";
import { CapabilityPackageSigner } from "./capability-package-signing";
import { RemoteCapabilitySandboxProvider } from "./capability-sandbox-provider";
import { SignedCapabilityBinder, StaticCapabilityReleaseKeyStore } from "./signed-capability-binder";
import { CapabilityReleaseService } from "./capability-release-service";
import { DrizzleCapabilityReleaseRepository } from "./capability-release-repository";
import { CapabilityReleaseHydrator } from "./capability-release-hydrator";
import { GeneratedPlanExecutor } from "./generated-plan-executor";
import { CapabilityRegistryExecutionPort } from "./capability-execution-port";
import { DrizzleGeneratedExecutionStore } from "./generated-execution-store";
import { RuntimeConnectorRegistry } from "./runtime-connector-registry";
import { ConnectorAwareExecutionPort } from "./connector-aware-execution-port";
import { ToolRuntimeConnector, mapSearchInputs, mapVisionInputs } from "./tool-runtime-connector";
import {
  JasimCommitmentConnector,
  JasimFulfillmentAssignmentConnector,
  JasimInternalDiscoveryConnector,
  JasimOfferPublisherConnector,
  JasimProgressTrackingConnector,
} from "./jasim-network-connectors";
import { DrizzleJasimEntityDirectory } from "./drizzle-jasim-entity-directory";
import { DNA_PRIMITIVES } from "@contracts/jasim";
import { EnvironmentConnectorCredentialProvider } from "./connector-credentials";
import { registerConfiguredExternalConnectors } from "./configured-external-connectors";
import { CredentialReferenceSchema } from "@contracts/external-connector";
import { DrizzleExternalActionLedger } from "./drizzle-external-action-ledger";
import { ExternalActionReconciler } from "./external-action-reconciler";
import { ConnectorHealthMonitor } from "./connector-health-monitor";
import { MoyasarPaymentConnector } from "../connectors/moyasar-payment";
import { ShipdayFulfillmentConnector, ShipdayTrackingConnector } from "../connectors/shipday-fulfillment";
import {
  DrizzleGeneratedInputSecretVault,
  MemoryGeneratedInputSecretVault,
  type GeneratedInputSecretVault,
} from "./generated-input-secret-vault";
import { DrizzleExternalWebhookEventStore } from "./external-webhook-event-store";
import { ExternalWebhookRuntime } from "./external-webhook-runtime";
import { DrizzleGeneratedWorldRepository } from "./generated-world-repository";
import { GeneratedWorldService } from "./generated-world-service";
import { GeneratedWorldPersistenceConnector } from "./generated-world-connector";
import { DrizzleCoreEvolutionRepository } from "./core-evolution-repository";
import { CoreEvolutionService, DNARepositoryCorePatchSourceProvider } from "./core-evolution-service";
import { RemoteCoreEvolutionLabProvider } from "./core-evolution-lab-provider";
import { CoreEvolutionEvaluator } from "./core-evolution-evaluator";
import { KernelBaselineBuilder } from "./kernel-baseline-builder";

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton instances
// ═══════════════════════════════════════════════════════════════════════════════

let cytoplasmInstance: ReturnType<typeof getCytoplasm> | null = null;
let capabilityRegistryInstance: CapabilityRegistry | null = null;
let toolRuntimeInstance: ToolRuntime | null = null;
let agentRuntimeInstance: AgentRuntime | null = null;
let taskRuntimeInstance: TaskRuntime | null = null;
let plannerInstance: Planner | null = null;
let commerceRuntimeInstance: CommerceRuntime | null = null;
let dnaVersionRegistryInstance: DNAVersionRegistry | null = null;
let assimilationEngineInstance: AssimilationEngine | null = null;
let generativeDNAServiceInstance: GenerativeDNAService | null = null;
let dnaArtifactStoreInstance: FilesystemDNAArtifactStore | null = null;
let capabilityPackageBuilderInstance: CapabilityPackageBuilder | null = null;
let capabilityPackageEvaluatorInstance: StaticCapabilityPackageEvaluator | null = null;
let capabilityPackageSignerInstance: CapabilityPackageSigner | null = null;
let capabilitySandboxProviderInstance: RemoteCapabilitySandboxProvider | null = null;
let signedCapabilityBinderInstance: SignedCapabilityBinder | null = null;
let capabilityReleaseServiceInstance: CapabilityReleaseService | null = null;
let capabilityReleaseRepositoryInstance: DrizzleCapabilityReleaseRepository | null = null;
let capabilityReleaseHydratorInstance: CapabilityReleaseHydrator | null = null;
let generatedPlanExecutorInstance: GeneratedPlanExecutor | null = null;
let runtimeConnectorRegistryInstance: RuntimeConnectorRegistry | null = null;
let externalActionLedgerInstance: DrizzleExternalActionLedger | null = null;
let externalActionReconcilerInstance: ExternalActionReconciler | null = null;
let connectorHealthMonitorInstance: ConnectorHealthMonitor | null = null;
let generatedInputSecretVaultInstance: GeneratedInputSecretVault | null = null;
let externalWebhookEventStoreInstance: DrizzleExternalWebhookEventStore | null = null;
let externalWebhookRuntimeInstance: ExternalWebhookRuntime | null = null;
let generatedWorldServiceInstance: GeneratedWorldService | null = null;
let coreEvolutionServiceInstance: CoreEvolutionService | null = null;
let coreEvolutionEvaluatorInstance: CoreEvolutionEvaluator | null = null;
let kernelBaselineBuilderInstance: KernelBaselineBuilder | null = null;

// ═══════════════════════════════════════════════════════════════════════════════
// Lazy getters with auto-init
// ═══════════════════════════════════════════════════════════════════════════════

export function getCytoplasmInstance() {
  if (!cytoplasmInstance) {
    cytoplasmInstance = getCytoplasm();
  }
  return cytoplasmInstance;
}

export function getCapabilityRegistry() {
  if (!capabilityRegistryInstance) {
    capabilityRegistryInstance = new CapabilityRegistry();
    capabilityRegistryInstance.ensureInitialized().catch(console.error);
  }
  return capabilityRegistryInstance;
}

export function getToolRuntime() {
  if (!toolRuntimeInstance) {
    toolRuntimeInstance = new ToolRuntime();
    toolRuntimeInstance.ensureInitialized().catch(console.error);
  }
  return toolRuntimeInstance;
}

export function getAgentRuntime() {
  if (!agentRuntimeInstance) {
    agentRuntimeInstance = new AgentRuntime(
      getCytoplasmInstance(),
      getCapabilityRegistry(),
      getToolRuntime()
    );
  }
  return agentRuntimeInstance;
}

export function getTaskRuntime() {
  if (!taskRuntimeInstance) {
    taskRuntimeInstance = new TaskRuntime(
      getCytoplasmInstance(),
      getCapabilityRegistry(),
      getToolRuntime(),
      getAgentRuntime()
    );
  }
  return taskRuntimeInstance;
}

export function getPlanner() {
  if (!plannerInstance) {
    plannerInstance = new Planner(
      getCytoplasmInstance(),
      getCapabilityRegistry()
    );
  }
  return plannerInstance;
}

export function getCommerceRuntime() {
  if (!commerceRuntimeInstance) {
    commerceRuntimeInstance = new CommerceRuntime(getCytoplasmInstance());
  }
  return commerceRuntimeInstance;
}

/** Versioned, review-gated DNA accumulated by the Generative Runtime. */
export function getDNAVersionRegistry() {
  if (!dnaVersionRegistryInstance) {
    dnaVersionRegistryInstance = new DNAVersionRegistry();
  }
  return dnaVersionRegistryInstance;
}

/** Safe artifact intake. Content becomes a candidate and is never executed here. */
export function getAssimilationEngine() {
  if (!assimilationEngineInstance) {
    assimilationEngineInstance = new AssimilationEngine(getDNAVersionRegistry());
  }
  return assimilationEngineInstance;
}

/** Durable application service used by API, planners and runtime composition. */
export function getGenerativeDNAService() {
  if (!generativeDNAServiceInstance) {
    generativeDNAServiceInstance = new GenerativeDNAService(
      getDNAVersionRegistry(),
      getAssimilationEngine(),
      new DrizzleDNARepository(),
      getDNAArtifactStore(),
    );
  }
  return generativeDNAServiceInstance;
}

export function getDNAArtifactStore() {
  if (!dnaArtifactStoreInstance) {
    const root = process.env.JASIM_DNA_ARTIFACT_DIR ?? "./data/dna-artifacts";
    dnaArtifactStoreInstance = new FilesystemDNAArtifactStore(root);
  }
  return dnaArtifactStoreInstance;
}

export function getCapabilityPackageBuilder() {
  if (!capabilityPackageBuilderInstance) {
    capabilityPackageBuilderInstance = new CapabilityPackageBuilder(getDNAArtifactStore());
  }
  return capabilityPackageBuilderInstance;
}

export function getCapabilityPackageEvaluator() {
  if (!capabilityPackageEvaluatorInstance) {
    capabilityPackageEvaluatorInstance = new StaticCapabilityPackageEvaluator();
  }
  return capabilityPackageEvaluatorInstance;
}

export function getCapabilityPackageSigner() {
  if (!capabilityPackageSignerInstance) {
    capabilityPackageSignerInstance = new CapabilityPackageSigner();
  }
  return capabilityPackageSignerInstance;
}

/** Remote, OS-level isolation boundary. There is intentionally no in-process fallback. */
export function getCapabilitySandboxProvider() {
  if (!capabilitySandboxProviderInstance) {
    const baseUrl = process.env.JASIM_CAPABILITY_SANDBOX_URL;
    const token = process.env.JASIM_CAPABILITY_SANDBOX_TOKEN;
    if (!baseUrl || !token) throw new Error("Capability sandbox is not configured");
    capabilitySandboxProviderInstance = new RemoteCapabilitySandboxProvider({
      baseUrl,
      token,
      providerId: process.env.JASIM_CAPABILITY_SANDBOX_PROVIDER_ID,
      allowInsecureLocalhost: process.env.NODE_ENV !== "production",
    });
  }
  return capabilitySandboxProviderInstance;
}

export function getSignedCapabilityBinder() {
  if (!signedCapabilityBinderInstance) {
    const keyId = process.env.JASIM_PACKAGE_SIGNING_KEY_ID;
    const publicKey = process.env.JASIM_PACKAGE_SIGNING_PUBLIC_KEY?.replace(/\\n/g, "\n");
    if (!keyId || !publicKey) throw new Error("Capability release verification key is not configured");
    signedCapabilityBinderInstance = new SignedCapabilityBinder(
      new StaticCapabilityReleaseKeyStore({ [keyId]: publicKey }),
      getCapabilitySandboxProvider(),
      getRuntimeConnectorRegistry(),
      getCapabilityReleaseRepository(),
    );
  }
  return signedCapabilityBinderInstance;
}

export function getCapabilityReleaseRepository() {
  if (!capabilityReleaseRepositoryInstance) capabilityReleaseRepositoryInstance = new DrizzleCapabilityReleaseRepository();
  return capabilityReleaseRepositoryInstance;
}

export function getCapabilityReleaseService() {
  if (!capabilityReleaseServiceInstance) {
    const privateKey = process.env.JASIM_PACKAGE_SIGNING_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const keyId = process.env.JASIM_PACKAGE_SIGNING_KEY_ID;
    if (!privateKey || !keyId) throw new Error("Capability release signing key is not configured");
    capabilityReleaseServiceInstance = new CapabilityReleaseService(
      getGenerativeDNAService(),
      getCapabilityPackageBuilder(),
      getCapabilityPackageEvaluator(),
      getCapabilitySandboxProvider(),
      getCapabilityPackageSigner(),
      getSignedCapabilityBinder(),
      privateKey,
      keyId,
      getCapabilityReleaseRepository(),
    );
  }
  return capabilityReleaseServiceInstance;
}

export function getCapabilityReleaseHydrator() {
  if (!capabilityReleaseHydratorInstance) {
    capabilityReleaseHydratorInstance = new CapabilityReleaseHydrator(
      getCapabilityReleaseRepository(),
      getDNAArtifactStore(),
      getGenerativeDNAService(),
      getSignedCapabilityBinder(),
    );
  }
  return capabilityReleaseHydratorInstance;
}

/** Restores releases only when every verification and isolation dependency exists. */
export async function initializeConfiguredCapabilityReleases() {
  const configured = process.env.JASIM_CAPABILITY_SANDBOX_URL && process.env.JASIM_CAPABILITY_SANDBOX_TOKEN &&
    process.env.JASIM_PACKAGE_SIGNING_KEY_ID && process.env.JASIM_PACKAGE_SIGNING_PUBLIC_KEY;
  if (!configured) return { restored: [], skipped: [], quarantined: [] };
  return getCapabilityReleaseHydrator().initialize();
}

/** Executes generated plans with durable checkpoints, scoped approval and idempotency. */
export function getGeneratedPlanExecutor() {
  if (!generatedPlanExecutorInstance) {
    const registryPort = new CapabilityRegistryExecutionPort(getCapabilityRegistry());
    generatedPlanExecutorInstance = new GeneratedPlanExecutor(
      new ConnectorAwareExecutionPort(registryPort, getRuntimeConnectorRegistry(), getExternalActionLedger()),
      new DrizzleGeneratedExecutionStore(),
      getGeneratedInputSecretVault(),
    );
  }
  return generatedPlanExecutorInstance;
}

export function getGeneratedInputSecretVault(): GeneratedInputSecretVault {
  if (!generatedInputSecretVaultInstance) {
    const secret = process.env.APP_SECRET ?? "";
    generatedInputSecretVaultInstance = secret.length >= 16
      ? new DrizzleGeneratedInputSecretVault(secret)
      : new MemoryGeneratedInputSecretVault();
  }
  return generatedInputSecretVaultInstance;
}

export function getGeneratedWorldService(): GeneratedWorldService {
  if (!generatedWorldServiceInstance) {
    generatedWorldServiceInstance = new GeneratedWorldService(new DrizzleGeneratedWorldRepository());
  }
  return generatedWorldServiceInstance;
}

/** Separate, fail-closed lifecycle for changes to the serving kernel. */
export function getCoreEvolutionService(): CoreEvolutionService {
  if (!coreEvolutionServiceInstance) {
    const dnaRepository = new DrizzleDNARepository();
    coreEvolutionServiceInstance = new CoreEvolutionService(
      new DrizzleCoreEvolutionRepository(),
      new DNARepositoryCorePatchSourceProvider(dnaRepository),
    );
  }
  return coreEvolutionServiceInstance;
}

/** Deterministic baseline construction; callers must supply an explicit file allowlist. */
export function getKernelBaselineBuilder(): KernelBaselineBuilder {
  if (!kernelBaselineBuilderInstance) kernelBaselineBuilderInstance = new KernelBaselineBuilder();
  return kernelBaselineBuilderInstance;
}

/** Remote-only evaluator. Missing isolation configuration fails closed. */
export function getCoreEvolutionEvaluator(): CoreEvolutionEvaluator {
  if (!coreEvolutionEvaluatorInstance) {
    const baseUrl = process.env.JASIM_CORE_LAB_URL;
    const token = process.env.JASIM_CORE_LAB_TOKEN;
    if (!baseUrl || !token) throw new Error("Core Evolution Lab is not configured");
    const provider = new RemoteCoreEvolutionLabProvider({
      baseUrl,
      token,
      providerId: process.env.JASIM_CORE_LAB_PROVIDER_ID,
      allowInsecureLocalhost: process.env.NODE_ENV !== "production",
    });
    coreEvolutionEvaluatorInstance = new CoreEvolutionEvaluator(getCoreEvolutionService(), provider);
  }
  return coreEvolutionEvaluatorInstance;
}

/** Domain-free connector discovery. Connectors advertise capabilities, scope and trust. */
export function getRuntimeConnectorRegistry() {
  if (!runtimeConnectorRegistryInstance) {
    const registry = new RuntimeConnectorRegistry();
    const toolRuntime = getToolRuntime();
    const directory = new DrizzleJasimEntityDirectory();
    const credentials = new EnvironmentConnectorCredentialProvider();
    const checkedAt = new Date().toISOString();

    registry.register(new ToolRuntimeConnector({
      id: "jasim.tool.public-search.v1",
      name: "Public evidence search",
      version: "1.0.0",
      provider: "configured-search-or-duckduckgo",
      capabilities: [DNA_PRIMITIVES.SEARCH],
      scopes: ["public_web"],
      effect: "read",
      requiredPermissions: [],
      trust: { level: "reviewed", score: 0.82 },
      health: { status: "healthy", checkedAt },
      sendsUserDataExternally: true,
      enabled: true,
      priority: 70,
      estimatedLatencyMs: 2500,
      costClass: "low",
    }, toolRuntime, "search", mapSearchInputs));

    registry.register(new ToolRuntimeConnector({
      id: "jasim.tool.vision-analysis.v1",
      name: "Attached-image analysis",
      version: "1.0.0",
      provider: "configured-vision-provider",
      capabilities: [DNA_PRIMITIVES.VISION],
      scopes: ["external_partner"],
      effect: "read",
      requiredPermissions: [],
      trust: { level: "reviewed", score: 0.85 },
      health: { status: "healthy", checkedAt },
      sendsUserDataExternally: true,
      enabled: true,
      priority: 75,
      estimatedLatencyMs: 3500,
      costClass: "medium",
    }, toolRuntime, "vision_analyze", mapVisionInputs));

    registry.register(new JasimInternalDiscoveryConnector(directory));
    registry.register(new JasimOfferPublisherConnector(directory));
    registry.register(new JasimCommitmentConnector(directory));
    registry.register(new JasimFulfillmentAssignmentConnector(directory));
    registry.register(new JasimProgressTrackingConnector(directory));
    registry.register(new GeneratedWorldPersistenceConnector(getGeneratedWorldService()));
    if (process.env.JASIM_MOYASAR_SECRET_REF) {
      registry.register(new MoyasarPaymentConnector(
        CredentialReferenceSchema.parse(process.env.JASIM_MOYASAR_SECRET_REF),
        credentials,
      ));
    }
    if (process.env.JASIM_SHIPDAY_API_KEY_REF) {
      registry.register(new ShipdayFulfillmentConnector(
        CredentialReferenceSchema.parse(process.env.JASIM_SHIPDAY_API_KEY_REF),
        credentials,
      ));
      registry.register(new ShipdayTrackingConnector(
        CredentialReferenceSchema.parse(process.env.JASIM_SHIPDAY_API_KEY_REF),
        credentials,
      ));
    }
    registerConfiguredExternalConnectors(
      process.env.JASIM_EXTERNAL_CONNECTORS_JSON,
      registry,
      credentials,
    );
    runtimeConnectorRegistryInstance = registry;
  }
  return runtimeConnectorRegistryInstance;
}

export function getExternalActionLedger() {
  if (!externalActionLedgerInstance) externalActionLedgerInstance = new DrizzleExternalActionLedger();
  return externalActionLedgerInstance;
}

export function getExternalActionReconciler() {
  if (!externalActionReconcilerInstance) {
    externalActionReconcilerInstance = new ExternalActionReconciler(getExternalActionLedger(), getRuntimeConnectorRegistry());
  }
  return externalActionReconcilerInstance;
}

export function getConnectorHealthMonitor() {
  if (!connectorHealthMonitorInstance) connectorHealthMonitorInstance = new ConnectorHealthMonitor(getRuntimeConnectorRegistry());
  return connectorHealthMonitorInstance;
}

export function getExternalWebhookEventStore() {
  if (!externalWebhookEventStoreInstance) externalWebhookEventStoreInstance = new DrizzleExternalWebhookEventStore();
  return externalWebhookEventStoreInstance;
}

export function getExternalWebhookRuntime() {
  if (!externalWebhookRuntimeInstance) {
    externalWebhookRuntimeInstance = new ExternalWebhookRuntime(getExternalActionLedger(), getExternalWebhookEventStore());
  }
  return externalWebhookRuntimeInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Convenience: initialize everything eagerly (call at app startup)
// ═══════════════════════════════════════════════════════════════════════════════

export async function initializeRuntime(): Promise<void> {
  getCytoplasmInstance();
  const capReg = getCapabilityRegistry();
  const toolRun = getToolRuntime();
  await capReg.ensureInitialized();
  await toolRun.ensureInitialized();
  getAgentRuntime();
  getTaskRuntime();
  getPlanner();
  getCommerceRuntime();
  getDNAVersionRegistry();
  getAssimilationEngine();
  await getGenerativeDNAService().initialize();
  getGeneratedPlanExecutor();
  getGeneratedWorldService();
  getCoreEvolutionService();
}
