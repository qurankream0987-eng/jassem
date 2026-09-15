import { MapPin, Clock, DollarSign, Calendar, Sparkles } from "lucide-react";
import {
  jobTypeLabels,
  levelLabels,
  jobTypeColors,
  levelColors,
} from "../data/mockJobs";
import type { JobPost } from "../types/recruitment";

interface JobCardProps {
  job: JobPost;
  matchScore?: number;
  candidateSkills?: string[];
  onApply?: (jobId: number) => void;
  showMatchScore?: boolean;
}

export default function JobCard({
  job,
  matchScore,
  candidateSkills = [],
  onApply,
  showMatchScore = false,
}: JobCardProps) {
  const postedDate = new Date(job.createdAt).toLocaleDateString("ar-KW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const matchingSkills = candidateSkills.filter((skill) =>
    job.skills.some(
      (js) =>
        js.toLowerCase().includes(skill.toLowerCase()) ||
        skill.toLowerCase().includes(js.toLowerCase())
    )
  );

  return (
    <div
      className="relative rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5 transition-all duration-300 hover:bg-white/12 hover:border-white/25 hover:shadow-xl hover:shadow-[var(--cyan)]/5"
      dir="rtl"
    >
      {/* Match Score Badge */}
      {showMatchScore && matchScore !== undefined && (
        <div className="absolute top-4 left-4 flex items-center gap-1.5">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 ${
              matchScore >= 90
                ? "bg-green-500/20 text-green-400 border-green-500/50"
                : matchScore >= 70
                ? "bg-[var(--cyan)]/20 text-[var(--cyan)] border-[var(--cyan)]/50"
                : matchScore >= 50
                ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/50"
                : "bg-orange-500/20 text-orange-400 border-orange-500/50"
            }`}
          >
            {matchScore}%
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-3">
        <h3 className="text-lg font-bold text-white leading-tight">{job.title}</h3>
        <p className="text-[var(--cyan)] text-sm mt-0.5 font-medium">{job.companyName}</p>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
            jobTypeColors[job.jobType] || jobTypeColors.full_time
          }`}
        >
          {jobTypeLabels[job.jobType] || job.jobType}
        </span>
        <span
          className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${
            levelColors[job.level] || levelColors.mid
          }`}
        >
          {levelLabels[job.level] || job.level}
        </span>
      </div>

      {/* Details */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-white/50 mb-3">
        <span className="flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5" />
          {job.location}
        </span>
        <span className="flex items-center gap-1">
          <Clock className="w-3.5 h-3.5" />
          {postedDate}
        </span>
        {job.salaryMin > 0 && (
          <span className="flex items-center gap-1 text-green-400/80">
            <DollarSign className="w-3.5 h-3.5" />
            {job.salaryMin.toLocaleString()} - {job.salaryMax.toLocaleString()} {job.currency}
          </span>
        )}
      </div>

      {/* Skills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {job.skills.map((skill) => {
          const isMatch = candidateSkills.some(
            (cs) =>
              cs.toLowerCase().includes(skill.toLowerCase()) ||
              skill.toLowerCase().includes(cs.toLowerCase())
          );
          return (
            <span
              key={skill}
              className={`px-2 py-0.5 rounded-md text-xs ${
                isMatch
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-white/5 text-white/40 border border-white/10"
              }`}
            >
              {isMatch && <Sparkles className="w-3 h-3 inline ml-1" />}
              {skill}
            </span>
          );
        })}
      </div>

      {/* Match info */}
      {showMatchScore && matchingSkills.length > 0 && (
        <div className="mb-3 p-2 rounded-lg bg-green-500/10 border border-green-500/20">
          <p className="text-xs text-green-400">
            {matchingSkills.length} مهارات مطابقة: {matchingSkills.join("، ")}
          </p>
        </div>
      )}

      {/* Apply Button */}
      {onApply && (
        <button
          onClick={() => onApply(job.id)}
          className="w-full py-2.5 rounded-xl bg-[var(--cyan)]/20 text-[var(--cyan)] text-sm font-semibold border border-[var(--cyan)]/30 hover:bg-[var(--cyan)]/30 transition-all duration-300"
        >
          تقديم
        </button>
      )}
    </div>
  );
}
