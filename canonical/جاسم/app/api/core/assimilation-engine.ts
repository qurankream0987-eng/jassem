/**
 * Safe artifact assimilation.
 *
 * Uploaded content is always treated as untrusted data. This engine extracts a
 * proposal and submits it to DNA review; it never imports, evals or executes it.
 */

import { createHash } from "node:crypto";
import {
  AssimilationArtifactSchema,
  type AssimilationArtifact,
  type AssimilationResult,
  type GeneKind,
  type GeneProposal,
  type GeneRisk,
} from "@contracts/generative-dna";
import { DNAVersionRegistry } from "./dna-version-registry";

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_EXCERPT_CHARS = 2_000;

export class AssimilationError extends Error {
  constructor(message: string, public readonly code: "ARTIFACT_TOO_LARGE" | "INVALID_ARTIFACT") {
    super(message);
    this.name = "AssimilationError";
  }
}

export class AssimilationEngine {
  constructor(private readonly registry: DNAVersionRegistry) {}

  ingest(input: AssimilationArtifact): AssimilationResult {
    const parsed = AssimilationArtifactSchema.safeParse(input);
    if (!parsed.success) {
      throw new AssimilationError(parsed.error.issues.map((issue) => issue.message).join("; "), "INVALID_ARTIFACT");
    }

    const artifact = parsed.data;
    const byteLength = Buffer.byteLength(artifact.content, "utf8");
    if (byteLength > MAX_ARTIFACT_BYTES) {
      throw new AssimilationError(
        `Artifact is ${byteLength} bytes; the safe limit is ${MAX_ARTIFACT_BYTES}`,
        "ARTIFACT_TOO_LARGE",
      );
    }

    const digest = createHash("sha256").update(artifact.content).digest("hex");
    const detectedSymbols = this.detectSymbols(artifact.content, artifact.artifactKind);
    const warnings = this.detectWarnings(artifact.content, artifact.artifactKind, artifact.ownerConsent);
    const kind = artifact.requestedKind ?? this.inferGeneKind(artifact.artifactKind, artifact.content);
    const risk = this.inferRisk(kind, artifact.content);
    const proposal = this.buildProposal(artifact, kind, risk, detectedSymbols);

    const submitted = this.registry.submitCandidate({
      proposal,
      source: {
        artifactKind: artifact.artifactKind,
        name: artifact.name,
        digest,
        submittedBy: artifact.submittedBy,
        uri: artifact.uri,
        mediaType: artifact.mediaType,
        license: artifact.license,
        ownerConsent: artifact.ownerConsent,
        receivedAt: new Date().toISOString(),
        contentIsDataOnly: true,
      },
      warnings,
    });

    return {
      candidate: submitted.candidate,
      duplicate: submitted.duplicate,
      detectedSymbols,
      warnings,
    };
  }

  private inferGeneKind(artifactKind: AssimilationArtifact["artifactKind"], content: string): GeneKind {
    if (artifactKind === "source_code" || artifactKind === "api_schema") return "capability";
    if (artifactKind === "world_dna") return "world";
    if (artifactKind === "data_schema") return "knowledge";

    const workflowSignals = /(خطوات|سير العمل|workflow|process|ثم|بعد ذلك|موافقة)/i;
    const policySignals = /(سياسة|policy|يمنع|يجب ألا|صلاحيات|authorization|compliance)/i;
    if (policySignals.test(content)) return "policy";
    if (workflowSignals.test(content)) return "workflow";
    return "knowledge";
  }

  private inferRisk(kind: GeneKind, content: string): GeneRisk {
    if (kind === "core_patch") return "critical";
    if (/(payment|دفع|تحويل مالي|delete|حذف|credential|secret|صلاحيات إدارية)/i.test(content)) return "high";
    if (kind === "capability") return "medium";
    if (kind === "policy" || kind === "workflow") return "low";
    return "none";
  }

  private buildProposal(
    artifact: ReturnType<typeof AssimilationArtifactSchema.parse>,
    kind: GeneKind,
    risk: GeneRisk,
    symbols: string[],
  ): GeneProposal {
    const normalizedName = artifact.name.replace(/\.[^.]+$/, "").trim();
    const permissions = this.inferPermissions(artifact.content);
    const executorRef = kind === "capability" ? undefined : undefined;

    return {
      kind,
      name: normalizedName || artifact.name,
      summary: this.summarize(artifact.content),
      specification: {
        artifactKind: artifact.artifactKind,
        detectedSymbols: symbols,
        excerpt: artifact.content.slice(0, MAX_EXCERPT_CHARS),
        originalDigestAlgorithm: "sha256",
        executionAllowed: false,
        reviewRequired: true,
      },
      executorRef,
      dependencies: [],
      permissions,
      risk,
      tags: ["assimilated", artifact.artifactKind, "candidate-only"],
    };
  }

  private detectSymbols(content: string, artifactKind: AssimilationArtifact["artifactKind"]): string[] {
    if (artifactKind !== "source_code" && artifactKind !== "api_schema") return [];
    const symbols = new Set<string>();
    const patterns = [
      /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
      /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
      /def\s+([A-Za-z_][\w]*)\s*\(/g,
      /class\s+([A-Za-z_][\w]*)\s*(?:\(|:)/g,
      /"\/(?:[^"\s]+)"\s*:/g,
    ];
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern)) {
        symbols.add(match[1] ?? match[0].replace(/["\s:]/g, ""));
        if (symbols.size >= 50) return [...symbols];
      }
    }
    return [...symbols];
  }

  private detectWarnings(
    content: string,
    artifactKind: AssimilationArtifact["artifactKind"],
    ownerConsent: boolean,
  ): string[] {
    const warnings = ["Artifact content was treated as untrusted data and was not executed."];
    if (/(ignore (all|any|the) previous|system prompt|developer message|تجاهل التعليمات|نفذ مباشرة)/i.test(content)) {
      warnings.push("Embedded instructions were detected and isolated as document content.");
    }
    if (artifactKind === "source_code" && !ownerConsent) {
      warnings.push("Executable activation is blocked until ownership or permission is confirmed.");
    }
    if (!ownerConsent && !content.trim().startsWith("{")) {
      warnings.push("Source ownership and licensing require human review.");
    }
    return warnings;
  }

  private inferPermissions(content: string): string[] {
    const permissions = new Set<string>();
    if (/(fetch\s*\(|http|https|requests\.|axios|websocket)/i.test(content)) permissions.add("network");
    if (/(readFile|writeFile|open\s*\(|pathlib|filesystem|ملف)/i.test(content)) permissions.add("filesystem");
    if (/(insert|update|delete|select|database|mysql|postgres|redis|قاعدة بيانات)/i.test(content)) permissions.add("database");
    if (/(payment|دفع|stripe|تحويل مالي)/i.test(content)) permissions.add("payments");
    return [...permissions];
  }

  private summarize(content: string): string {
    const compact = content.replace(/\s+/g, " ").trim();
    return compact.length <= 500 ? compact : `${compact.slice(0, 497)}...`;
  }
}



