import {
  Mail,
  Phone,
  MapPin,
  Briefcase,
  GraduationCap,
  Code2,
  Languages,
  User,
} from "lucide-react";
import type { CVData, CVTemplate } from "../types/recruitment";

interface CVPreviewProps {
  cvData: CVData;
  template?: CVTemplate;
}

export default function CVPreview({ cvData, template = "modern" }: CVPreviewProps) {
  const { personalInfo, summary, experiences, education, skills, languages } = cvData;

  if (template === "classic") {
    return <ClassicTemplate cvData={cvData} />;
  }
  if (template === "minimal") {
    return <MinimalTemplate cvData={cvData} />;
  }
  return <ModernTemplate cvData={cvData} />;
}

function ModernTemplate({ cvData }: { cvData: CVData }) {
  const { personalInfo, summary, experiences, education, skills, languages } = cvData;

  return (
    <div className="bg-white text-gray-800 rounded-2xl overflow-hidden shadow-2xl max-w-2xl mx-auto" dir="rtl">
      {/* Header */}
      <div className="bg-[var(--blue)] text-white p-6">
        <h2 className="text-2xl font-bold">{personalInfo.fullName || "الاسم الكامل"}</h2>
        <p className="text-white/80 mt-1">{personalInfo.title || "المسمى الوظيفي"}</p>
        <div className="flex flex-wrap gap-4 mt-3 text-sm">
          {personalInfo.email && (
            <span className="flex items-center gap-1.5">
              <Mail className="w-3.5 h-3.5" />
              {personalInfo.email}
            </span>
          )}
          {personalInfo.phone && (
            <span className="flex items-center gap-1.5">
              <Phone className="w-3.5 h-3.5" />
              {personalInfo.phone}
            </span>
          )}
          {personalInfo.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {personalInfo.location}
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* Summary */}
        {summary && (
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--blue)] mb-2">
              <User className="w-5 h-5" />
              الملخص المهني
            </h3>
            <p className="text-gray-600 text-sm leading-relaxed">{summary}</p>
          </div>
        )}

        {/* Experience */}
        {experiences.length > 0 && (
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--blue)] mb-3">
              <Briefcase className="w-5 h-5" />
              الخبرات العملية
            </h3>
            <div className="space-y-3">
              {experiences.map((exp) => (
                <div key={exp.id} className="border-r-2 border-[var(--blue)]/20 pr-3">
                  <p className="font-semibold text-gray-800">{exp.role}</p>
                  <p className="text-sm text-gray-500">
                    {exp.company}
                    {exp.startDate && ` • ${exp.startDate} - ${exp.endDate || "حتى الآن"}`}
                  </p>
                  {exp.description && (
                    <p className="text-sm text-gray-600 mt-1">{exp.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Education */}
        {education.length > 0 && (
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--blue)] mb-3">
              <GraduationCap className="w-5 h-5" />
              التعليم
            </h3>
            <div className="space-y-2">
              {education.map((edu) => (
                <div key={edu.id} className="border-r-2 border-[var(--blue)]/20 pr-3">
                  <p className="font-semibold text-gray-800">{edu.degree}</p>
                  <p className="text-sm text-gray-500">
                    {edu.institution}
                    {edu.year && ` • ${edu.year}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--blue)] mb-3">
              <Code2 className="w-5 h-5" />
              المهارات
            </h3>
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="px-3 py-1 rounded-full text-sm bg-[var(--blue)]/10 text-[var(--blue)] border border-[var(--blue)]/20"
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Languages */}
        {languages.length > 0 && (
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--blue)] mb-3">
              <Languages className="w-5 h-5" />
              اللغات
            </h3>
            <div className="flex flex-wrap gap-2">
              {languages.map((lang, i) => (
                <span
                  key={i}
                  className="px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-600 border border-gray-200"
                >
                  {lang.language} - {lang.proficiency}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ClassicTemplate({ cvData }: { cvData: CVData }) {
  const { personalInfo, summary, experiences, education, skills, languages } = cvData;

  return (
    <div className="bg-white text-gray-800 rounded-2xl overflow-hidden shadow-2xl max-w-2xl mx-auto" dir="rtl">
      <div className="p-8">
        {/* Header */}
        <div className="text-center border-b-2 border-gray-800 pb-4 mb-6">
          <h2 className="text-3xl font-bold text-gray-900">{personalInfo.fullName || "الاسم الكامل"}</h2>
          <p className="text-gray-600 mt-1">{personalInfo.title || "المسمى الوظيفي"}</p>
          <div className="flex flex-wrap justify-center gap-4 mt-3 text-sm text-gray-500">
            {personalInfo.email && <span>{personalInfo.email}</span>}
            {personalInfo.phone && <span>{personalInfo.phone}</span>}
            {personalInfo.location && <span>{personalInfo.location}</span>}
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div className="mb-5">
            <h3 className="text-lg font-bold text-gray-900 border-b border-gray-300 pb-1 mb-2">
              الملخص المهني
            </h3>
            <p className="text-gray-600 text-sm leading-relaxed">{summary}</p>
          </div>
        )}

        {/* Experience */}
        {experiences.length > 0 && (
          <div className="mb-5">
            <h3 className="text-lg font-bold text-gray-900 border-b border-gray-300 pb-1 mb-2">
              الخبرات العملية
            </h3>
            <div className="space-y-3">
              {experiences.map((exp) => (
                <div key={exp.id}>
                  <p className="font-semibold text-gray-800">{exp.role}</p>
                  <p className="text-sm text-gray-500 italic">
                    {exp.company}
                    {exp.startDate && ` | ${exp.startDate} - ${exp.endDate || "حتى الآن"}`}
                  </p>
                  {exp.description && <p className="text-sm text-gray-600 mt-1">{exp.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Education */}
        {education.length > 0 && (
          <div className="mb-5">
            <h3 className="text-lg font-bold text-gray-900 border-b border-gray-300 pb-1 mb-2">
              التعليم
            </h3>
            <div className="space-y-2">
              {education.map((edu) => (
                <div key={edu.id}>
                  <p className="font-semibold text-gray-800">{edu.degree}</p>
                  <p className="text-sm text-gray-500">
                    {edu.institution}{edu.year && ` - ${edu.year}`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Skills */}
        {skills.length > 0 && (
          <div className="mb-5">
            <h3 className="text-lg font-bold text-gray-900 border-b border-gray-300 pb-1 mb-2">
              المهارات
            </h3>
            <p className="text-sm text-gray-600">{skills.join(" • ")}</p>
          </div>
        )}

        {/* Languages */}
        {languages.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-gray-900 border-b border-gray-300 pb-1 mb-2">
              اللغات
            </h3>
            <p className="text-sm text-gray-600">
              {languages.map((l) => `${l.language} (${l.proficiency})`).join(" • ")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MinimalTemplate({ cvData }: { cvData: CVData }) {
  const { personalInfo, summary, experiences, education, skills, languages } = cvData;

  return (
    <div className="bg-white text-gray-800 rounded-2xl overflow-hidden shadow-2xl max-w-2xl mx-auto" dir="rtl">
      <div className="p-8">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-3xl font-light text-gray-900 tracking-wide">{personalInfo.fullName || "الاسم الكامل"}</h2>
          <p className="text-gray-400 text-sm mt-1 tracking-wider">{personalInfo.title || "المسمى الوظيفي"}</p>
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-400">
            {personalInfo.email && <span>{personalInfo.email}</span>}
            {personalInfo.phone && <span>{personalInfo.phone}</span>}
            {personalInfo.location && <span>{personalInfo.location}</span>}
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <div className="mb-5">
            <p className="text-sm text-gray-600 leading-relaxed">{summary}</p>
          </div>
        )}

        {/* Two Column Layout */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-1 space-y-5">
            {/* Skills */}
            {skills.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  المهارات
                </h3>
                <div className="space-y-1">
                  {skills.map((skill) => (
                    <p key={skill} className="text-sm text-gray-700">{skill}</p>
                  ))}
                </div>
              </div>
            )}

            {/* Languages */}
            {languages.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  اللغات
                </h3>
                <div className="space-y-1">
                  {languages.map((lang, i) => (
                    <p key={i} className="text-sm text-gray-700">
                      {lang.language}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Education */}
            {education.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  التعليم
                </h3>
                <div className="space-y-2">
                  {education.map((edu) => (
                    <div key={edu.id}>
                      <p className="text-sm font-medium text-gray-700">{edu.degree}</p>
                      <p className="text-xs text-gray-400">{edu.institution}</p>
                      {edu.year && <p className="text-xs text-gray-400">{edu.year}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Experience */}
          <div className="col-span-2">
            {experiences.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  الخبرات العملية
                </h3>
                <div className="space-y-4">
                  {experiences.map((exp) => (
                    <div key={exp.id}>
                      <p className="font-semibold text-gray-800">{exp.role}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {exp.company}
                        {exp.startDate && ` • ${exp.startDate} - ${exp.endDate || "حتى الآن"}`}
                      </p>
                      {exp.description && (
                        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{exp.description}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
