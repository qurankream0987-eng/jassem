import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { agents, categories, featuredAgents } from '@/data/agentsData';
import type { Agent, CategoryId } from '@/data/agentsData';
import AgentCard from '@/components/AgentCard';
import CategoryTabs from '@/components/CategoryTabs';
import FeaturedAgents from '@/components/FeaturedAgents';

export default function Agents() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Handle scroll-to-top visibility
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 400);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Filter agents by category and search
  const filteredAgents = useMemo(() => {
    let result = agents;

    if (activeCategory !== 'all') {
      result = result.filter((a) => a.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.capabilities.some((c) => c.toLowerCase().includes(q))
      );
    }

    return result;
  }, [activeCategory, searchQuery]);

  // Featured agents filtered by search too
  const filteredFeatured = useMemo(() => {
    if (!searchQuery.trim()) return featuredAgents;
    const q = searchQuery.toLowerCase().trim();
    return featuredAgents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.capabilities.some((c) => c.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  // Check if we should show featured (no search + all category)
  const showFeatured = activeCategory === 'all' && !searchQuery.trim();

  // Category label
  const activeCategoryLabel = useMemo(
    () => categories.find((c) => c.id === activeCategory)?.name ?? 'الكل',
    [activeCategory]
  );

  // Handlers
  const handleActivate = useCallback((agent: Agent) => {
    // Navigate to chat with this agent, or open modal
    // For now, we can navigate to home with agent context
    window.dispatchEvent(
      new CustomEvent('activate-agent', { detail: agent })
    );
    // eslint-disable-next-line no-console
    console.log('[Agents] Activated agent:', agent.name);
  }, []);

  const handleTryFeatured = useCallback((agent: Agent) => {
    handleActivate(agent);
  }, [handleActivate]);

  const scrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleCategorySelect = useCallback((id: CategoryId) => {
    setActiveCategory(id);
    // Scroll grid to top on category change
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div
      ref={scrollRef}
      className="w-full h-full overflow-y-auto overflow-x-hidden"
      style={{ scrollBehavior: 'smooth' }}
    >
      {/* Background decorative elements */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-500/[0.03] rounded-full blur-[120px]" />
        <div className="absolute top-1/3 right-1/4 w-80 h-80 bg-blue-500/[0.03] rounded-full blur-[100px]" />
        <div className="absolute bottom-0 left-1/3 w-72 h-72 bg-purple-500/[0.02] rounded-full blur-[90px]" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 pb-24">
        {/* ===== HEADER ===== */}
        <div className="text-center mb-10" style={{ animation: 'fadeUp 0.6s ease forwards', opacity: 0, transform: 'translateY(8px)' }}>
          {/* Icon */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/20 mb-5">
            <svg className="w-8 h-8 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
            </svg>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-white mb-3 tracking-tight">
            وكلاء <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">جاسم</span> الذكيين
          </h1>
          <p className="text-[var(--text2)] text-base sm:text-lg max-w-xl mx-auto leading-relaxed">
            اكتشف وفعّل وكلاء AI متخصصين لعملك — من التجارة والمطاعم إلى الصحة والتسويق
          </p>

          {/* Quick stats */}
          <div className="flex items-center justify-center gap-6 mt-6">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-cyan-400">{agents.length}</span>
              <span className="text-xs text-white/40">وكيل متاح</span>
            </div>
            <span className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-green-400">+50K</span>
              <span className="text-xs text-white/40">تفاعل يومي</span>
            </div>
            <span className="w-px h-4 bg-white/10" />
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-purple-400">{categories.length - 1}</span>
              <span className="text-xs text-white/40">تصنيف</span>
            </div>
          </div>
        </div>

        {/* ===== SEARCH BAR ===== */}
        <div className="max-w-xl mx-auto mb-8" style={{ animation: 'fadeUp 0.6s ease 0.1s forwards', opacity: 0, transform: 'translateY(8px)' }}>
          <div className="relative group">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-cyan-500/10 to-blue-500/10 opacity-0 group-focus-within:opacity-100 transition-opacity duration-300" />
            <div className="relative flex items-center rounded-2xl border border-white/[0.08] backdrop-blur-xl bg-white/[0.03] group-focus-within:border-cyan-500/30 group-focus-within:shadow-[0_0_20px_rgba(0,212,255,0.1)] transition-all duration-300">
              <svg className="w-5 h-5 text-white/30 mr-3 flex-shrink-0 mr-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث بوكيل... الاسم، الوصف، أو الخدمة"
                className="flex-1 bg-transparent py-3.5 text-sm text-white placeholder-white/25 outline-none"
                dir="rtl"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="ml-2 mr-2 w-7 h-7 rounded-full flex items-center justify-center bg-white/[0.06] text-white/40 hover:text-white hover:bg-white/[0.1] transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ===== CATEGORY TABS ===== */}
        <div className="mb-8" style={{ animation: 'fadeUp 0.6s ease 0.2s forwards', opacity: 0, transform: 'translateY(8px)' }}>
          <CategoryTabs active={activeCategory} onSelect={handleCategorySelect} />
        </div>

        {/* ===== FEATURED SECTION ===== */}
        {showFeatured && (
          <div className="mb-10">
            <FeaturedAgents agents={filteredFeatured} onTry={handleTryFeatured} />
          </div>
        )}

        {/* Divider when showing featured */}
        {showFeatured && (
          <div className="flex items-center gap-4 mb-8">
            <div className="flex-1 h-px bg-white/[0.06]" />
            <span className="text-xs text-white/30 font-medium">جميع الوكلاء</span>
            <div className="flex-1 h-px bg-white/[0.06]" />
          </div>
        )}

        {/* ===== AGENT GRID ===== */}
        <div className="mb-6">
          {/* Section title */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <div className="w-1 h-5 rounded-full bg-gradient-to-b from-cyan-400 to-blue-500" />
              <h2 className="text-base font-bold text-white">
                {searchQuery.trim()
                  ? `نتائج البحث: "${searchQuery}"`
                  : activeCategory === 'all'
                    ? 'جميع الوكلاء'
                    : activeCategoryLabel}
              </h2>
              <span className="text-xs text-white/30 font-medium">
                {filteredAgents.length} وكيل
              </span>
            </div>
          </div>

          {filteredAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-4">
                <svg className="w-8 h-8 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <p className="text-white/40 text-sm mb-2">لا توجد نتائج</p>
              <p className="text-white/25 text-xs">جرب كلمة بحث مختلفة أو تصنيف آخر</p>
              <button
                onClick={() => { setSearchQuery(''); setActiveCategory('all'); }}
                className="mt-4 px-4 py-2 rounded-xl text-sm bg-white/[0.05] text-white/60 border border-white/[0.08] hover:bg-white/[0.08] hover:text-white transition-all"
              >
                عرض جميع الوكلاء
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredAgents.map((agent, i) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  onActivate={handleActivate}
                  index={i}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {filteredAgents.length > 0 && (
          <div className="text-center py-8">
            <p className="text-xs text-white/20">
              انقر على "تفعيل" لبدء استخدام الوكيل
            </p>
          </div>
        )}
      </div>

      {/* Scroll to top button */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 left-6 w-10 h-10 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/[0.1] text-white/50 hover:text-cyan-300 hover:bg-white/[0.1] hover:border-cyan-500/30 transition-all duration-300 backdrop-blur-xl z-50"
          aria-label="Scroll to top"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
}
