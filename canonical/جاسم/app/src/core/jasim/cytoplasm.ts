import type { CapabilityDefinition, DnaGeneValue, DnaProfile } from './types';
import { DnaGene } from './types';

const CAPABILITIES: Map<string, CapabilityDefinition> = new Map();
const ADAPTERS: Map<string, Function> = new Map();

export function registerCapability(def: CapabilityDefinition): void {
  CAPABILITIES.set(def.id, def);
}

export function resolveCapabilities(required: string[], profile: DnaProfile): CapabilityDefinition[] {
  const resolved: CapabilityDefinition[] = [];
  for (const req of required) {
    const cap = CAPABILITIES.get(req);
    if (cap && checkGeneRequirements(cap, profile)) {
      resolved.push(cap);
    }
  }
  return resolved;
}

export function executeCapability(
  capabilityId: string,
  input: Record<string, unknown>,
  profile: DnaProfile
): Promise<unknown> {
  const cap = CAPABILITIES.get(capabilityId);
  if (!cap) throw new Error(`Capability ${capabilityId} not found`);
  if (!checkGeneRequirements(cap, profile)) throw new Error(`Gene requirements not met for ${capabilityId}`);

  const adapter = getAdapter(cap.adapter);
  if (!adapter) throw new Error(`Adapter ${cap.adapter} not found`);

  return executeWithFallback(cap, input, adapter);
}

export function getAdapter(name: string): Function | undefined {
  return ADAPTERS.get(name);
}

export function registerAdapter(name: string, fn: Function): void {
  ADAPTERS.set(name, fn);
}

export function getAllCapabilities(): CapabilityDefinition[] {
  return Array.from(CAPABILITIES.values());
}

export function getCapabilitiesByCategory(category: string): CapabilityDefinition[] {
  return Array.from(CAPABILITIES.values()).filter((c) => c.category === category);
}

function checkGeneRequirements(cap: CapabilityDefinition, profile: DnaProfile): boolean {
  for (const gene of cap.requiredGenes) {
    if ((profile.genes[gene] ?? 0) < 0.3) return false;
  }
  return true;
}

async function executeWithFallback(
  cap: CapabilityDefinition,
  input: Record<string, unknown>,
  adapter: Function
): Promise<unknown> {
  try {
    return await adapter(input);
  } catch (error) {
    for (const fallbackId of cap.fallbackChain) {
      const fallback = CAPABILITIES.get(fallbackId);
      if (fallback) {
        const fallbackAdapter = getAdapter(fallback.adapter);
        if (fallbackAdapter) {
          try {
            return await fallbackAdapter(input);
          } catch {
            continue;
          }
        }
      }
    }
    throw error;
  }
}

export function initializeCapabilities(): void {
  const defaults: CapabilityDefinition[] = [
    { id: 'search', name: 'Search', description: 'Search across listings', category: 'core', adapter: 'defaultSearch', fallbackChain: ['basicSearch'], requiredGenes: [DnaGene.CAPABILITY, DnaGene.MEMORY], timeout: 5000, cost: 0.01 },
    { id: 'filter', name: 'Filter', description: 'Filter results', category: 'core', adapter: 'defaultFilter', fallbackChain: [], requiredGenes: [DnaGene.CAPABILITY], timeout: 3000, cost: 0.005 },
    { id: 'sort', name: 'Sort', description: 'Sort results', category: 'core', adapter: 'defaultSort', fallbackChain: [], requiredGenes: [DnaGene.CAPABILITY], timeout: 2000, cost: 0.005 },
    { id: 'recommend', name: 'Recommend', description: 'AI recommendations', category: 'ai', adapter: 'aiRecommend', fallbackChain: ['trending', 'popular'], requiredGenes: [DnaGene.REASONING, DnaGene.MEMORY], timeout: 10000, cost: 0.05 },
    { id: 'chat', name: 'Chat', description: 'Real-time messaging', category: 'communication', adapter: 'websocketChat', fallbackChain: ['pollingChat'], requiredGenes: [DnaGene.COMMUNICATION], timeout: 3000, cost: 0.02 },
    { id: 'payment', name: 'Payment', description: 'Process payments', category: 'financial', adapter: 'stripePayment', fallbackChain: ['knetPayment', 'cashPayment'], requiredGenes: [DnaGene.SECURITY, DnaGene.TRUST], timeout: 15000, cost: 0.1 },
    { id: 'escrow', name: 'Escrow', description: 'Escrow transactions', category: 'financial', adapter: 'defaultEscrow', fallbackChain: ['manualEscrow'], requiredGenes: [DnaGene.SECURITY, DnaGene.TRUST], timeout: 20000, cost: 0.15 },
    { id: 'kyc', name: 'KYC', description: 'Identity verification', category: 'trust', adapter: 'defaultKyc', fallbackChain: ['manualKyc'], requiredGenes: [DnaGene.SECURITY, DnaGene.TRUST], timeout: 30000, cost: 0.2 },
    { id: 'fraud_check', name: 'Fraud Check', description: 'Detect fraud', category: 'trust', adapter: 'aiFraud', fallbackChain: ['ruleFraud'], requiredGenes: [DnaGene.REASONING, DnaGene.SECURITY], timeout: 5000, cost: 0.08 },
    { id: 'analytics', name: 'Analytics', description: 'Data analytics', category: 'ai', adapter: 'defaultAnalytics', fallbackChain: ['basicAnalytics'], requiredGenes: [DnaGene.REASONING, DnaGene.MEMORY], timeout: 10000, cost: 0.05 },
    { id: 'booking', name: 'Booking', description: 'Appointment booking', category: 'core', adapter: 'defaultBooking', fallbackChain: ['manualBooking'], requiredGenes: [DnaGene.PLANNING, DnaGene.CAPABILITY], timeout: 10000, cost: 0.03 },
    { id: 'tracking', name: 'Tracking', description: 'Order tracking', category: 'logistics', adapter: 'defaultTracking', fallbackChain: ['manualTracking'], requiredGenes: [DnaGene.CAPABILITY, DnaGene.MEMORY], timeout: 5000, cost: 0.02 },
    { id: 'map', name: 'Map', description: 'Map integration', category: 'core', adapter: 'googleMaps', fallbackChain: ['openStreetMap'], requiredGenes: [DnaGene.UI, DnaGene.CAPABILITY], timeout: 5000, cost: 0.01 },
    { id: 'translate', name: 'Translate', description: 'Language translation', category: 'ai', adapter: 'aiTranslate', fallbackChain: ['dictionaryTranslate'], requiredGenes: [DnaGene.COMMUNICATION, DnaGene.REASONING], timeout: 5000, cost: 0.03 },
    { id: 'video', name: 'Video', description: 'Video calls', category: 'communication', adapter: 'webrtcVideo', fallbackChain: ['recordedVideo'], requiredGenes: [DnaGene.COMMUNICATION, DnaGene.UI], timeout: 10000, cost: 0.05 },
    { id: 'notify', name: 'Notify', description: 'Push notifications', category: 'communication', adapter: 'pushNotify', fallbackChain: ['emailNotify', 'smsNotify'], requiredGenes: [DnaGene.COMMUNICATION], timeout: 3000, cost: 0.01 },
    { id: 'biometric', name: 'Biometric', description: 'Biometric auth', category: 'security', adapter: 'faceBiometric', fallbackChain: ['fingerprintBiometric', 'pinAuth'], requiredGenes: [DnaGene.SECURITY], timeout: 10000, cost: 0.1 },
    { id: 'contract', name: 'Contract', description: 'Smart contracts', category: 'financial', adapter: 'blockchainContract', fallbackChain: ['digitalContract', 'paperContract'], requiredGenes: [DnaGene.SECURITY, DnaGene.TRUST], timeout: 20000, cost: 0.2 },
    { id: 'dao', name: 'DAO', description: 'DAO governance', category: 'governance', adapter: 'defaultDao', fallbackChain: [], requiredGenes: [DnaGene.SECURITY, DnaGene.COMMUNICATION], timeout: 15000, cost: 0.15 },
    { id: 'token', name: 'Token', description: 'Token rewards', category: 'financial', adapter: 'defaultToken', fallbackChain: [], requiredGenes: [DnaGene.SECURITY], timeout: 5000, cost: 0.1 },
    { id: 'image', name: 'Image', description: 'Image analysis', category: 'ai', adapter: 'aiVision', fallbackChain: ['basicVision'], requiredGenes: [DnaGene.REASONING], timeout: 10000, cost: 0.08 },
    { id: 'summarize', name: 'Summarize', description: 'Text summarization', category: 'ai', adapter: 'aiSummarize', fallbackChain: ['extractiveSummarize'], requiredGenes: [DnaGene.REASONING, DnaGene.MEMORY], timeout: 8000, cost: 0.04 },
    { id: 'generate', name: 'Generate', description: 'Content generation', category: 'ai', adapter: 'aiGenerate', fallbackChain: ['templateGenerate'], requiredGenes: [DnaGene.REASONING, DnaGene.CREATIVITY], timeout: 15000, cost: 0.1 },
    { id: 'plan', name: 'Plan', description: 'Task planning', category: 'ai', adapter: 'aiPlanner', fallbackChain: ['rulePlanner'], requiredGenes: [DnaGene.PLANNING, DnaGene.REASONING], timeout: 10000, cost: 0.06 },
    { id: 'memory', name: 'Memory', description: 'Long-term memory', category: 'core', adapter: 'vectorMemory', fallbackChain: ['sqlMemory'], requiredGenes: [DnaGene.MEMORY], timeout: 5000, cost: 0.03 },
    { id: 'cache', name: 'Cache', description: 'Response caching', category: 'core', adapter: 'redisCache', fallbackChain: ['memoryCache'], requiredGenes: [DnaGene.MEMORY], timeout: 1000, cost: 0.001 },
    { id: 'monitor', name: 'Monitor', description: 'System monitoring', category: 'core', adapter: 'defaultMonitor', fallbackChain: [], requiredGenes: [DnaGene.UI], timeout: 5000, cost: 0.01 },
    { id: 'scale', name: 'Scale', description: 'Auto-scaling', category: 'core', adapter: 'defaultScale', fallbackChain: ['manualScale'], requiredGenes: [DnaGene.CAPABILITY], timeout: 10000, cost: 0.05 },
    { id: 'backup', name: 'Backup', description: 'Data backup', category: 'security', adapter: 'cloudBackup', fallbackChain: ['localBackup'], requiredGenes: [DnaGene.SECURITY, DnaGene.MEMORY], timeout: 30000, cost: 0.1 },
    { id: 'encrypt', name: 'Encrypt', description: 'Data encryption', category: 'security', adapter: 'aesEncrypt', fallbackChain: ['baseEncrypt'], requiredGenes: [DnaGene.SECURITY], timeout: 5000, cost: 0.05 },
    { id: 'audit', name: 'Audit', description: 'Security audit', category: 'security', adapter: 'defaultAudit', fallbackChain: ['manualAudit'], requiredGenes: [DnaGene.SECURITY, DnaGene.TRUST], timeout: 20000, cost: 0.1 },
  ];

  for (const def of defaults) {
    registerCapability(def);
  }

  ADAPTERS.set('defaultSearch', async (input: Record<string, unknown>) => ({ results: [], query: input.query }));
  ADAPTERS.set('defaultFilter', async (input: Record<string, unknown>) => ({ filtered: true, input }));
  ADAPTERS.set('defaultSort', async (input: Record<string, unknown>) => ({ sorted: true, input }));
  ADAPTERS.set('aiRecommend', async (input: Record<string, unknown>) => ({ recommendations: [], input }));
  ADAPTERS.set('websocketChat', async (input: Record<string, unknown>) => ({ message: 'sent', input }));
  ADAPTERS.set('stripePayment', async (input: Record<string, unknown>) => ({ payment: 'processed', input }));
  ADAPTERS.set('knetPayment', async (input: Record<string, unknown>) => ({ payment: 'processed_knet', input }));
  ADAPTERS.set('defaultEscrow', async (input: Record<string, unknown>) => ({ escrow: 'created', input }));
  ADAPTERS.set('defaultKyc', async (input: Record<string, unknown>) => ({ kyc: 'verified', input }));
  ADAPTERS.set('aiFraud', async (input: Record<string, unknown>) => ({ risk: 0.1, input }));
  ADAPTERS.set('defaultAnalytics', async (input: Record<string, unknown>) => ({ analytics: {}, input }));
  ADAPTERS.set('defaultBooking', async (input: Record<string, unknown>) => ({ booking: 'confirmed', input }));
  ADAPTERS.set('defaultTracking', async (input: Record<string, unknown>) => ({ tracking: {}, input }));
  ADAPTERS.set('googleMaps', async (input: Record<string, unknown>) => ({ map: {}, input }));
  ADAPTERS.set('aiTranslate', async (input: Record<string, unknown>) => ({ translation: '', input }));
  ADAPTERS.set('webrtcVideo', async (input: Record<string, unknown>) => ({ video: 'started', input }));
  ADAPTERS.set('pushNotify', async (input: Record<string, unknown>) => ({ notified: true, input }));
  ADAPTERS.set('faceBiometric', async (input: Record<string, unknown>) => ({ auth: true, input }));
  ADAPTERS.set('blockchainContract', async (input: Record<string, unknown>) => ({ contract: 'deployed', input }));
  ADAPTERS.set('defaultDao', async (input: Record<string, unknown>) => ({ vote: 'recorded', input }));
  ADAPTERS.set('defaultToken', async (input: Record<string, unknown>) => ({ tokens: 0, input }));
  ADAPTERS.set('aiVision', async (input: Record<string, unknown>) => ({ analysis: {}, input }));
  ADAPTERS.set('aiSummarize', async (input: Record<string, unknown>) => ({ summary: '', input }));
  ADAPTERS.set('aiGenerate', async (input: Record<string, unknown>) => ({ content: '', input }));
  ADAPTERS.set('aiPlanner', async (input: Record<string, unknown>) => ({ plan: {}, input }));
  ADAPTERS.set('vectorMemory', async (input: Record<string, unknown>) => ({ stored: true, input }));
  ADAPTERS.set('redisCache', async (input: Record<string, unknown>) => ({ cached: true, input }));
  ADAPTERS.set('defaultMonitor', async (input: Record<string, unknown>) => ({ status: 'healthy', input }));
  ADAPTERS.set('defaultScale', async (input: Record<string, unknown>) => ({ scaled: true, input }));
  ADAPTERS.set('cloudBackup', async (input: Record<string, unknown>) => ({ backup: 'completed', input }));
  ADAPTERS.set('aesEncrypt', async (input: Record<string, unknown>) => ({ encrypted: true, input }));
  ADAPTERS.set('defaultAudit', async (input: Record<string, unknown>) => ({ audit: 'passed', input }));
}

initializeCapabilities();
