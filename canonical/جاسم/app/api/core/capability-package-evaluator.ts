/** Static preflight for untrusted capability packages. Never executes source. */

import { createHash, randomUUID } from "node:crypto";
import {
  CapabilityEvaluationSchema,
  type CapabilityEvaluation,
  type CapabilityPackageBundle,
  type EvaluationFinding,
} from "@contracts/capability-package";
import { capabilityPackagePayloadDigest, verifyBundleIntegrity } from "./capability-package-signing";

const DETECTORS: Array<{
  id: string;
  pattern: RegExp;
  severity: EvaluationFinding["severity"];
  category: EvaluationFinding["category"];
  message: string;
}> = [
  { id: "dynamic-eval", pattern: /\beval\s*\(|\bnew\s+Function\s*\(/, severity: "critical", category: "execution", message: "Dynamic code execution is not allowed" },
  { id: "process-spawn", pattern: /child_process|\bexecSync\s*\(|\bspawnSync\s*\(|subprocess\.|os\.system\s*\(|powershell/i, severity: "critical", category: "execution", message: "Process spawning requires a dedicated isolated runner" },
  { id: "private-key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, severity: "critical", category: "secret", message: "Private key material detected" },
  { id: "aws-key", pattern: /\bAKIA[0-9A-Z]{16}\b/, severity: "critical", category: "secret", message: "Possible AWS access key detected" },
  { id: "hardcoded-secret", pattern: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{12,}["']/i, severity: "error", category: "secret", message: "Possible hard-coded credential detected" },
];

const PERMISSION_SIGNALS: Array<{ permission: string; pattern: RegExp }> = [
  { permission: "network", pattern: /\bfetch\s*\(|https?:\/\/|axios|requests\.|websocket/i },
  { permission: "filesystem", pattern: /node:fs|from\s+["']fs["']|readFile|writeFile|pathlib|open\s*\(/i },
  { permission: "database", pattern: /mysql|postgres|sqlite|redis|mongodb|\bSELECT\b|\bINSERT\b/i },
  { permission: "payments", pattern: /stripe|payment|checkout|تحويل مالي|دفع/i },
];

export interface CapabilityPackageEvaluator {
  evaluate(bundle: CapabilityPackageBundle): Promise<CapabilityEvaluation>;
}

export class StaticCapabilityPackageEvaluator implements CapabilityPackageEvaluator {
  async evaluate(bundle: CapabilityPackageBundle): Promise<CapabilityEvaluation> {
    const findings: EvaluationFinding[] = [];
    const checks: CapabilityEvaluation["checks"] = [];

    try {
      verifyBundleIntegrity(bundle);
      checks.push({ name: "content-integrity", passed: true });
    } catch (error) {
      checks.push({ name: "content-integrity", passed: false, details: error instanceof Error ? error.message : String(error) });
      findings.push({ id: "integrity", severity: "critical", category: "integrity", message: "Package content does not match its manifest" });
    }

    if (!bundle.envelope.manifest.provenance.ownerConsent) {
      findings.push({ id: "owner-consent", severity: "error", category: "license", message: "Source ownership or permission has not been confirmed" });
    }
    if (!bundle.envelope.manifest.license) {
      findings.push({ id: "license-missing", severity: "warning", category: "license", message: "No source license was declared" });
    }

    const inputSchema = bundle.envelope.manifest.inputSchema;
    const outputSchema = bundle.envelope.manifest.outputSchema;
    const contractsPresent = Object.keys(inputSchema).length > 0 && Object.keys(outputSchema).length > 0;
    checks.push({ name: "io-contracts", passed: contractsPresent, details: contractsPresent ? undefined : "Both input and output schemas are required" });
    if (!contractsPresent) {
      findings.push({ id: "contracts-missing", severity: "error", category: "contract", message: "Input and output schemas must be defined before release" });
    }

    for (const file of bundle.contents) {
      const lines = file.content.split(/\r?\n/);
      for (const detector of DETECTORS) {
        const lineIndex = lines.findIndex((line) => detector.pattern.test(line));
        if (lineIndex >= 0) {
          findings.push({
            id: `${detector.id}:${file.path}`,
            severity: detector.severity,
            category: detector.category,
            message: detector.message,
            file: file.path,
            line: lineIndex + 1,
          });
        }
      }

      for (const signal of PERMISSION_SIGNALS) {
        if (signal.pattern.test(file.content) && !bundle.envelope.manifest.permissions.includes(signal.permission)) {
          findings.push({
            id: `permission:${signal.permission}:${file.path}`,
            severity: "error",
            category: "permission",
            message: `Detected ${signal.permission} access but the permission is not declared`,
            file: file.path,
          });
        }
      }
    }

    const blocked = findings.some((finding) => finding.severity === "critical" || finding.severity === "error");
    checks.push({ name: "static-security", passed: !blocked, details: `${findings.length} finding(s)` });

    return CapabilityEvaluationSchema.parse({
      id: `package-evaluation-${randomUUID()}`,
      packageDigest: capabilityPackagePayloadDigest(bundle),
      mode: "static",
      passed: !blocked,
      eligibleForExecutionRelease: false,
      executionPerformed: false,
      checks,
      findings,
      evaluatedAt: new Date().toISOString(),
    });
  }
}
