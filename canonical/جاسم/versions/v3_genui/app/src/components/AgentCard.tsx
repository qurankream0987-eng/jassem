import { useCallback, useRef } from 'react';
import type { Agent } from '@/data/agentsData';
import { categories } from '@/data/agentsData';

interface AgentCardProps {
  agent: Agent;
  onActivate: (agent: Agent) => void;
  index?: number;
}

function getCategoryLabel(catId: string): string {
  return categories.find((c) => c.id === catId)?.name ?? catId;
}

function formatUsage(n: number): string {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return `${n}`;
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const halfStar = rating - fullStars >= 0.3;
  const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

  return (
    <div className="flex items-center gap-0.5" dir="ltr">
      {Array.from({ length: fullStars }).map((_, i) => (
        <svg key={`f${i}`} className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
      {halfStar && (
        <svg key="h" className="w-3.5 h-3.5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
          <defs>
            <linearGradient id={`half-${rating}`}>
              <stop offset="50%" stopColor="currentColor" />
              <stop offset="50%" stopColor="transparent" />
            </linearGradient>
          </defs>
          <path fill={`url(#half-${rating})`} d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      )}
      {Array.from({ length: emptyStars }).map((_, i) => (
        <svg key={`e${i}`} className="w-3.5 h-3.5 text-white/10" fill="currentColor" viewBox="0 0 20 20">
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

export default function AgentCard({ agent, onActivate, index = 0 }: AgentCardProps) {
  const btnRef = useRef<HTMLButtonElement>(null);

  const handleActivate = useCallback(() => {
    onActivate(agent);
  }, [agent, onActivate]);

  const handleRipple = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const circle = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    circle.style.cssText = `
      position: absolute;
      width: ${size}px;
      height: ${size}px;
      left: ${x}px;
      top: ${y}px;
      border-radius: 50%;
      background: rgba(0, 212, 255, 0.3);
      transform: scale(0);
      animation: ripple-effect 0.6s ease-out forwards;
      pointer-events: none;
    `;
    btn.appendChild(circle);
    setTimeout(() => circle.remove(), 600);
  }, []);

  return (
    <div
      className="group relative rounded-2xl border border-white/[0.08] backdrop-blur-xl bg-white/[0.03] hover:bg-white/[0.06] transition-all duration-500 cursor-pointer overflow-hidden"
      style={{
        animation: `fadeUp 0.5s ease forwards ${index * 0.04}s`,
        opacity: 0,
        transform: 'translateY(8px)',
      }}
      onClick={handleActivate}
    >
      {/* Hover glow border */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
        style={{
          boxShadow: 'inset 0 0 0 1px rgba(0, 212, 255, 0.2), 0 0 20px rgba(0, 212, 255, 0.1)',
        }}
      />

      <div className="relative p-5 flex flex-col gap-4">
        {/* Header row: Icon + Name + Badge */}
        <div className="flex items-start gap-3">
          {/* Agent Icon */}
          <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${agent.color} flex items-center justify-center text-white text-xl font-bold shadow-lg flex-shrink-0`}>
            {agent.icon}
          </div>

          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-white truncate">{agent.name}</h3>
            <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-white/[0.06] text-cyan-300/80 border border-white/[0.06]">
              {getCategoryLabel(agent.category)}
            </span>
          </div>
        </div>

        {/* Description */}
        <p className="text-[13px] text-[var(--text2)] leading-relaxed line-clamp-2">
          {agent.description}
        </p>

        {/* Capabilities pills */}
        <div className="flex flex-wrap gap-1.5">
          {agent.capabilities.slice(0, 3).map((cap) => (
            <span
              key={cap}
              className="px-2 py-0.5 rounded-md text-[11px] bg-white/[0.04] text-white/50 border border-white/[0.04]"
            >
              {cap}
            </span>
          ))}
        </div>

        {/* Footer: Rating + Usage + Activate */}
        <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
          <div className="flex items-center gap-2">
            <StarRating rating={agent.rating} />
            <span className="text-[11px] text-white/30">{agent.rating}</span>
            <span className="text-[11px] text-white/20">|</span>
            <span className="text-[11px] text-white/30">{formatUsage(agent.usageCount)}</span>
          </div>

          <button
            ref={btnRef}
            onClick={(e) => {
              e.stopPropagation();
              handleRipple(e);
              handleActivate();
            }}
            className="relative overflow-hidden px-4 py-1.5 rounded-lg text-[13px] font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 hover:bg-cyan-500/20 hover:border-cyan-500/40 active:scale-95 transition-all duration-200"
          >
            تفعيل
          </button>
        </div>
      </div>

      <style>{`
        @keyframes ripple-effect {
          to {
            transform: scale(2.5);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}
