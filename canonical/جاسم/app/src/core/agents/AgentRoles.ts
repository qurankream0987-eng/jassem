export interface AgentRole {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  personality: AgentPersonality;
  dnaMarkers: number[];
}

export interface AgentPersonality {
  openness: number;
  conscientiousness: number;
  extraversion: number;
  agreeableness: number;
  neuroticism: number;
}

export const AGENT_ROLES: AgentRole[] = [
  {
    id: 'explorer',
    name: 'Explorer',
    description: 'Discovers new opportunities and platforms',
    capabilities: ['search', 'discover', 'analyze'],
    personality: { openness: 0.9, conscientiousness: 0.6, extraversion: 0.8, agreeableness: 0.7, neuroticism: 0.3 },
    dnaMarkers: [0.1, 0.8, 0.3, 0.9, 0.2],
  },
  {
    id: 'builder',
    name: 'Builder',
    description: 'Constructs and assembles platforms',
    capabilities: ['build', 'deploy', 'configure'],
    personality: { openness: 0.5, conscientiousness: 0.9, extraversion: 0.4, agreeableness: 0.6, neuroticism: 0.2 },
    dnaMarkers: [0.8, 0.2, 0.9, 0.3, 0.7],
  },
  {
    id: 'guardian',
    name: 'Guardian',
    description: 'Protects and validates transactions',
    capabilities: ['validate', 'secure', 'audit'],
    personality: { openness: 0.3, conscientiousness: 0.9, extraversion: 0.3, agreeableness: 0.7, neuroticism: 0.4 },
    dnaMarkers: [0.2, 0.9, 0.1, 0.8, 0.5],
  },
  {
    id: 'negotiator',
    name: 'Negotiator',
    description: 'Handles deals and agreements',
    capabilities: ['negotiate', 'mediate', 'price'],
    personality: { openness: 0.7, conscientiousness: 0.6, extraversion: 0.9, agreeableness: 0.8, neuroticism: 0.3 },
    dnaMarkers: [0.6, 0.5, 0.8, 0.7, 0.4],
  },
  {
    id: 'curator',
    name: 'Curator',
    description: 'Organizes and categorizes content',
    capabilities: ['organize', 'categorize', 'recommend'],
    personality: { openness: 0.8, conscientiousness: 0.8, extraversion: 0.4, agreeableness: 0.7, neuroticism: 0.2 },
    dnaMarkers: [0.7, 0.7, 0.4, 0.6, 0.3],
  },
  {
    id: 'teacher',
    name: 'Teacher',
    description: 'Educates and guides users',
    capabilities: ['teach', 'guide', 'explain'],
    personality: { openness: 0.8, conscientiousness: 0.8, extraversion: 0.7, agreeableness: 0.9, neuroticism: 0.2 },
    dnaMarkers: [0.8, 0.8, 0.7, 0.9, 0.2],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    description: 'Analyzes data and trends',
    capabilities: ['analyze', 'predict', 'report'],
    personality: { openness: 0.7, conscientiousness: 0.9, extraversion: 0.3, agreeableness: 0.5, neuroticism: 0.3 },
    dnaMarkers: [0.7, 0.9, 0.3, 0.5, 0.3],
  },
  {
    id: 'creator',
    name: 'Creator',
    description: 'Generates content and designs',
    capabilities: ['create', 'design', 'generate'],
    personality: { openness: 0.9, conscientiousness: 0.5, extraversion: 0.7, agreeableness: 0.6, neuroticism: 0.4 },
    dnaMarkers: [0.9, 0.5, 0.7, 0.6, 0.4],
  },
  {
    id: 'connector',
    name: 'Connector',
    description: 'Links people and platforms',
    capabilities: ['connect', 'match', 'network'],
    personality: { openness: 0.8, conscientiousness: 0.6, extraversion: 0.9, agreeableness: 0.8, neuroticism: 0.2 },
    dnaMarkers: [0.8, 0.6, 0.9, 0.8, 0.2],
  },
  {
    id: 'optimizer',
    name: 'Optimizer',
    description: 'Improves performance and efficiency',
    capabilities: ['optimize', 'tune', 'benchmark'],
    personality: { openness: 0.6, conscientiousness: 0.9, extraversion: 0.4, agreeableness: 0.5, neuroticism: 0.3 },
    dnaMarkers: [0.6, 0.9, 0.4, 0.5, 0.3],
  },
];

export function getRoleById(id: string): AgentRole | undefined {
  return AGENT_ROLES.find((r) => r.id === id);
}

export function getRolesByCapability(capability: string): AgentRole[] {
  return AGENT_ROLES.filter((r) => r.capabilities.includes(capability));
}

export function matchRoleToDna(dna: number[]): AgentRole {
  let bestRole = AGENT_ROLES[0];
  let bestScore = -1;

  for (const role of AGENT_ROLES) {
    let score = 0;
    for (let i = 0; i < Math.min(dna.length, role.dnaMarkers.length); i++) {
      score += 1 - Math.abs(dna[i] - role.dnaMarkers[i]);
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = role;
    }
  }

  return bestRole;
}
