// ============================================================================
// Living Organism Engine — Barrel Exports
// ============================================================================

// Types
export {
  PlatformCategory,
  AgentRole,
  AgentStatus,
  SwarmMood,
} from './types';

export type {
  PlatformDNA,
  PlatformFeature,
  PlatformIntent,
  LivingAgent,
  AgentSwarm,
  AgentRecipe,
  LivingBubble,
  LivingOrganism,
} from './types';

// Platform DNA Engine
export {
  generatePlatformDNA,
  evolveDNA,
  getDNAColorGradient,
  serializeDNA,
  deserializeDNA,
} from './platform-dna';

// Agent Breeder
export {
  breedAgents,
  evolveAgent,
  activateAgent,
} from './agent-breeder';

// Platform Engine
export {
  classifyPlatformIntent,
  spawnOrganism,
  evolveOrganism,
  activateOrganismAgent,
  serializeOrganism,
  deserializeOrganism,
} from './platform-engine';
