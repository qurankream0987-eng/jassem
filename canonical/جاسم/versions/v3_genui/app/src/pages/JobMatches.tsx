import { useMemo } from "react";
import { Sparkles, Target, Zap, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router";
import { mockJobs } from "../data/mockJobs";
import type { MatchResult } from "../types/recruitment";

// Mock candidate CV data (in real app, this would come from context/state)
const candidateSkills = [
  "JavaScript",
  "TypeScript",
  "React",
  "Node.js",
  "SQL",
  "Git",
  "Docker",
  "التواصل",
  "العمل الجماعي",
  "القيادة",
];

const candidateName = "أحمد محمد";
const candidateTitle = "مطور Full Stack";

function calculateMatch(
  jobSkills: string[],
  candidateSkills: string[]
): { score: number; matching: string[]; missing: string[] } {
  const matching: string[] = [];
  const missing: string[] = [];

  jobSkills.forEach((jobSkill) => {
    const isMatch = candidateSkills.some(
      (cs) =>
        cs.toLowerCase().includes(jobSkill.toLowerCase()) ||
        jobSkill.toLowerCase().includes(cs.toLowerCase())
    );
    if (isMatch) {
      matching.push(jobSkill);
    } else {
      missing.push(jobSkill);
    }
  });

  const score = jobSkills.length > 0
    ? Math.round((matching.length / jobSkills.length) * 100)
    : 0;

  return { score, matching, missing };
}

function getScoreColor(score: number): string {
  if (score >= 90) return "text-green-400 border-green-400/50 bg-green-500/10";
  if (score >= 70) return "text-[var(--cyan)] border-[var(--cyan)]/50 bg-[var(--cyan)]/10";
  if (score >= 50) return "text-yellow-400 border-yellow-400/50 bg-yellow-500/10";
  return "text-orange-400 border-orange-400/50 bg-orange-500/10";
}

function getScoreLabel(score: number): string {
  if (score >= 90) return "مطابقة ممتازة";
  if (score >= 70) return "مطابقة جيدة";
  if (score >= 50) return "مطابقة متوسطة";
  return "تحتاج مهارات إضافية";
}

export default function JobMatches() {
  const navigate = useNavigate();

  const matches: MatchResult[] = useMemo(() => {
    return mockJobs
      .map((job) => {
        const { score, matching, missing } = calculateMatch(
          job.skills,
          candidateSkills
        );
        return { job, score, matchingSkills: matching, missingSkills: missing };
      })
      .sort((a, b) => b.score - a.score);
  }, []);

  const handleApply = (jobId: number) => {
    console.log(`Applying for job ${jobId}`);
  };

  return (
    <div className="w-full min-h-screen overflow-y-auto overflow-x-hidden" dir="rtl">
      <div className="max-w-4xl mx-auto p-4 md:p-6 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate("/jobs")}
            className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-white/60" />
          </button>
          <div className="w-11 h-11 rounded-2xl bg-[var(--purple)]/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[var(--purple)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              وظائف موصى بها لك
            </h1>
            <p className="text-white/40 text-sm">بناءً على CVك ومهاراتك</p>
          </div>
        </div>

        {/* Explanation Banner */}
        <div className="mb-6 p-4 rounded-2xl bg-[var(--purple)]/10 border border-[var(--purple)]/30 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <Target className="w-6 h-6 text-[var(--purple)] shrink-0" />
            <div>
              <p className="text-white font-medium">
                بناءً على CVك ومهاراتك، هذه الوظائف الأنسب
              </p>
              <p className="text-white/50 text-sm mt-0.5">
                تم ترتيب الوظائف حسب درجة المطابقة مع مهاراتك: {candidateName} -{" "}
                {candidateTitle}
              </p>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
            <p className="text-2xl font-bold text-[var(--cyan)]">{matches.length}</p>
            <p className="text-xs text-white/40">وظيفة مدروسة</p>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
            <p className="text-2xl font-bold text-green-400">
              {matches.filter((m) => m.score >= 70).length}
            </p>
            <p className="text-xs text-white/40">مطابقة جيدة+</p>
          </div>
          <div className="p-3 rounded-xl bg-white/5 border border-white/10 text-center">
            <p className="text-2xl font-bold text-[var(--purple)]">
              {candidateSkills.length}
            </p>
            <p className="text-xs text-white/40">مهاراتك</p>
          </div>
        </div>

        {/* Match Cards */}
        <div className="space-y-4">
          {matches.map((match) => (
            <div
              key={match.job.id}
              className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5 transition-all duration-300 hover:bg-white/12 hover:border-white/25"
            >
              {/* Top Row: Score + Job Info */}
              <div className="flex flex-col md:flex-row gap-4">
                {/* Score Circle */}
                <div className="flex flex-col items-center justify-center shrink-0">
                  <div
                    className={`w-20 h-20 rounded-full flex flex-col items-center justify-center border-3 ${getScoreColor(
                      match.score
                    )}`}
                  >
                    <span className="text-2xl font-bold">{match.score}%</span>
                  </div>
                  <p className="text-xs mt-2 text-white/40">
                    {getScoreLabel(match.score)}
                  </p>
                </div>

                {/* Job Details */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-lg font-bold text-white">
                    {match.job.title}
                  </h3>
                  <p className="text-[var(--cyan)] text-sm font-medium">
                    {match.job.companyName}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <span className="flex items-center gap-1 text-xs text-white/40">
                      <Zap className="w-3 h-3" />
                      {match.job.location}
                    </span>
                    {match.job.salaryMin > 0 && (
                      <span className="text-xs text-green-400/80">
                        {match.job.salaryMin.toLocaleString()} -{" "}
                        {match.job.salaryMax.toLocaleString()} {match.job.currency}
                      </span>
                    )}
                  </div>

                  {/* Matching Skills */}
                  {match.matchingSkills.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-green-400 mb-1.5">
                        ✅ المهارات المطابقة ({match.matchingSkills.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {match.matchingSkills.map((skill) => (
                          <span
                            key={skill}
                            className="px-2 py-0.5 rounded-md text-xs bg-green-500/15 text-green-400 border border-green-500/25"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Missing Skills */}
                  {match.missingSkills.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs text-orange-400 mb-1.5">
                        ⚠️ مهارات يمكنك تعلمها ({match.missingSkills.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {match.missingSkills.map((skill) => (
                          <span
                            key={skill}
                            className="px-2 py-0.5 rounded-md text-xs bg-orange-500/10 text-orange-400 border border-orange-500/20"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Apply Button */}
                <div className="flex items-end md:self-center">
                  <button
                    onClick={() => handleApply(match.job.id)}
                    className={`px-6 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                      match.score >= 70
                        ? "bg-[var(--cyan)]/20 text-[var(--cyan)] border border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/30"
                        : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    تقديم الآن
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Empty State */}
        {matches.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Sparkles className="w-16 h-16 text-white/15 mb-4" />
            <h3 className="text-lg font-bold text-white/50 mb-2">
              لا توجد وظائف حالياً
            </h3>
            <p className="text-sm text-white/30">
              تحقق لاحقاً للوظائف المضافة حديثاً
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
