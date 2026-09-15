import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Percent,
  TrendingUp,
  Award,
  SlidersHorizontal,
  Plus,
  Trash2,
  Calculator,
} from "lucide-react";

interface CommissionTier {
  id: number;
  name: string;
  minSales: string;
  maxSales: string;
  rate: string;
}

interface CategoryRule {
  id: number;
  category: string;
  rate: string;
}

const defaultCategories = [
  "مطاعم",
  "صالونات",
  "إلكترونيات",
  "ملابس",
  "صيدليات",
  "بقالة",
  "أثاث",
  "خدمات",
];

export default function CommissionSettings() {
  const [globalRate, setGlobalRate] = useState("10");
  const [minCommission, setMinCommission] = useState("5");
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([
    { id: 1, category: "مطاعم", rate: "8" },
    { id: 2, category: "إلكترونيات", rate: "12" },
    { id: 3, category: "صالونات", rate: "15" },
  ]);
  const [tiers, setTiers] = useState<CommissionTier[]>([
    { id: 1, name: "برونزي", minSales: "0", maxSales: "5000", rate: "10" },
    { id: 2, name: "فضي", minSales: "5000", maxSales: "20000", rate: "8" },
    { id: 3, name: "ذهبي", minSales: "20000", maxSales: "50000", rate: "6" },
    { id: 4, name: "بلاتيني", minSales: "50000", maxSales: "999999", rate: "4" },
  ]);
  const [simulatorSales, setSimulatorSales] = useState("10000");

  const addCategoryRule = () => {
    const used = new Set(categoryRules.map((r) => r.category));
    const available = defaultCategories.find((c) => !used.has(c));
    if (!available) return;
    setCategoryRules((prev) => [
      ...prev,
      { id: prev.length + 1, category: available, rate: "10" },
    ]);
  };

  const removeCategoryRule = (id: number) => {
    setCategoryRules((prev) => prev.filter((r) => r.id !== id));
  };

  const simulatedCommission =
    (parseFloat(simulatorSales) || 0) *
    (parseFloat(globalRate) || 0) /
    100;

  return (
    <div className="w-full space-y-4" style={{ direction: "rtl" }}>
      {/* Global rate */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
          <Percent className="w-4 h-4 text-[var(--cyan)]" />
          نسبة العمولة الافتراضية
        </h4>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min="0"
            max="50"
            value={globalRate}
            onChange={(e) => setGlobalRate(e.target.value)}
            className="flex-1 accent-[var(--cyan)]"
          />
          <div
            className={cn(
              "w-16 h-10 rounded-xl flex items-center justify-center text-sm font-bold border",
              "bg-[var(--cyan)]/10 border-[var(--cyan)]/20 text-[var(--cyan)]"
            )}
          >
            {globalRate}%
          </div>
        </div>
      </div>

      {/* Min commission */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-[var(--cyan)]" />
          الحد الأدنى للعمولة
        </h4>
        <div className="flex items-center gap-3">
          <input
            type="number"
            value={minCommission}
            onChange={(e) => setMinCommission(e.target.value)}
            className={cn(
              "w-24 h-10 px-3 rounded-xl text-center text-sm font-bold",
              "bg-white/5 border border-white/10",
              "text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/40"
            )}
          />
          <span className="text-xs text-[var(--text2)]">
            ر.س (الحد الأدنى لعمولة كل طلب)
          </span>
        </div>
      </div>

      {/* Category rules */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-bold text-[var(--text)] flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-[var(--cyan)]" />
            عمولة حسب التصنيف
          </h4>
          <button
            onClick={addCategoryRule}
            disabled={categoryRules.length >= defaultCategories.length}
            className={cn(
              "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium transition-all",
              categoryRules.length >= defaultCategories.length
                ? "opacity-30 cursor-not-allowed"
                : "bg-[var(--cyan)]/10 text-[var(--cyan)] hover:bg-[var(--cyan)]/20"
            )}
          >
            <Plus className="w-3 h-3" />
            إضافة
          </button>
        </div>

        <div className="space-y-2">
          {categoryRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
            >
              <select
                value={rule.category}
                onChange={(e) => {
                  setCategoryRules((prev) =>
                    prev.map((r) =>
                      r.id === rule.id ? { ...r, category: e.target.value } : r
                    )
                  );
                }}
                className={cn(
                  "flex-1 h-8 px-2 rounded-lg text-xs",
                  "bg-white/5 border border-white/10",
                  "text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/40"
                )}
              >
                {defaultCategories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={rule.rate}
                  onChange={(e) => {
                    setCategoryRules((prev) =>
                      prev.map((r) =>
                        r.id === rule.id ? { ...r, rate: e.target.value } : r
                      )
                    );
                  }}
                  className={cn(
                    "w-14 h-8 px-1 rounded-lg text-center text-xs font-bold",
                    "bg-white/5 border border-white/10",
                    "text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/40"
                  )}
                />
                <span className="text-[10px] text-[var(--text2)]">%</span>
              </div>
              <button
                onClick={() => removeCategoryRule(rule.id)}
                className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tiers */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
          <Award className="w-4 h-4 text-[var(--cyan)]" />
          مستويات العمولة
        </h4>
        <div className="space-y-2">
          {tiers.map((tier, idx) => (
            <div
              key={tier.id}
              className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
            >
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                style={{
                  backgroundColor:
                    idx === 0
                      ? "#CD7F32"
                      : idx === 1
                        ? "#94a3b8"
                        : idx === 2
                          ? "#FFD700"
                          : "#00d4ff",
                  opacity: 0.8,
                }}
              >
                {tier.name[0]}
              </div>
              <span className="text-[11px] font-medium text-[var(--text)] w-14 flex-shrink-0">
                {tier.name}
              </span>
              <div className="flex items-center gap-1 flex-1">
                <span className="text-[9px] text-[var(--text2)]">
                  {parseInt(tier.minSales).toLocaleString()} ر.س
                </span>
                <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(10, 100 - idx * 22)}%`,
                      backgroundColor:
                        idx === 0
                          ? "#CD7F32"
                          : idx === 1
                            ? "#94a3b8"
                            : idx === 2
                              ? "#FFD700"
                              : "#00d4ff",
                    }}
                  />
                </div>
                <span className="text-[9px] text-[var(--text2)]">
                  {parseInt(tier.maxSales) > 90000
                    ? "+"
                    : parseInt(tier.maxSales).toLocaleString()}{" "}
                  ر.س
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <input
                  type="number"
                  value={tier.rate}
                  onChange={(e) => {
                    setTiers((prev) =>
                      prev.map((t) =>
                        t.id === tier.id ? { ...t, rate: e.target.value } : t
                      )
                    );
                  }}
                  className={cn(
                    "w-10 h-7 px-1 rounded-lg text-center text-[10px] font-bold",
                    "bg-white/5 border border-white/10",
                    "text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/40"
                  )}
                />
                <span className="text-[9px] text-[var(--text2)]">%</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Simulator */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
          <Calculator className="w-4 h-4 text-[var(--cyan)]" />
          محاكاة العمولة
        </h4>
        <div className="flex items-center gap-3 mb-3">
          <input
            type="number"
            value={simulatorSales}
            onChange={(e) => setSimulatorSales(e.target.value)}
            placeholder="مبلغ المبيعات"
            className={cn(
              "flex-1 h-10 px-4 rounded-xl",
              "bg-white/5 border border-white/10",
              "text-[var(--text)] text-xs focus:outline-none focus:border-[var(--cyan)]/40"
            )}
          />
          <span className="text-[10px] text-[var(--text2)]">ر.س</span>
        </div>
        <div
          className={cn(
            "p-3 rounded-xl border text-center",
            "bg-[var(--cyan)]/[0.05] border-[var(--cyan)]/15"
          )}
        >
          <p className="text-[10px] text-[var(--text2)] mb-1">
            العمولة المتوقعة ({globalRate}%)
          </p>
          <p className="text-xl font-extrabold text-[var(--cyan)]">
            {simulatedCommission.toFixed(2)} ر.س
          </p>
        </div>
      </div>
    </div>
  );
}
