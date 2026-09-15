import type { Agent } from './AgentBreeder';
import type { AgentDNA } from './AgentDNA';
import type { Swarm } from './SwarmCoordinator';

export interface Platform {
  id: string;
  name: string;
  description: string;
  category: string;
  dna: AgentDNA;
  agents: Agent[];
  swarms: Swarm[];
  features: string[];
  status: PlatformStatus;
  createdAt: Date;
  evolvedAt: Date;
}

export type PlatformStatus = 'concept' | 'designing' | 'building' | 'testing' | 'live' | 'evolving' | 'deprecated';

export interface PlatformTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  requiredRoles: string[];
  features: string[];
  config: Record<string, unknown>;
}

export const PLATFORM_TEMPLATES: PlatformTemplate[] = [
  {
    id: 'marketplace',
    name: 'Marketplace',
    description: 'Buy and sell products and services',
    category: 'commerce',
    requiredRoles: ['explorer', 'negotiator', 'guardian'],
    features: ['listings', 'search', 'payments', 'reviews'],
    config: { currency: 'KWD', escrow: true },
  },
  {
    id: 'social',
    name: 'Social Network',
    description: 'Connect and share with others',
    category: 'social',
    requiredRoles: ['connector', 'curator', 'teacher'],
    features: ['profiles', 'feeds', 'messaging', 'groups'],
    config: { privacy: 'high', moderation: 'ai' },
  },
  {
    id: 'job_board',
    name: 'Job Board',
    description: 'Find and post jobs',
    category: 'employment',
    requiredRoles: ['analyst', 'connector', 'negotiator'],
    features: ['jobs', 'resumes', 'matching', 'interviews'],
    config: { screening: 'ai', videoInterview: true },
  },
  {
    id: 'transport',
    name: 'Transport',
    description: 'Book rides and deliveries',
    category: 'logistics',
    requiredRoles: ['explorer', 'optimizer', 'guardian'],
    features: ['booking', 'tracking', 'payments', 'ratings'],
    config: { realTimeTracking: true, insurance: true },
  },
  {
    id: 'rental',
    name: 'Rental',
    description: 'Rent properties and vehicles',
    category: 'realestate',
    requiredRoles: ['guardian', 'negotiator', 'analyst'],
    features: ['listings', 'booking', 'contracts', 'inspection'],
    config: { depositRequired: true, insurance: true },
  },
  {
    id: 'shop_builder',
    name: 'Shop Builder',
    description: 'Create online stores',
    category: 'commerce',
    requiredRoles: ['builder', 'creator', 'optimizer'],
    features: ['storefront', 'inventory', 'checkout', 'analytics'],
    config: { themes: 20, paymentGateways: ['knet', 'stripe'] },
  },
  {
    id: 'freelance',
    name: 'Freelance',
    description: 'Hire and work as a freelancer',
    category: 'employment',
    requiredRoles: ['negotiator', 'builder', 'guardian'],
    features: ['gigs', 'portfolios', 'milestones', 'escrow'],
    config: { milestonePayments: true, skillTests: true },
  },
  {
    id: 'healthcare',
    name: 'Healthcare',
    description: 'Medical services and appointments',
    category: 'health',
    requiredRoles: ['guardian', 'analyst', 'teacher'],
    features: ['appointments', 'records', 'prescriptions', 'telemedicine'],
    config: { hipaa: true, insurance: true },
  },
  {
    id: 'travel',
    name: 'Travel',
    description: 'Book flights, hotels, and trips',
    category: 'travel',
    requiredRoles: ['explorer', 'negotiator', 'optimizer'],
    features: ['flights', 'hotels', 'itineraries', 'packages'],
    config: { priceAlerts: true, cancellation: 'flexible' },
  },
  {
    id: 'education',
    name: 'Education',
    description: 'Learn and teach online',
    category: 'education',
    requiredRoles: ['teacher', 'curator', 'analyst'],
    features: ['courses', 'quizzes', 'certificates', 'liveClasses'],
    config: { accreditation: true, gamification: true },
  },
];

export function createPlatform(
  name: string,
  templateId: string,
  customFeatures: string[] = []
): Platform {
  const template = PLATFORM_TEMPLATES.find((t) => t.id === templateId) ?? PLATFORM_TEMPLATES[0];
  const baseDna = createAgentDNA(name, template.category, 'system');

  return {
    id: `platform-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    name,
    description: template.description,
    category: template.category,
    dna: baseDna,
    agents: [],
    swarms: [],
    features: [...template.features, ...customFeatures],
    status: 'concept',
    createdAt: new Date(),
    evolvedAt: new Date(),
  };
}

export function evolvePlatform(platform: Platform): Platform {
  return {
    ...platform,
    dna: mutateAgentDNA(platform.dna, 0.03),
    features: [...platform.features, `feature-${Date.now()}`],
    status: platform.status === 'live' ? 'evolving' : platform.status,
    evolvedAt: new Date(),
  };
}

export function addAgentToPlatform(platform: Platform, agent: Agent): Platform {
  return {
    ...platform,
    agents: [...platform.agents, agent],
  };
}

export function addSwarmToPlatform(platform: Platform, swarm: Swarm): Platform {
  return {
    ...platform,
    swarms: [...platform.swarms, swarm],
  };
}

export function activatePlatform(platform: Platform): Platform {
  return { ...platform, status: 'live' };
}

export function getPlatformHealth(platform: Platform): number {
  const agentHealth = platform.agents.length > 0
    ? platform.agents.reduce((sum, a) => sum + a.energy, 0) / platform.agents.length
    : 0;
  const swarmHealth = platform.swarms.length > 0
    ? platform.swarms.reduce((sum, s) => sum + getSwarmEfficiency(s), 0) / platform.swarms.length
    : 0;
  return (agentHealth + swarmHealth) / 2;
}

export function getPlatformTemplates(): PlatformTemplate[] {
  return PLATFORM_TEMPLATES;
}

export function getTemplateById(id: string): PlatformTemplate | undefined {
  return PLATFORM_TEMPLATES.find((t) => t.id === id);
}

import { createAgentDNA, mutateAgentDNA } from './AgentDNA';
import { getSwarmEfficiency } from './SwarmCoordinator';
