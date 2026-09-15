import { useState, useCallback } from "react";
import { Sparkles, Loader2, FileText, Eye, Download, Wand2, User, GraduationCap, Code2, Languages, Briefcase, Layout, LayoutGrid, File } from "lucide-react";
import { trpc } from "../providers/trpc";
import SkillInput from "../components/SkillInput";
import ExperienceForm from "../components/ExperienceForm";
import CVPreview from "../components/CVPreview";
import type { CVData, ExperienceEntry, EducationEntry, LanguageEntry, CVTemplate } from "../types/recruitment";
import { proficiencyLabels } from "../types/recruitment";

const initialCVData: CVData = {
  personalInfo: {
    fullName: "",
    email: "",
    phone: "",
    location: "",
    title: "",
  },
  summary: "",
  experiences: [],
  education: [],
  skills: [],
  languages: [],
  template: "modern",
};

const templateOptions: { value: CVTemplate; label: string; icon: typeof Layout }[] = [
  { value: "modern", label: "عصري", icon: Layout },
  { value: "classic", label: "كلاسيكي", icon: FileText },
  { value: "minimal", label: "بسيط", icon: LayoutGrid },
];

let eduIdCounter = 0;
function generateEduId() {
  return `edu-${Date.now()}-${++eduIdCounter}`;
}

export default function CVBuilder() {
  const [cvData, setCvData] = useState<CVData>(initialCVData);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCV, setGeneratedCV] = useState<{
    summary: string;
    skills: string[];
    experience: string;
    score: number;
  } | null>(null);

  const generateQuery = trpc.recruitment.generateCV.useQuery(
    {
      role: cvData.personalInfo.title || "مطور",
      name: cvData.personalInfo.fullName || undefined,
      experience: cvData.experiences.length,
      skills: cvData.skills,
    },
    { enabled: false }
  );

  const handleGenerate = useCallback(async () => {
    setIsGenerating(true);
    try {
      const result = await generateQuery.refetch();
      if (result.data) {
        setGeneratedCV(result.data);
        setCvData((prev) => ({
          ...prev,
          summary: result.data.summary || prev.summary,
          skills: result.data.skills?.length ? result.data.skills : prev.skills,
        }));
      }
    } catch {
      // silent fail
    }
    setIsGenerating(false);
  }, [generateQuery]);

  const updatePersonalInfo = (field: keyof typeof cvData.personalInfo, value: string) => {
    setCvData((prev) => ({
      ...prev,
      personalInfo: { ...prev.personalInfo, [field]: value },
    }));
  };

  const addEducation = () => {
    const newEdu: EducationEntry = {
      id: generateEduId(),
      degree: "",
      institution: "",
      year: "",
    };
    setCvData((prev) => ({ ...prev, education: [...prev.education, newEdu] }));
  };

  const updateEducation = (id: string, field: keyof EducationEntry, value: string) => {
    setCvData((prev) => ({
      ...prev,
      education: prev.education.map((e) =>
        e.id === id ? { ...e, [field]: value } : e
      ),
    }));
  };

  const removeEducation = (id: string) => {
    setCvData((prev) => ({
      ...prev,
      education: prev.education.filter((e) => e.id !== id),
    }));
  };

  const addLanguage = () => {
    const newLang: LanguageEntry = {
      language: "",
      proficiency: "intermediate",
    };
    setCvData((prev) => ({ ...prev, languages: [...prev.languages, newLang] }));
  };

  const updateLanguage = (index: number, field: keyof LanguageEntry, value: string) => {
    setCvData((prev) => ({
      ...prev,
      languages: prev.languages.map((l, i) =>
        i === index ? { ...l, [field]: value } : l
      ),
    }));
  };

  const removeLanguage = (index: number) => {
    setCvData((prev) => ({
      ...prev,
      languages: prev.languages.filter((_, i) => i !== index),
    }));
  };

  const halfPriceCountries = ["JO", "EG", "SY"];

  return (
    <div className="w-full min-h-screen overflow-y-auto overflow-x-hidden" dir="rtl">
      <div className="max-w-7xl mx-auto p-4 md:p-6 pb-24">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-2xl bg-[var(--cyan)]/15 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-[var(--cyan)]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">
              منشئ CV بالذكاء الاصطناعي
            </h1>
            <p className="text-white/40 text-sm">
              أنشئ سيرتك الذاتية بمساعدة الذكاء الاصطناعي
            </p>
          </div>
        </div>

        {/* Pricing Banner */}
        <div className="mb-6 p-4 rounded-2xl bg-[var(--gold)]/10 border border-[var(--gold)]/30 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="text-2xl shrink-0">🇯🇴 🇪🇬 🇸🇾</div>
            <div>
              <p className="text-[var(--gold)] font-bold text-lg">
                الأردن 🇯🇴 مصر 🇪🇬 سوريا 🇸🇾 = نصف السعر!
              </p>
              <p className="text-white/60 text-sm">
                استمتع بخصم 50% على خدمات إنشاء CV وكل خدمات المنصة
              </p>
            </div>
          </div>
        </div>

        {/* Template Selector */}
        <div className="mb-6 flex flex-wrap gap-2">
          <span className="text-sm text-white/50 flex items-center gap-1.5 ml-2">
            <File className="w-4 h-4" />
            قالب CV:
          </span>
          {templateOptions.map((t) => (
            <button
              key={t.value}
              onClick={() => setCvData((prev) => ({ ...prev, template: t.value }))}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-300 ${
                cvData.template === t.value
                  ? "bg-[var(--cyan)]/20 text-[var(--cyan)] border border-[var(--cyan)]/40"
                  : "bg-white/5 text-white/50 border border-white/10 hover:bg-white/10"
              }`}
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Form Column */}
          <div className="space-y-4">
            {/* Personal Info */}
            <div className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white mb-4">
                <User className="w-5 h-5 text-[var(--cyan)]" />
                المعلومات الشخصية
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">الاسم الكامل</label>
                  <input
                    type="text"
                    value={cvData.personalInfo.fullName}
                    onChange={(e) => updatePersonalInfo("fullName", e.target.value)}
                    placeholder="محمد أحمد"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">المسمى الوظيفي</label>
                  <input
                    type="text"
                    value={cvData.personalInfo.title}
                    onChange={(e) => updatePersonalInfo("title", e.target.value)}
                    placeholder="مطور برمجيات"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">البريد الإلكتروني</label>
                  <input
                    type="email"
                    value={cvData.personalInfo.email}
                    onChange={(e) => updatePersonalInfo("email", e.target.value)}
                    placeholder="email@example.com"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="ltr"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">رقم الهاتف</label>
                  <input
                    type="tel"
                    value={cvData.personalInfo.phone}
                    onChange={(e) => updatePersonalInfo("phone", e.target.value)}
                    placeholder="+965 1234 5678"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="ltr"
                  />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs text-white/50 mb-1.5">الموقع</label>
                  <input
                    type="text"
                    value={cvData.personalInfo.location}
                    onChange={(e) => updatePersonalInfo("location", e.target.value)}
                    placeholder="الكويت"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  />
                </div>
              </div>
            </div>

            {/* Professional Summary */}
            <div className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="flex items-center gap-2 text-lg font-bold text-white">
                  <Wand2 className="w-5 h-5 text-[var(--purple)]" />
                  الملخص المهني
                </h2>
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !cvData.personalInfo.title}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--purple)]/15 text-[var(--purple)] text-xs font-medium border border-[var(--purple)]/30 hover:bg-[var(--purple)]/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {isGenerating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  مساعدة AI
                </button>
              </div>
              <textarea
                value={cvData.summary}
                onChange={(e) =>
                  setCvData((prev) => ({ ...prev, summary: e.target.value }))
                }
                placeholder="اكتب ملخصاً مهنياً موجزاً عن خبراتك ومهاراتك..."
                rows={4}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors resize-none"
                dir="rtl"
              />
            </div>

            {/* Experience */}
            <div className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white mb-4">
                <Briefcase className="w-5 h-5 text-[var(--green)]" />
                الخبرات العملية
              </h2>
              <ExperienceForm
                experiences={cvData.experiences}
                onChange={(experiences) =>
                  setCvData((prev) => ({ ...prev, experiences }))
                }
              />
            </div>

            {/* Education */}
            <div className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white mb-4">
                <GraduationCap className="w-5 h-5 text-[var(--gold)]" />
                التعليم
              </h2>
              <div className="space-y-3">
                {cvData.education.map((edu, index) => (
                  <div
                    key={edu.id}
                    className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-xl bg-white/5 border border-white/10"
                  >
                    <div>
                      <label className="block text-xs text-white/50 mb-1">الشهادة</label>
                      <input
                        type="text"
                        value={edu.degree}
                        onChange={(e) => updateEducation(edu.id, "degree", e.target.value)}
                        placeholder="بكالوريوس"
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                        dir="rtl"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-white/50 mb-1">المؤسسة</label>
                      <input
                        type="text"
                        value={edu.institution}
                        onChange={(e) => updateEducation(edu.id, "institution", e.target.value)}
                        placeholder="جامعة الكويت"
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                        dir="rtl"
                      />
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="block text-xs text-white/50 mb-1">السنة</label>
                        <input
                          type="text"
                          value={edu.year}
                          onChange={(e) => updateEducation(edu.id, "year", e.target.value)}
                          placeholder="2020"
                          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                          dir="ltr"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeEducation(edu.id)}
                        className="self-end mb-0.5 px-2 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addEducation}
                  className="w-full py-2.5 rounded-xl border border-dashed border-[var(--gold)]/30 text-[var(--gold)] text-sm font-medium hover:bg-[var(--gold)]/10 transition-all"
                >
                  + إضافة شهادة
                </button>
              </div>
            </div>

            {/* Skills */}
            <div className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white mb-4">
                <Code2 className="w-5 h-5 text-[var(--cyan)]" />
                المهارات
              </h2>
              <SkillInput
                skills={cvData.skills}
                onChange={(skills) => setCvData((prev) => ({ ...prev, skills }))}
              />
            </div>

            {/* Languages */}
            <div className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl p-5">
              <h2 className="flex items-center gap-2 text-lg font-bold text-white mb-4">
                <Languages className="w-5 h-5 text-[var(--pink)]" />
                اللغات
              </h2>
              <div className="space-y-3">
                {cvData.languages.map((lang, index) => (
                  <div
                    key={index}
                    className="flex gap-3 items-end p-3 rounded-xl bg-white/5 border border-white/10"
                  >
                    <div className="flex-1">
                      <label className="block text-xs text-white/50 mb-1">اللغة</label>
                      <input
                        type="text"
                        value={lang.language}
                        onChange={(e) => updateLanguage(index, "language", e.target.value)}
                        placeholder="مثال: العربية"
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                        dir="rtl"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs text-white/50 mb-1">المستوى</label>
                      <select
                        value={lang.proficiency}
                        onChange={(e) => updateLanguage(index, "proficiency", e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/15 text-white text-sm outline-none focus:border-[var(--cyan)]/50 transition-colors"
                        dir="rtl"
                      >
                        {Object.entries(proficiencyLabels).map(([key, label]) => (
                          <option key={key} value={key} className="bg-gray-900">
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLanguage(index)}
                      className="self-end mb-0.5 px-2 py-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addLanguage}
                  className="w-full py-2.5 rounded-xl border border-dashed border-[var(--pink)]/30 text-[var(--pink)] text-sm font-medium hover:bg-[var(--pink)]/10 transition-all"
                >
                  + إضافة لغة
                </button>
              </div>
            </div>

            {/* AI Generate Button */}
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !cvData.personalInfo.title}
              className="w-full py-4 rounded-2xl bg-[var(--cyan)]/20 text-[var(--cyan)] text-base font-bold border border-[var(--cyan)]/40 hover:bg-[var(--cyan)]/30 transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-[var(--cyan)]/10"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  جاري إنشاء CV الذكي...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  ✨ أنشئ CV ذكي
                </>
              )}
            </button>

            {/* AI Score */}
            {generatedCV?.score && (
              <div className="p-4 rounded-2xl bg-[var(--green)]/10 border border-[var(--green)]/30 text-center">
                <p className="text-[var(--green)] font-bold text-lg">
                  درجة CV الذكية: {generatedCV.score}%
                </p>
              </div>
            )}
          </div>

          {/* Preview Column */}
          <div className="lg:sticky lg:top-4 lg:self-start">
            <div className="flex items-center gap-2 mb-4">
              <Eye className="w-4 h-4 text-white/50" />
              <span className="text-sm text-white/50">معاينة مباشرة</span>
            </div>
            <CVPreview cvData={cvData} template={cvData.template} />

            {/* Export Button */}
            <button
              className="w-full mt-4 py-3 rounded-2xl bg-white/5 text-white/50 text-sm font-medium border border-white/10 hover:bg-white/10 transition-all flex items-center justify-center gap-2 cursor-not-allowed"
              disabled
            >
              <Download className="w-4 h-4" />
              تصدير PDF قريباً
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
