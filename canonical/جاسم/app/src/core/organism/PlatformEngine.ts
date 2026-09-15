import type { LivingOrganism, Platform, LivingAgent, AgentSwarm, LivingBubble } from './PlatformTypes';
import { createLivingOrganism, evolveOrganism, addPlatformToOrganism, addAgentToOrganism, addSwarmToOrganism, addBubbleToOrganism } from './PlatformTypes';
import { generatePlatformDNA } from './PlatformDNA';
import type { PlatformDNA } from './PlatformDNA';

export interface SpawnResult {
  organism: LivingOrganism;
  platforms: Platform[];
  agents: LivingAgent[];
  swarms: AgentSwarm[];
  bubbles: LivingBubble[];
}

export function spawnOrganism(name: string, categories: string[]): SpawnResult {
  let organism = createLivingOrganism(name);
  const platforms: Platform[] = [];
  const agents: LivingAgent[] = [];
  const swarms: AgentSwarm[] = [];
  const bubbles: LivingBubble[] = [];

  for (const category of categories) {
    const dna = generatePlatformDNA(`${name}-${category}`, category);
    const platform: Platform = {
      id: `platform-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: `${name} ${category}`,
      category,
      status: 'concept',
      dna,
      features: dna.features,
      agentIds: [],
      bubbleIds: [],
    };
    platforms.push(platform);
    organism = addPlatformToOrganism(organism, platform);

    for (let i = 0; i < dna.agentCount; i++) {
      const agent: LivingAgent = {
        id: `agent-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 9)}`,
        name: `${category} Agent ${i + 1}`,
        role: ['explorer', 'builder', 'guardian', 'negotiator', 'curator'][i % 5],
        energy: 100,
        experience: 0,
        status: 'spawning',
        dna: createAgentDNAStub(),
        platformId: platform.id,
        tasksCompleted: 0,
        lastActiveAt: new Date(),
      };
      agents.push(agent);
      organism = addAgentToOrganism(organism, agent);
      platform.agentIds.push(agent.id);
    }

    for (const bubbleType of dna.bubbleTypes) {
      const bubble: LivingBubble = {
        id: `bubble-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        type: bubbleType,
        x: Math.random() * 800,
        y: Math.random() * 600,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        radius: 30 + Math.random() * 20,
        energy: 100,
        platformId: platform.id,
        isExpanded: false,
        isHovered: false,
        connections: [],
      };
      bubbles.push(bubble);
      organism = addBubbleToOrganism(organism, bubble);
      platform.bubbleIds.push(bubble.id);
    }
  }

  organism = evolveOrganism(organism);

  return { organism, platforms, agents, swarms, bubbles };
}

export function activateOrganismAgent(organism: LivingOrganism, agentId: string): LivingOrganism {
  return {
    ...organism,
    agents: organism.agents.map((a) =>
      a.id === agentId ? { ...a, status: 'working' as const, energy: Math.max(0, a.energy - 5), lastActiveAt: new Date() } : a
    ),
  };
}

export function classifyPlatformIntent(query: string): string {
  const patterns: Record<string, RegExp[]> = {
    marketplace: [/buy|sell|shop|product|store|cart/i, /منتج|تسوق|شراء|بيع|متجر/i],
    job: [/job|career|hire|resume|cv|salary/i, /وظيفة|عمل|توظيف|راتب|سيرة/i],
    transport: [/ride|taxi|delivery|car|uber/i, /مواصلات|تاكسي|توصيل|سيارة/i],
    rental: [/rent|apartment|house|property|airbnb/i, /إيجار|شقة|منزل|عقار/i],
    freelance: [/freelance|gig|project|developer|designer/i, /مستقل|مشروع|مطور|مصمم/i],
    social: [/connect|friend|message|chat|network/i, /تواصل|صديق|رسالة|شبكة/i],
    healthcare: [/doctor|hospital|clinic|medicine|health/i, /طبيب|مستشفى|صحة|دواء/i],
    travel: [/flight|hotel|trip|vacation|booking/i, /سفر|فندق|رحلة|حجز/i],
    education: [/course|learn|class|student|university/i, /تعلم|دورة|طالب|جامعة/i],
    event: [/event|concert|ticket|venue|party/i, /فعالية|حفل|تذكرة|مكان/i],
  };

  for (const [category, regexes] of Object.entries(patterns)) {
    for (const regex of regexes) {
      if (regex.test(query)) return category;
    }
  }

  return 'marketplace';
}

function createAgentDNAStub(): import('./PlatformTypes').LivingAgent['dna'] {
  return {
    sequence: {
      id: `stub-${Date.now()}`,
      name: 'Stub DNA',
      genes: Array.from({ length: 32 }, () => Math.random()),
      metadata: { generation: 1, mutations: 0, fitness: 0.5, parentIds: [], platform: 'stub', category: 'stub' },
      createdAt: new Date(),
      evolvedAt: new Date(),
    },
    roleMarkers: [],
    capabilityGenes: [],
    personalityGenes: [],
    memoryGenes: [],
    learningGenes: [],
  };
}

export { createLivingOrganism, evolveOrganism, addPlatformToOrganism, addAgentToOrganism, addSwarmToOrganism, addBubbleToOrganism };
export { generatePlatformDNA, evolveDNA, getDNAColorGradient, serializeDNA, deserializeDNA } from './PlatformDNA';
export type { PlatformDNA } from './PlatformDNA';
