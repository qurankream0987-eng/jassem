import type { ExecutionContext, DagPlan, DnaProfile } from './types';

export function composeExecution(plan: DagPlan, profile: DnaProfile): ExecutionContext {
  return {
    id: `exec-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    planId: plan.id,
    dnaProfile: profile,
    variables: {},
    stack: [],
    results: {},
    status: 'initializing',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

export function runExecution(context: ExecutionContext): ExecutionContext {
  return { ...context, status: 'running' };
}

export function resolveHumanGate(context: ExecutionContext, approval: boolean): ExecutionContext {
  return {
    ...context,
    status: approval ? 'running' : 'failed',
    variables: { ...context.variables, humanApproval: approval },
  };
}

export function dissolveExecution(context: ExecutionContext): ExecutionContext {
  return {
    ...context,
    status: 'dissolved',
    stack: [],
    results: {},
    variables: {},
  };
}

export function setVariable(context: ExecutionContext, key: string, value: unknown): ExecutionContext {
  return {
    ...context,
    variables: { ...context.variables, [key]: value },
  };
}

export function getVariable(context: ExecutionContext, key: string): unknown {
  return context.variables[key];
}

export function pushResult(context: ExecutionContext, nodeId: string, result: unknown): ExecutionContext {
  return {
    ...context,
    results: { ...context.results, [nodeId]: result },
  };
}

export function getResult(context: ExecutionContext, nodeId: string): unknown {
  return context.results[nodeId];
}

export function isExecutionExpired(context: ExecutionContext): boolean {
  return new Date() > context.expiresAt;
}
