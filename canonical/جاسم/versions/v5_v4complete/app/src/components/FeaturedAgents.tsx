import { useCallback } from 'react';
import type { Agent } from '@/data/agentsData';
import { categories } from '@/data/agentsData';

interface FeaturedAgentsProps {
  agents: Agent[];
  onTry: (agent: Agent) => void;
}

function getCategoryLabel(catId: string): string {
  return categories.find((c) => c.id === catId)?.name ?? catId;
}

function formatUsage(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

const gradientMap: Record<string, string> = {
  'from-orange-500 to-red-500': 'from-orange-500/20 to-red-500/10',
  'from-green-500 to-emerald-600': 'from-green-500/20 to-emerald-600/10',
  'from-pink-500 to-rose-500': 'from-pink-500/20 to-rose-500/10',
  'from-cyan-500 to-blue-500': 'from-cyan-500/20 to-blue-500/10',
};

export default function FeaturedAgents({ agents, onTry }: FeaturedAgentsProps) {
  const handleTry = useCallback(
    (agent: Agent) => {
      onTry(agent);
    },
    [onTry]
  );

  if (agents.length === 0) return null;

  return (
    <div className="w-full">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-1 h-6 rounded-full bg-gradient-to-b from-cyan-400 to-blue-500" />
        <h2 className="text-lg font-bold text-white">الوكلاء المميزون</h2>
        <span className="text-xs text-white/30 font-medium">اخترنا لك</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {agents.map((agent, i) => {
          const gradBg = gradientMap[agent.color] ?? 'from-cyan-500/10 to-blue-500/5';
          return (
            <div
              key={agent.id}
              className="group relative rounded-2xl border border-white/[0.08] backdrop-blur-xl overflow-hidden cursor-pointer hover:border-white/[0.14] transition-all duration-500"
              style={{
                animation: `fadeUp 0.6s ease forwards ${i * 0.08}s`,
                opacity: 0,
                transform: 'translateY(8px)',
              }}
              onClick={() => handleTry(agent)}
            >
              {/* Background gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${gradBg} opacity-60`} />

              {/* Hover glow */}
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{
                  boxShadow: 'inset 0 0 0 1px rgba(0, 212, 255, 0.15), 0 0 30px rgba(0, 212, 255, 0.08)',
                }}
              />

              <div className="relative p-5 flex flex-col gap-4">
                {/* Icon + Category badge */}
                <div className="flex items-center justify-between">
                  <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${agent.color} flex items-center justify-center text-white text-2xl font-bold shadow-lg group-hover:scale-110 transition-transform duration-500`}>
                    {agent.icon}
                  </div>
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/[0.06] text-cyan-300/80 border border-white/[0.06]">
                    {getCategoryLabel(agent.category)}
                  </span>
                </div>

                {/* Info */}
                <div>
                  <h3 className="text-base font-bold text-white group-hover:text-cyan-200 transition-colors duration-300">
                    {agent.name}
                  </h3>
                  <p className="mt-1.5 text-[13px] text-[var(--text2)] leading-relaxed line-clamp-3">
                    {agent.description}
                  </p>
                </div>

                {/* Capabilities */}
                <div className="flex flex-wrap gap-1.5">
                  {agent.capabilities.map((cap) => (
                    <span
                      key={cap}
                      className="px-2 py-0.5 rounded-md text-[11px] bg-white/[0.05] text-white/50 border border-white/[0.05]"
                    >
                      {cap}
                    </span>
                  ))}
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-2 pt-1">
                  <div className="flex items-center gap-1">
                    <svg className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    <span className="text-[12px] text-white/50">{agent.rating}</span>
                  </div>
                  <span className="text-[11px] text-white/20">|</span>
                  <span className="text-[11px] text-white/40">{formatUsage(agent.usageCount)} مستخدم</span>
                </div>

                {/* CTA */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTry(agent);
                  }}
                  className="mt-1 w-full py-2 rounded-xl text-[13px] font-semibold bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-300 border border-cyan-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 hover:border-cyan-500/40 active:scale-[0.98] transition-all duration-300"
                >
                  جرب الآن
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
