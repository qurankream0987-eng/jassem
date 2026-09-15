import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Trash2, Briefcase } from "lucide-react";
import type { ExperienceEntry } from "../types/recruitment";

interface ExperienceFormProps {
  experiences: ExperienceEntry[];
  onChange: (experiences: ExperienceEntry[]) => void;
}

let idCounter = 0;
function generateId() {
  return `exp-${Date.now()}-${++idCounter}`;
}

export default function ExperienceForm({
  experiences,
  onChange,
}: ExperienceFormProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleAdd = () => {
    const newEntry: ExperienceEntry = {
      id: generateId(),
      company: "",
      role: "",
      startDate: "",
      endDate: "",
      description: "",
    };
    onChange([...experiences, newEntry]);
    setExpandedId(newEntry.id);
  };

  const handleRemove = (id: string) => {
    onChange(experiences.filter((e) => e.id !== id));
    if (expandedId === id) setExpandedId(null);
  };

  const handleUpdate = (id: string, field: keyof ExperienceEntry, value: string) => {
    onChange(
      experiences.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );
  };

  return (
    <div className="space-y-3" dir="rtl">
      {experiences.length === 0 && (
        <div className="text-center py-6 rounded-2xl border border-dashed border-white/10 bg-white/5">
          <Briefcase className="w-8 h-8 mx-auto text-white/20 mb-2" />
          <p className="text-white/40 text-sm">لا توجد خبرات مضافة</p>
          <p className="text-white/25 text-xs mt-1">أضف خبراتك السابقة</p>
        </div>
      )}

      {experiences.map((exp, index) => (
        <div
          key={exp.id}
          className="rounded-2xl border border-white/15 bg-white/8 backdrop-blur-xl overflow-hidden transition-all duration-300"
        >
          <button
            type="button"
            onClick={() => setExpandedId(expandedId === exp.id ? null : exp.id)}
            className="w-full flex items-center justify-between p-4 text-right hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[var(--cyan)]/15 flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-[var(--cyan)]" />
              </div>
              <div>
                <p className="text-white font-medium text-sm">
                  {exp.role || `الخبرة ${index + 1}`}
                </p>
                <p className="text-white/40 text-xs">
                  {exp.company || "شركة غير محددة"}
                  {exp.startDate ? ` • ${exp.startDate}` : ""}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(exp.id);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              {expandedId === exp.id ? (
                <ChevronUp className="w-4 h-4 text-white/40" />
              ) : (
                <ChevronDown className="w-4 h-4 text-white/40" />
              )}
            </div>
          </button>

          {expandedId === exp.id && (
            <div className="p-4 pt-0 border-t border-white/10 space-y-3 animate-[fadeUp_0.3s_ease-out]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">
                    المسمى الوظيفي
                  </label>
                  <input
                    type="text"
                    value={exp.role}
                    onChange={(e) => handleUpdate(exp.id, "role", e.target.value)}
                    placeholder="مثال: مطور برمجيات"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">
                    اسم الشركة
                  </label>
                  <input
                    type="text"
                    value={exp.company}
                    onChange={(e) => handleUpdate(exp.id, "company", e.target.value)}
                    placeholder="مثال: شركة التقنية العربية"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">
                    تاريخ البدء
                  </label>
                  <input
                    type="text"
                    value={exp.startDate}
                    onChange={(e) => handleUpdate(exp.id, "startDate", e.target.value)}
                    placeholder="مثال: يناير 2020"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  />
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">
                    تاريخ الانتهاء
                  </label>
                  <input
                    type="text"
                    value={exp.endDate}
                    onChange={(e) => handleUpdate(exp.id, "endDate", e.target.value)}
                    placeholder="مثال: ديسمبر 2023 أو حتى الآن"
                    className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors"
                    dir="rtl"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-white/50 mb-1.5">
                  وصف المهام والمسؤوليات
                </label>
                <textarea
                  value={exp.description}
                  onChange={(e) =>
                    handleUpdate(exp.id, "description", e.target.value)
                  }
                  placeholder="اشرح مهامك وإنجازاتك في هذه الوظيفة..."
                  rows={3}
                  className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/15 text-white text-sm placeholder:text-white/25 outline-none focus:border-[var(--cyan)]/50 transition-colors resize-none"
                  dir="rtl"
                />
              </div>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={handleAdd}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[var(--cyan)]/30 text-[var(--cyan)] text-sm font-medium hover:bg-[var(--cyan)]/10 transition-all duration-300"
      >
        <Plus className="w-4 h-4" />
        إضافة خبرة عمل
      </button>
    </div>
  );
}
