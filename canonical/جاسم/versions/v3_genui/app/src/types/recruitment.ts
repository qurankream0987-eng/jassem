// Recruitment module type definitions

export interface PersonalInfo {
  fullName: string;
  email: string;
  phone: string;
  location: string;
  title: string;
}

export interface ExperienceEntry {
  id: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface EducationEntry {
  id: string;
  degree: string;
  institution: string;
  year: string;
}

export interface LanguageEntry {
  language: string;
  proficiency: "beginner" | "intermediate" | "advanced" | "fluent" | "native";
}

export interface CVData {
  personalInfo: PersonalInfo;
  summary: string;
  experiences: ExperienceEntry[];
  education: EducationEntry[];
  skills: string[];
  languages: LanguageEntry[];
  template: "modern" | "classic" | "minimal";
}

export interface JobPost {
  id: number;
  merchantId: number;
  companyName: string;
  title: string;
  description: string;
  requirements: string[];
  skills: string[];
  salaryMin: number;
  salaryMax: number;
  currency: string;
  jobType: "full_time" | "part_time" | "contract" | "freelance";
  level: "entry" | "mid" | "senior" | "lead";
  location: string;
  marketCode: string;
  isActive: boolean;
  viewCount: number;
  applyCount: number;
  createdAt: string;
}

export interface JobFilters {
  keyword: string;
  jobType: string;
  level: string;
  marketCode: string;
  selectedSkills: string[];
}

export interface MatchResult {
  job: JobPost;
  score: number;
  matchingSkills: string[];
  missingSkills: string[];
}

export type CVTemplate = "modern" | "classic" | "minimal";

export const proficiencyLabels: Record<string, string> = {
  beginner: "مبتدئ",
  intermediate: "متوسط",
  advanced: "متقدم",
  fluent: "طلاقة",
  native: "لغة أم",
};
