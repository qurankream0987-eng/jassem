import { useState, useEffect, useCallback } from 'react';
import type { LivingOrganism } from '../core/organism/PlatformTypes.ts';
import { createLivingOrganism, evolveOrganism, getOrganismStats } from '../core/organism/PlatformTypes.ts';

export function useLiving(name: string = 'JASIM') {
  const [organism, setOrganism] = useState<LivingOrganism>(() => createLivingOrganism(name));
  const [stats, setStats] = useState(getOrganismStats(organism));
  const [isEvolving, setIsEvolving] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setOrganism((prev) => {
        const evolved = evolveOrganism(prev);
        setStats(getOrganismStats(evolved));
        return evolved;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const forceEvolve = useCallback(() => {
    setIsEvolving(true);
    setOrganism((prev) => {
      const evolved = evolveOrganism(prev);
      setStats(getOrganismStats(evolved));
      return evolved;
    });
    setTimeout(() => setIsEvolving(false), 1000);
  }, []);

  return {
    organism,
    stats,
    isEvolving,
    forceEvolve,
  };
}
