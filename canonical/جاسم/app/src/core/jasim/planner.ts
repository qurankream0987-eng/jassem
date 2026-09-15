import type { DagPlan, TaskNode, ExecutionContext } from './types';

export function createPlan(name: string, nodes: TaskNode[]): DagPlan {
  const parallelGroups: Record<string, string[]> = {};
  for (const node of nodes) {
    if (node.parallelGroup) {
      if (!parallelGroups[node.parallelGroup]) {
        parallelGroups[node.parallelGroup] = [];
      }
      parallelGroups[node.parallelGroup].push(node.id);
    }
  }

  const startNode = nodes.find((n) => n.dependencies.length === 0)?.id ?? nodes[0]?.id ?? '';
  const endNodes = nodes.filter((n) => !nodes.some((other) => other.dependencies.includes(n.id))).map((n) => n.id);

  return {
    id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    nodes,
    parallelGroups,
    startNode,
    endNodes,
    status: 'draft',
    createdAt: new Date(),
  };
}

export function getNextNodes(plan: DagPlan, completedNodeIds: string[]): TaskNode[] {
  return plan.nodes.filter((node) => {
    if (node.status !== 'pending') return false;
    return node.dependencies.every((dep) => completedNodeIds.includes(dep));
  });
}

export function executeNode(node: TaskNode, context: ExecutionContext): TaskNode {
  return { ...node, status: 'running' };
}

export function completeNode(node: TaskNode, result: unknown): TaskNode {
  return { ...node, status: 'completed', result };
}

export function failNode(node: TaskNode, error: string): TaskNode {
  return { ...node, status: 'failed', error };
}

export function handleNodeFailure(node: TaskNode, plan: DagPlan): TaskNode[] {
  if (node.fallbackNode) {
    const fallback = plan.nodes.find((n) => n.id === node.fallbackNode);
    if (fallback) {
      return [{ ...fallback, status: 'pending' }];
    }
  }
  return [];
}

export function estimateCost(plan: DagPlan): number {
  return plan.nodes.reduce((sum, node) => {
    const baseCost = 0.01;
    const timeoutCost = (node.timeout / 1000) * 0.001;
    const retryCost = node.retries * 0.005;
    return sum + baseCost + timeoutCost + retryCost;
  }, 0);
}

export function isPlanComplete(plan: DagPlan): boolean {
  return plan.nodes.every((n) => n.status === 'completed' || n.status === 'failed' || n.status === 'skipped');
}

export function getPlanProgress(plan: DagPlan): number {
  const completed = plan.nodes.filter((n) => n.status === 'completed').length;
  return completed / plan.nodes.length;
}
