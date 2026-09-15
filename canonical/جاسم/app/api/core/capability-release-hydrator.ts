/** Reconstruct signed bundles from content-addressed source after process restart. */

import type { CapabilityPackageBundle } from "@contracts/capability-package";
import { SignedCapabilityBindingSchema } from "@contracts/capability-sandbox";
import type { DNAArtifactStore } from "./dna-artifact-store";
import type { GenerativeDNAService } from "./generative-dna-service";
import type { CapabilityReleaseRepository } from "./capability-release-repository";
import type { SignedCapabilityBinder } from "./signed-capability-binder";

export interface CapabilityHydrationReport {
  restored: string[];
  skipped: string[];
  quarantined: Array<{ bindingId: string; reason: string }>;
}

export class CapabilityReleaseHydrator {
  private initialization?: Promise<CapabilityHydrationReport>;

  constructor(
    private readonly repository: CapabilityReleaseRepository,
    private readonly artifacts: DNAArtifactStore,
    private readonly dna: GenerativeDNAService,
    private readonly binder: SignedCapabilityBinder,
  ) {}

  initialize(): Promise<CapabilityHydrationReport> {
    if (!this.initialization) this.initialization = this.restore();
    return this.initialization;
  }

  private async restore(): Promise<CapabilityHydrationReport> {
    const report: CapabilityHydrationReport = { restored: [], skipped: [], quarantined: [] };
    for (const record of await this.repository.list()) {
      const binding = record.binding;
      if (binding.status === "disabled" || binding.status === "quarantined" || !binding.geneVersionId) {
        report.skipped.push(binding.id);
        continue;
      }
      try {
        const gene = await this.dna.getVersion(binding.geneVersionId);
        const geneRelease = gene?.proposal.specification.executionRelease;
        const releaseMatches = Boolean(geneRelease && typeof geneRelease === "object" &&
          (geneRelease as Record<string, unknown>).bindingId === binding.id &&
          (geneRelease as Record<string, unknown>).packageDigest === binding.packageDigest &&
          (geneRelease as Record<string, unknown>).capabilityId === binding.capabilityId);
        if (!gene || gene.proposal.kind !== "capability" || gene.status !== binding.status ||
          gene.lineage.candidateId !== binding.candidateId || gene.proposal.executorRef !== binding.capabilityId || !releaseMatches) {
          const disabled = SignedCapabilityBindingSchema.parse({ ...binding, status: "disabled" });
          await this.repository.updateBinding(disabled);
          report.skipped.push(binding.id);
          continue;
        }
        const sourceUri = record.envelope.manifest.provenance.sourceUri;
        if (!sourceUri.startsWith("artifact://sha256/")) throw new Error("Release source is not content addressed");
        const content = await this.artifacts.get(sourceUri);
        const file = record.envelope.manifest.files[0];
        if (!file) throw new Error("Release manifest has no source file");
        const bundle: CapabilityPackageBundle = {
          envelope: record.envelope,
          contents: [{ ...file, content }],
        };
        this.binder.hydrate(binding, bundle);
        report.restored.push(binding.id);
      } catch (error) {
        this.binder.unbind(binding.id);
        const quarantined = SignedCapabilityBindingSchema.parse({
          ...binding,
          status: "quarantined",
          failures: binding.failures + 1,
          safetyIncidents: binding.safetyIncidents + 1,
        });
        await this.repository.updateBinding(quarantined);
        report.quarantined.push({ bindingId: binding.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    return report;
  }
}
