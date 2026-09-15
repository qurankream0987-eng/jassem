// ============================================================================
// Living Platform Engine — القلب النابض: intent → DNA → Agents → Bubbles
// ============================================================================

import { PlatformCategory, AgentStatus } from './types';
import type {
  LivingOrganism,
  PlatformDNA,
  LivingAgent,
  AgentSwarm,
  LivingBubble,
  PlatformIntent,
  PlatformCategory as PC,
} from './types';
import { generatePlatformDNA, evolveDNA } from './platform-dna';
import { breedAgents, evolveAgent, activateAgent } from './agent-breeder';

// ======== INTENT CLASSIFICATION ========

const INTENT_PATTERNS: Array<{ category: PC; patterns: RegExp[]; weight: number }> = [
  {
    category: PlatformCategory.RESTAURANT,
    patterns: [
      /مطعم/i, /طعام/i, /أكل/i, /وجبة/i, /برياني/i, /مجبوس/i, /مندي/i,
      /فطور/i, /غداء/i, /عشاء/i, /توصيل طعام/i, /دليفري/i,
      /restaurant/i, /food/i, /hungry/i, /meal/i, /dinner/i, /lunch/i, /breakfast/i,
      /order food/i, /delivery food/i, /restaurants near/i, /kitchen/i, /chef/i,
      /qr.*order/i, /طاولة.*طلب/i, /dine.in/i, /menu/i, /قائمة.*طعام/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.CAR_REPAIR,
    patterns: [
      /ورشة/i, /تصليح/i, /ميكانيكي/i, /سيارة/i, /سيارتي/i, /عطل/i, /كهرباء/i,
      /بنشر/i, /زيت/i, /فرامل/i, /كاوتش/i, /صيانة/i, /غيار/i, /دهان/i, /سمكرة/i,
      /car repair/i, /mechanic/i, /garage/i, /workshop/i, /fix car/i, /oil change/i,
      /brakes/i, /tires/i, /paint/i, /dent/i, /service car/i, /auto repair/i,
      /فحص دوري/i, /مكيف/i, /دينمو/i, /بطارية/i, /تربيط/i, / transmission/i,
      /عطل سيارة/i, /ورشة تصليح/i, /صيانة دورية/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.PHARMACY,
    patterns: [
      /صيدلية/i, /دواء/i, /علاج/i, /وصفة/i, /فيتامين/i, /صح[ة ت]/i,
      /pharmacy/i, /medicine/i, /drug/i, /pill/i, /vitamin/i, /prescription/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.FASHION,
    patterns: [
      /موضة/i, /أزياء/i, /ملابس/i, /فستان/i, /قميص/i, /حذاء/i,
      /fashion/i, /clothes/i, /dress/i, /shirt/i, /shoe/i, /outfit/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.GROCERY,
    patterns: [
      /بقالة/i, /سوبرماركت/i, /خضار/i, /فاكهة/i, /لحوم/i, /تسوق/i,
      /grocery/i, /supermarket/i, /vegetable/i, /fruit/i, /market/i, /shopping/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.REAL_ESTATE,
    patterns: [
      /عقار/i, /شقة/i, /بيت/i, /بيع/i, /إيجار/i, /دير[ةه]/i,
      /real estate/i, /apartment/i, /house/i, /rent/i, /property/i, /villa/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.SALON,
    patterns: [
      /صالون/i, /حلاق/i, /تجميل/i, /مكياج/i, /شعر/i,
      /salon/i, /barber/i, /beauty/i, /makeup/i, /hair/i, /spa/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.CLINIC,
    patterns: [
      /عيادة/i, /مستشفى/i, /دكتور/i, /طبيب/i, /فحص/i, /صحة/i,
      /clinic/i, /hospital/i, /doctor/i, /medical/i, /checkup/i, /health/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.MARKETPLACE,
    patterns: [
      /سوق/i, /متجر/i, /تاجر/i, /بائع/i, /متعدد.*بائع/i,
      /marketplace/i, /multi.vendor/i, /store/i, /vendor/i, /bazaar/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.DELIVERY,
    patterns: [
      /توصيل/i, /سائق/i, /مندوب/i, /شحن/i, /وصل/i,
      /delivery/i, /driver/i, /shipping/i, /courier/i, /logistics/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.EDUCATION,
    patterns: [
      /تعليم/i, /مدرسة/i, /دورة/i, /تدريب/i, /طالب/i, /معلم/i,
      /education/i, /school/i, /course/i, /training/i, /student/i, /learning/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.FITNESS,
    patterns: [
      /رياضة/i, /لياقة/i, /جيم/i, /تمرين/i, /رشاقة/i, /دايت/i,
      /fitness/i, /gym/i, /workout/i, /exercise/i, /diet/i, /health/i,
    ],
    weight: 1.0,
  },
  {
    category: PlatformCategory.EVENT,
    patterns: [
      /فعالية/i, /حدث/i, /حفل/i, /زفاف/i, /مؤتمر/i, /ورشة عمل/i,
      /event/i, /party/i, /wedding/i, /conference/i, /gathering/i,
    ],
    weight: 1.0,
  },
];

function detectLanguage(text: string): 'ar' | 'en' | 'mixed' {
  const arCount = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const enCount = (text.match(/[a-zA-Z]/g) || []).length;
  if (arCount > 0 && enCount > 0) return 'mixed';
  if (arCount > 0) return 'ar';
  return 'en';
}

export function classifyPlatformIntent(text: string): PlatformIntent {
  if (!text || text.trim().length === 0) {
    return {
      category: PlatformCategory.CUSTOM,
      confidence: 0,
      entities: {},
      originalText: text,
      language: 'en',
      complexity: 0.5,
    };
  }

  const normalized = text.toLowerCase().trim();
  const scores = new Map<PC, number>();

  for (const { category, patterns, weight } of INTENT_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        scores.set(category, (scores.get(category) || 0) + weight);
      }
    }
  }

  let bestCategory = PlatformCategory.CUSTOM;
  let bestScore = 0;

  for (const [cat, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = cat;
    }
  }

  // Calculate complexity from text length + keyword density
  const wordCount = normalized.split(/\s+/).length;
  const keywordDensity = bestScore / Math.max(1, wordCount);
  const complexity = Math.min(1, 0.3 + keywordDensity * 0.5 + wordCount * 0.02);

  // Extract entities
  const entities: Record<string, string[]> = {};
  const locationMatch = text.match(/في\s+(\S+)/);
  if (locationMatch) entities.location = [locationMatch[1]];

  return {
    category: bestCategory,
    confidence: Math.min(bestScore * 0.3, 1.0),
    entities,
    originalText: text,
    language: detectLanguage(text),
    complexity,
  };
}

// ======== ORGANISM LIFECYCLE ========

/** Create a living organism from user text — THE MAIN PIPELINE */
export function spawnOrganism(userText: string): LivingOrganism {
  // Step 1: Classify intent
  const intent = classifyPlatformIntent(userText);

  // Step 2: Generate unique DNA
  const dna = generatePlatformDNA(intent);

  // Step 3: Breed agents from DNA
  const agents = breedAgents(dna);

  // Step 4: Form swarm
  const swarm = formSwarm(dna, agents);

  // Step 5: Create living bubbles
  const bubbles = agentsToBubbles(agents, dna);

  // Step 6: Awaken organism
  const organism: LivingOrganism = {
    dna,
    swarm: { ...swarm, agents: swarm.agents.map(a => ({ ...a, status: AgentStatus.READY })) },
    bubbles,
    seedPhrase: userText,
    isAlive: true,
    generation: 1,
  };

  return organism;
}

/** Form an agent swarm from DNA + agents */
function formSwarm(dna: PlatformDNA, agents: LivingAgent[]): AgentSwarm {
  const totalEnergy = agents.reduce((sum, a) => sum + a.energy, 0) / agents.length;

  // Determine swarm mood from energy + personality
  let mood = 'harmonious' as AgentSwarm['swarmMood'];
  if (totalEnergy > 80) mood = 'energetic';
  else if (totalEnergy > 60) mood = 'focused';
  else if (totalEnergy > 40) mood = 'harmonious';
  else if (totalEnergy > 20) mood = 'recovering';
  else mood = 'stressed';

  return {
    id: `swarm_${dna.id}`,
    platformId: dna.id,
    name: `${dna.name} Swarm`,
    nameAr: `سرب ${dna.nameAr}`,
    agents,
    collectiveEnergy: totalEnergy,
    swarmMood: mood,
    tasksQueued: 0,
    tasksCompleted: 0,
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

/** Convert agents to living bubbles for the UI */
function agentsToBubbles(agents: LivingAgent[], dna: PlatformDNA): LivingBubble[] {
  const bubbles: LivingBubble[] = [];
  const screenW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const screenH = typeof window !== 'undefined' ? window.innerHeight : 800;

  // Distribute bubbles in a circle around center
  const centerX = screenW / 2;
  const centerY = screenH / 2;
  const orbitRadius = Math.min(screenW, screenH) * 0.25;

  agents.forEach((agent, i) => {
    const angle = (2 * Math.PI * i) / agents.length - Math.PI / 2;
    // Add some randomness
    const jitterX = (Math.sin(i * 7.3) * 0.15);
    const jitterY = (Math.cos(i * 5.7) * 0.15);
    const x = centerX + orbitRadius * Math.cos(angle + jitterX) * (0.8 + Math.random() * 0.4);
    const y = centerY + orbitRadius * Math.sin(angle + jitterY) * (0.8 + Math.random() * 0.4);

    // Radius based on agent priority/experience
    const radius = 50 + (agent.experience / 100) * 20 + Math.random() * 10;

    // Get color2 from DNA colors
    const colorIdx = i % 3;
    const color2 = [dna.colors.secondary, dna.colors.accent, dna.colors.glow][colorIdx];

    // Actions from agent skills
    const actions = agent.skills.slice(0, 3).map((skill, si) => ({
      label: skill.replace(/_/g, ' '),
      labelAr: skill.replace(/_/g, ' '),
      action: `skill_${skill}`,
    }));

    bubbles.push({
      id: `bubble_${agent.id}`,
      agentId: agent.id,
      platformId: dna.id,
      x: Math.max(80, Math.min(screenW - 80, x)),
      y: Math.max(80, Math.min(screenH - 150, y)),
      radius,
      color: agent.color,
      color2,
      label: agent.name,
      labelAr: agent.nameAr,
      pulsePhase: (i / agents.length) * Math.PI * 2,
      energy: agent.energy,
      agentStatus: agent.status,
      actions: actions.length > 0 ? actions : [{ label: 'Activate', labelAr: 'تفعيل', action: 'activate' }],
      metadata: { role: agent.role, experience: agent.experience, skills: agent.skills },
    });
  });

  return bubbles;
}

/** Evolve the entire organism (called periodically) */
export function evolveOrganism(organism: LivingOrganism): LivingOrganism {
  // Evolve DNA
  const newDNA = evolveDNA(organism.dna);

  // Evolve each agent
  const evolvedAgents = organism.swarm.agents.map(evolveAgent);

  // Recalculate swarm
  const totalEnergy = evolvedAgents.reduce((sum, a) => sum + a.energy, 0) / Math.max(1, evolvedAgents.length);

  let mood = organism.swarm.swarmMood;
  if (totalEnergy > 80) mood = 'energetic';
  else if (totalEnergy > 60) mood = 'focused';
  else if (totalEnergy > 40) mood = 'harmonious';
  else if (totalEnergy > 20) mood = 'recovering';
  else mood = 'stressed';

  // Update bubbles from evolved agents
  const updatedBubbles = organism.bubbles.map((bubble, i) => {
    const agent = evolvedAgents[i];
    if (!agent) return bubble;
    return {
      ...bubble,
      energy: agent.energy,
      agentStatus: agent.status,
      pulsePhase: bubble.pulsePhase + 0.02,
    };
  });

  return {
    ...organism,
    dna: newDNA,
    swarm: {
      ...organism.swarm,
      agents: evolvedAgents,
      collectiveEnergy: totalEnergy,
      swarmMood: mood,
      lastActivityAt: Date.now(),
    },
    bubbles: updatedBubbles,
    generation: organism.generation + 1,
  };
}

/** Activate an agent within an organism */
export function activateOrganismAgent(organism: LivingOrganism, agentId: string): LivingOrganism {
  const newAgents = organism.swarm.agents.map(a =>
    a.id === agentId ? activateAgent(a) : a
  );

  const newBubbles = organism.bubbles.map(b => {
    if (b.agentId === agentId) {
      return { ...b, agentStatus: AgentStatus.WORKING as LivingBubble['agentStatus'] };
    }
    return b;
  });

  return {
    ...organism,
    swarm: { ...organism.swarm, agents: newAgents },
    bubbles: newBubbles,
  };
}

/** Serialize organism for storage */
export function serializeOrganism(organism: LivingOrganism): string {
  return btoa(JSON.stringify(organism));
}

/** Deserialize organism from storage */
export function deserializeOrganism(serialized: string): LivingOrganism {
  return JSON.parse(atob(serialized));
}
