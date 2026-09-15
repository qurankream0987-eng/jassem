import { useRef, useCallback } from 'react';
import { categories } from '@/data/agentsData';
import type { CategoryId } from '@/data/agentsData';

interface CategoryTabsProps {
  active: CategoryId;
  onSelect: (id: CategoryId) => void;
}

export default function CategoryTabs({ active, onSelect }: CategoryTabsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const scroll = useCallback((dir: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = dir === 'left' ? -200 : 200;
    el.scrollBy({ left: amount, behavior: 'smooth' });
  }, []);

  return (
    <div className="relative flex items-center gap-2">
      {/* Left arrow */}
      <button
        onClick={() => scroll('left')}
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-cyan-300 hover:bg-white/[0.08] hover:border-cyan-500/20 transition-all duration-300 backdrop-blur-xl"
        aria-label="Scroll left"
      >
        <svg className="w-4 h-4 rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Tabs container */}
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide py-1 px-0.5"
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {categories.map((cat) => {
          const isActive = active === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => onSelect(cat.id)}
              className={`
                relative flex-shrink-0 px-5 py-2 rounded-xl text-sm font-medium
                border backdrop-blur-xl transition-all duration-300
                ${isActive
                  ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 shadow-[0_0_16px_rgba(0,212,255,0.15)]'
                  : 'bg-white/[0.03] border-white/[0.06] text-white/50 hover:bg-white/[0.06] hover:text-white/70 hover:border-white/[0.1]'
                }
              `}
            >
              {cat.name}
              {/* Active underline glow */}
              {isActive && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,212,255,0.6)]" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => scroll('right')}
        className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.04] border border-white/[0.08] text-white/50 hover:text-cyan-300 hover:bg-white/[0.08] hover:border-cyan-500/20 transition-all duration-300 backdrop-blur-xl"
        aria-label="Scroll right"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
