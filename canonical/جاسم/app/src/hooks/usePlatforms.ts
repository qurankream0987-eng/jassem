import { useState, useCallback } from 'react';
import type { Platform } from '../core/agents/PlatformComposer.ts';
import { createPlatform, evolvePlatform, activatePlatform, getPlatformHealth, getPlatformTemplates } from '../core/agents/PlatformComposer.ts';

export function usePlatforms() {
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [templates] = useState(() => getPlatformTemplates());

  const create = useCallback((name: string, templateId: string) => {
    const platform = createPlatform(name, templateId);
    setPlatforms((prev) => [...prev, platform]);
    return platform;
  }, []);

  const evolve = useCallback((platformId: string) => {
    setPlatforms((prev) =>
      prev.map((p) => (p.id === platformId ? evolvePlatform(p) : p))
    );
  }, []);

  const activate = useCallback((platformId: string) => {
    setPlatforms((prev) =>
      prev.map((p) => (p.id === platformId ? activatePlatform(p) : p))
    );
  }, []);

  const getHealth = useCallback((platformId: string) => {
    const platform = platforms.find((p) => p.id === platformId);
    if (!platform) return 0;
    return getPlatformHealth({ ...platform, agents: [], swarms: [] } as Platform & { agents: import('../core/agents/AgentBreeder').Agent[]; swarms: import('../core/agents/SwarmCoordinator').Swarm[] });
  }, [platforms]);

  return {
    platforms,
    templates,
    create,
    evolve,
    activate,
    getHealth,
  };
}
