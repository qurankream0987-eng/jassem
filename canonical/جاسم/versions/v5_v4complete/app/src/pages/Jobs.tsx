import { useState, useMemo } from "react";
import {
  Search,
  SlidersHorizontal,
  Frown,
  MapPin,
  Briefcase,
  Loader2,
} from "lucide-react";
import { trpc } from "../providers/trpc";
import JobCard from "../components/JobCard";
import {
  mockJobs,
  arabCountries,
  commonSkills,
  jobTypeLabels,
  levelLabels,
} from "../data/mockJobs";
import type { JobPost, JobFilters } from "../types/recruitment";

export default function Jobs() {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<JobFilters>({
    keyword: "",
    jobType: "",
    level: "",
    marketCode: "",
    selectedSkills: [],
  });
  const [skillInput, setSkillInput] = useState("");

  // Try to fetch from API, fallback to mock data
  const jobsQuery = trpc.recruitment.listJobs.useQuery(
    {
      marketCode: filters.marketCode || undefined,
      jobType: filters.jobType || undefined,
      active: true,
    },
    { enabled: false }
  );

  // Use mock data for now since the API needs data seeded
  const jobs = mockJobs;

  // Candidate skills for match highlighting (mock)
  const candidateSkills = ["JavaScript", "React", "TypeScript", "التواصل", "العمل الجماعي"];

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      // Keyword filter
      if (filters.keyword) {
        const kw = filters.keyword.toLowerCase();
        const matchTitle = job.title.toLowerCase().includes(kw);
        const matchCompany = job.companyName.toLowerCase().includes(kw);
        const matchDesc = job.description.toLowerCase().includes(kw);
        const matchSkills = job.skills.some((s) => s.toLowerCase().includes(kw));
        if (!matchTitle && !matchCompany && !matchDesc && !matchSkills) return false;
      }

      // Job type filter
      if (filters.jobType && job.jobType !== filters.jobType) return false;

      // Level filter
      if (filters.level && job.level !== filters.level) return false;

      // Market filter
      if (filters.marketCode && job.marketCode !== filters.marketCode) return false;

      // Skills filter
      if (filters.selectedSkills.length > 0) {
        const hasAllSkills = filters.selectedSkills.every((skill) =>
          job.skills.some(
            (js) =>
              js.toLowerCase().includes(skill.toLowerCase()) ||
              skill.toLowerCase().includes(js.toLowerCase())
          )
        );
        if (!hasAllSkills) return false;
      }

      return true;
    });
  }, [jobs, filters]);

  const handleAddSkill = (skill: string) => {
    const trimmed = skill.trim();
    if (trimmed && !filters.selectedSkills.includes(trimmed)) {
      setFilters((prev) => ({
        ...prev,
        selectedSkills: [...prev.selectedSkills, trimmed],
      }));
    }
    setSkillInput("");
  };

  const handleRemoveSkill = (skill: string) => {
    setFilters((prev) => ({
      ...prev,
      selectedSkills: prev.selectedSkills.filter((s) => s !== skill),
    }));
  };

  const activeFiltersCount = [
    filters.keyword,
    filters.jobType,
    filters.level,
    filters.marketCode,
    ...filters.selectedSkills,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setFilters({
      keyword: "",
      jobType: "",
      level: "",
      marketCode: "",
      selectedSkills: [],
    });
  };

  const applyMutation = trpc.recruitment.apply.useMutation();

  const handleApply = (jobId: number) => {
    // In a real app, this would use the actual candidateId
    console.log(`Applying for job ${jobId}`);
  };

  return (
    <div className="w-full min-h-screen overflow-y-auto overflow-x-hidden" dir="rtl">
      <div className="max-w-6xl mx-auto p-4 md:p-6 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-11 h-11 rounded-2xl bg-[var(--green)]/15 flex items-center justify-center">
            <Briefcase className="w-5 h-5 text-[var(--green)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">فرص العمل</h1>
            <p className="text-white/40 text-sm">
              {filteredJobs.length} وظيفة متاحة
            </p>
          </div>
        </div>

        {/* Search Bar */}
        <div className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-4 mb-4">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <input
                type="text"
                value={filters.keyword}
                onChange={(e) =>
                  setFilters((prev) => ({ ...prev, keyword: e.target.value }))
                }
                placeholder="ابحث عن وظيفة، شركة، أو مهارة..."
                className="w-full pr-10 pl-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                dir="rtl"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                showFilters || activeFiltersCount > 0
                  ? "bg-[var(--cyan)]/20 text-[var(--cyan)] border border-[var(--cyan)]/40"
                  : "bg-white/5 text-white/60 border border-white/15 hover:bg-white/10"
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              فلترة
              {activeFiltersCount > 0 && (
                <span className="w-5 h-5 rounded-full bg-[var(--cyan)] text-black text-xs font-bold flex items-center justify-center">
                  {activeFiltersCount}
                </span>
              )}
            </button>
          </div>

          {/* Expandable Filters */}
          {showFilters && (
            <div className="mt-4 pt-4 border-t border-white/10 animate-[fadeUp_0.3s_ease-out]">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Job Type */}
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">
                    نوع الوظيفة
                  </label>
                  <select
                    value={filters.jobType}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, jobType: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  >
                    <option value="" className="bg-gray-900">
                      الكل
                    </option>
                    {Object.entries(jobTypeLabels).map(([key, label]) => (
                      <option key={key} value={key} className="bg-gray-900">
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Level */}
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">
                    المستوى
                  </label>
                  <select
                    value={filters.level}
                    onChange={(e) =>
                      setFilters((prev) => ({ ...prev, level: e.target.value }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  >
                    <option value="" className="bg-gray-900">
                      الكل
                    </option>
                    {Object.entries(levelLabels).map(([key, label]) => (
                      <option key={key} value={key} className="bg-gray-900">
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Market */}
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">
                    الدولة
                  </label>
                  <select
                    value={filters.marketCode}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        marketCode: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  >
                    <option value="" className="bg-gray-900">
                      جميع الدول
                    </option>
                    {arabCountries.map((c) => (
                      <option key={c.code} value={c.code} className="bg-gray-900">
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Skills Filter */}
              <div className="mt-4">
                <label className="block text-xs text-white/50 mb-1.5">
                  المهارات المطلوبة
                </label>
                <div className="flex flex-wrap gap-2">
                  {filters.selectedSkills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium bg-[var(--cyan)]/20 text-[var(--cyan)] border border-[var(--cyan)]/30"
                    >
                      {skill}
                      <button
                        onClick={() => handleRemoveSkill(skill)}
                        className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-[var(--cyan)]/30"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </span>
                  ))}
                  <div className="relative">
                    <input
                      type="text"
                      value={skillInput}
                      onChange={(e) => setSkillInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddSkill(skillInput);
                        }
                      }}
                      placeholder="إضافة مهارة..."
                      className="px-3 py-1 rounded-full bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                      dir="rtl"
                      list="skills-suggestions"
                    />
                    <datalist id="skills-suggestions">
                      {commonSkills.map((s) => (
                        <option key={s} value={s} />
                      ))}
                    </datalist>
                  </div>
                </div>
              </div>

              {/* Clear Filters */}
              {activeFiltersCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="mt-4 text-sm text-[var(--cyan)] hover:text-[var(--cyan)]/80 transition-colors"
                >
                  مسح جميع الفلاتر
                </button>
              )}
            </div>
          )}
        </div>

        {/* Job Count */}
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-white/40">
            {filteredJobs.length === 0
              ? "لا توجد وظائف مطابقة"
              : `عرض ${filteredJobs.length} وظيفة`}
          </p>
          {activeFiltersCount > 0 && (
            <button
              onClick={clearFilters}
              className="text-xs text-[var(--cyan)] hover:underline"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {/* Job Cards */}
        {filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Frown className="w-16 h-16 text-white/15 mb-4" />
            <h3 className="text-lg font-bold text-white/50 mb-2">
              لا توجد وظائف مطابقة
            </h3>
            <p className="text-sm text-white/30 max-w-md">
              لم نجد وظائف تطابق معايير البحث. جرب تعديل الفلاتر أو استخدم كلمات
              بحث مختلفة.
            </p>
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="mt-4 px-5 py-2 rounded-xl bg-[var(--cyan)]/20 text-[var(--cyan)] text-sm font-medium border border-[var(--cyan)]/30 hover:bg-[var(--cyan)]/30 transition-all"
              >
                مسح الفلاتر
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                candidateSkills={candidateSkills}
                onApply={handleApply}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
