/**
 * JASIM Independent Execution Verifier (Phase 3)
 *
 * Verification is SEPARATE from the executor.
 * The executor produces an execution attempt; the verifier judges it.
 *
 * Strategies:
 *   INTERNAL_STATE_ASSERTION  — checks DB state after completion
 *   DATABASE_READBACK         — re-reads the node output and validates schema
 *   RECEIPT_VALIDATION        — validates receipt fields for completeness
 *   PROVIDER_LOOKUP           — (future) queries external provider for status
 *   COMPOSITE                 — applies multiple strategies and reduces result
 *
 * Verification statuses:
 *   VERIFIED     — execution succeeded, output is valid, no anomalies
 *   FAILED       — execution clearly failed or output is corrupt
 *   INCONCLUSIVE — cannot determine outcome; run must NOT be marked success
 *
 * Rule: INCONCLUSIVE must NEVER become success.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type VerificationStrategy =
  | 'INTERNAL_STATE_ASSERTION'
  | 'DATABASE_READBACK'
  | 'RECEIPT_VALIDATION'
  | 'PROVIDER_LOOKUP'
  | 'COMPOSITE';

export type VerificationStatus = 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE';

export interface VerificationInput {
  attemptId: string;
  runId: string;
  nodeId: string;
  capabilityId: string;
  executionStatus: string;
  normalizedResult?: Record<string, unknown> | null;
  normalizedError?: Record<string, unknown> | null;
  /** Idempotency key to prevent double-verification */
  idempotencyKey: string;
  /** Optional: provider reference for PROVIDER_LOOKUP strategy */
  providerReference?: string | null;
  /**
   * Undefined means a local attempt. A present value marks remote-origin data,
   * which is only verified when its independently persisted digest matches.
   */
  remoteEvidence?: { resultDigest: string; receiptSignature: string } | null;
  /** Trusted local configuration for the already-bound provider. */
  providerReceiptSecret?: string;
}

export interface VerificationResult {
  attemptId: string;
  status: VerificationStatus;
  strategy: VerificationStrategy;
  notes: string[];
  verifiedAt: Date;
}

function capabilityPayload(input: VerificationInput): Record<string, unknown> | null {
  const envelope = input.normalizedResult;
  if (!envelope || typeof envelope !== 'object') return null;
  const result = envelope.result;
  return result && typeof result === 'object' && !Array.isArray(result)
    ? result as Record<string, unknown>
    : null;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

export function canonicalResultDigest(result: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(result)).digest("hex");
}

export function verifyProviderReceipt(input: {
  resultDigest: string;
  receiptSignature: string;
  receiptSecret?: string;
}): boolean {
  if (!input.receiptSecret || !input.receiptSignature || !input.resultDigest) return false;
  const expected = createHmac("sha256", input.receiptSecret)
    .update(input.resultDigest)
    .digest("hex");
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(input.receiptSignature);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function validRemoteEvidence(input: VerificationInput): boolean {
  return (
    input.remoteEvidence !== null &&
    input.remoteEvidence !== undefined &&
    verifyProviderReceipt({
      resultDigest: input.remoteEvidence.resultDigest,
      receiptSignature: input.remoteEvidence.receiptSignature,
      receiptSecret: input.providerReceiptSecret,
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Strategy implementations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * INTERNAL_STATE_ASSERTION: verifies that executionStatus is COMPLETED
 * and that normalizedResult is a non-empty object.
 */
function verifyInternalState(input: VerificationInput): VerificationResult {
  const notes: string[] = [];
  let status: VerificationStatus;

  if (input.executionStatus === 'RUNNING') {
    notes.push('Execution is still RUNNING — cannot verify yet.');
    status = 'INCONCLUSIVE';
  } else if (input.executionStatus === 'FAILED') {
    notes.push(`Execution failed: ${JSON.stringify(input.normalizedError ?? {}).slice(0, 200)}`);
    status = 'FAILED';
  } else if (input.executionStatus !== 'COMPLETED') {
    notes.push(`Unknown execution status: "${input.executionStatus}"`);
    status = 'INCONCLUSIVE';
  } else if (!capabilityPayload(input)) {
    notes.push('COMPLETED status but canonical result envelope is absent or invalid.');
    status = 'INCONCLUSIVE';
  } else if (input.remoteEvidence !== undefined && !validRemoteEvidence(input)) {
    notes.push('Remote result lacks a valid authenticated provider receipt.');
    status = 'INCONCLUSIVE';
  } else {
    notes.push('Execution status COMPLETED with a non-null result object.');
    status = 'VERIFIED';
  }

  return { attemptId: input.attemptId, status, strategy: 'INTERNAL_STATE_ASSERTION', notes, verifiedAt: new Date() };
}

/**
 * DATABASE_READBACK: re-validates the normalizedResult schema
 * for the specific capability.
 */
function verifyDatabaseReadback(input: VerificationInput): VerificationResult {
  const notes: string[] = [];
  let status: VerificationStatus;

  const result = capabilityPayload(input);
  if (!result) {
    notes.push('No canonical result payload to readback.');
    status = 'INCONCLUSIVE';
    return { attemptId: input.attemptId, status, strategy: 'DATABASE_READBACK', notes, verifiedAt: new Date() };
  }

  // Validate capability-specific output schema
  if (input.capabilityId === 'openai-chat') {
    const hasKind = result.kind === 'openai-chat';
    const hasCompletion = typeof result.completion === 'string' && result.completion.length > 0;
    const hasUsage = result.usage && typeof result.usage === 'object';

    if (!hasKind) {
      notes.push(`Expected kind=openai-chat, got: ${JSON.stringify(result.kind)}`);
      status = 'FAILED';
    } else if (!hasCompletion) {
      notes.push('completion is empty or not a string — possible stub/error response.');
      // Not a hard failure — stub is valid in dev/missing-creds scenarios
      const isStub = String(result.completion ?? '').includes('[');
      status = isStub ? 'INCONCLUSIVE' : 'FAILED';
    } else if (!hasUsage) {
      notes.push('usage metadata absent.');
      status = 'INCONCLUSIVE';
    } else {
      notes.push(`openai-chat output valid: ${String(result.completion).slice(0, 60)}...`);
      status = 'VERIFIED';
    }
  } else if (input.capabilityId === 'web-research') {
    const sources = Array.isArray(result.sources) ? result.sources : [];
    const validSources = sources.filter((source) => {
      if (!source || typeof source !== 'object') return false;
      const candidate = source as Record<string, unknown>;
      return typeof candidate.url === 'string' && /^https?:\/\//i.test(candidate.url)
        && typeof candidate.retrievedAt === 'string'
        && candidate.trust === 'untrusted_external_evidence';
    });
    if (result.kind !== 'web-research') {
      notes.push('web-research result kind is invalid.');
      status = 'FAILED';
    } else if (validSources.length === 0) {
      notes.push('web-research has no verifiable sources.');
      status = 'INCONCLUSIVE';
    } else {
      notes.push(`web-research provenance valid for ${validSources.length} source(s).`);
      status = 'VERIFIED';
    }
  } else if (input.capabilityId === 'image-generation') {
    const images = Array.isArray(result.images) ? result.images : [];
    const validImages = images.filter((image) => {
      if (!image || typeof image !== 'object') return false;
      const candidate = image as Record<string, unknown>;
      return typeof candidate.artifactId === 'string'
        && typeof candidate.objectPath === 'string'
        && candidate.objectPath.includes('/jasim/generated/')
        && typeof candidate.sha256 === 'string'
        && typeof candidate.byteLength === 'number'
        && candidate.byteLength > 0;
    });
    if (result.kind !== 'image-generation') {
      notes.push('image-generation result kind is invalid.');
      status = 'FAILED';
    } else if (validImages.length === 0) {
      notes.push('image-generation has no durable artifact reference.');
      status = 'INCONCLUSIVE';
    } else {
      notes.push(`image-generation durable artifacts valid: ${validImages.length}.`);
      status = 'VERIFIED';
    }
  } else {
    // Generic capabilities must arrive through the canonical envelope.
    const hasContent = Object.keys(result).length > 0;
    if (input.remoteEvidence !== undefined) {
      const digestMatches =
        validRemoteEvidence(input) &&
        input.remoteEvidence!.resultDigest === canonicalResultDigest(result);
      status = hasContent && digestMatches ? 'VERIFIED' : 'INCONCLUSIVE';
      notes.push(
        !hasContent
          ? 'Generic remote capability output empty.'
          : digestMatches
            ? 'Generic remote capability output matches its persisted result digest.'
            : 'Generic remote capability output lacks matching persisted digest evidence.',
      );
    } else {
      status = hasContent ? 'VERIFIED' : 'INCONCLUSIVE';
      notes.push(hasContent ? 'Generic capability output non-empty.' : 'Generic capability output empty.');
    }
  }

  return { attemptId: input.attemptId, status, strategy: 'DATABASE_READBACK', notes, verifiedAt: new Date() };
}

/**
 * RECEIPT_VALIDATION: validates structural completeness of the attempt record.
 */
function verifyReceipt(input: VerificationInput): VerificationResult {
  const notes: string[] = [];
  const failures: string[] = [];

  if (!input.attemptId) failures.push('attemptId missing');
  if (!input.runId) failures.push('runId missing');
  if (!input.nodeId) failures.push('nodeId missing');
  if (!input.capabilityId) failures.push('capabilityId missing');
  if (!input.idempotencyKey) failures.push('idempotencyKey missing');
  // Note: RUNNING is handled as INCONCLUSIVE by INTERNAL_STATE_ASSERTION;
  // do not mark it as FAILED here — uncertain is distinct from failed.

  let status: VerificationStatus;
  if (failures.length > 0) {
    notes.push(...failures.map(f => `Missing/invalid: ${f}`));
    status = 'FAILED';
  } else {
    notes.push('All required receipt fields present.');
    status = 'VERIFIED';
  }

  return { attemptId: input.attemptId, status, strategy: 'RECEIPT_VALIDATION', notes, verifiedAt: new Date() };
}

// ─────────────────────────────────────────────────────────────────────────────
// Composite verifier (primary entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run all applicable verification strategies and reduce to a single result.
 *
 * Reduction rules:
 *   - Any FAILED  → FAILED  (hard failure wins)
 *   - Any INCONCLUSIVE (no FAILED) → INCONCLUSIVE  (uncertainty wins over VERIFIED)
 *   - All VERIFIED → VERIFIED
 *
 * INCONCLUSIVE MUST NOT be treated as success by the caller.
 */
export function verifyExecutionAttempt(input: VerificationInput): VerificationResult {
  const strategies = [
    verifyReceipt(input),
    verifyInternalState(input),
    verifyDatabaseReadback(input),
  ];

  const allNotes: string[] = strategies.flatMap(s => s.notes.map(n => `[${s.strategy}] ${n}`));

  let finalStatus: VerificationStatus = 'VERIFIED';
  for (const s of strategies) {
    if (s.status === 'FAILED') {
      finalStatus = 'FAILED';
      break;
    }
    if (s.status === 'INCONCLUSIVE') {
      finalStatus = 'INCONCLUSIVE';
    }
  }

  return {
    attemptId: input.attemptId,
    status: finalStatus,
    strategy: 'COMPOSITE',
    notes: allNotes,
    verifiedAt: new Date(),
  };
}

/**
 * Negative test helper: verify that INCONCLUSIVE never becomes success.
 * Called in proof scripts.
 */
export function assertInconclusiveIsNotSuccess(result: VerificationResult): void {
  if (result.status === 'INCONCLUSIVE') {
    // Calling code must NOT treat this as success — throw to enforce
    throw new Error(
      `[Verifier] INCONCLUSIVE result for attempt ${result.attemptId} must not be treated as success. ` +
      `Notes: ${result.notes.join('; ')}`,
    );
  }
}
