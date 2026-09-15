export interface RuntimeApprovalStep {
  id: string;
  name: string;
  risk: string;
  requiresApproval?: boolean;
}

/** Returns the first side-effect boundary that must be resumed by the user. */
export function findRuntimeApprovalBoundary<T extends RuntimeApprovalStep>(steps: T[]): T | undefined {
  return steps.find((step) => step.requiresApproval === true);
}
