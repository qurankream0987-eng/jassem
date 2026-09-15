import type { VerificationStatus } from "@db/schema";

export type AttemptVerificationSnapshot = {
  nodeId: string;
  attemptNumber: number;
  verificationStatus: VerificationStatus;
};

/**
 * A node may have multiple attempts. Only the newest attempt can describe the
 * current node outcome; an old failed attempt must not poison a later verified
 * retry.
 */
export function summarizeLatestVerification(
  attempts: readonly AttemptVerificationSnapshot[],
): VerificationStatus {
  const latestByNode = new Map<string, AttemptVerificationSnapshot>();
  for (const attempt of attempts) {
    const current = latestByNode.get(attempt.nodeId);
    if (!current || attempt.attemptNumber > current.attemptNumber) {
      latestByNode.set(attempt.nodeId, attempt);
    }
  }

  const statuses = [...latestByNode.values()].map((attempt) => attempt.verificationStatus);
  if (statuses.includes("INCONCLUSIVE")) return "INCONCLUSIVE";
  if (statuses.includes("FAILED")) return "FAILED";
  if (statuses.length === 0 || statuses.includes("PENDING")) return "PENDING";
  return statuses.every((status) => status === "VERIFIED") ? "VERIFIED" : "INCONCLUSIVE";
}

export function isVerifiedReceipt(
  runStatus: string,
  completedNodes: number,
  nodeCount: number,
  verificationStatus: VerificationStatus,
): boolean {
  return (
    runStatus === "completed" &&
    nodeCount > 0 &&
    completedNodes === nodeCount &&
    verificationStatus === "VERIFIED"
  );
}