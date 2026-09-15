export interface AgentType {
  id: string;
  name: string;
  category: 'human' | 'ai' | 'hybrid' | 'system';
  specialization: string[];
  autonomyLevel: number;
  learningRate: number;
  memoryCapacity: number;
}

export const AGENT_TYPES: AgentType[] = [
  {
    id: 'human_agent',
    name: 'Human Agent',
    category: 'human',
    specialization: ['negotiation', 'creative', 'emotional'],
    autonomyLevel: 1.0,
    learningRate: 0.3,
    memoryCapacity: 100,
  },
  {
    id: 'ai_agent',
    name: 'AI Agent',
    category: 'ai',
    specialization: ['analysis', 'prediction', 'optimization'],
    autonomyLevel: 0.8,
    learningRate: 0.9,
    memoryCapacity: 10000,
  },
  {
    id: 'hybrid_agent',
    name: 'Hybrid Agent',
    category: 'hybrid',
    specialization: ['analysis', 'negotiation', 'optimization', 'creative'],
    autonomyLevel: 0.9,
    learningRate: 0.7,
    memoryCapacity: 1000,
  },
  {
    id: 'system_agent',
    name: 'System Agent',
    category: 'system',
    specialization: ['monitoring', 'maintenance', 'security'],
    autonomyLevel: 0.5,
    learningRate: 0.1,
    memoryCapacity: 50000,
  },
];

export function getAgentTypeById(id: string): AgentType | undefined {
  return AGENT_TYPES.find((t) => t.id === id);
}

export function getAgentTypesByCategory(category: AgentType['category']): AgentType[] {
  return AGENT_TYPES.filter((t) => t.category === category);
}
