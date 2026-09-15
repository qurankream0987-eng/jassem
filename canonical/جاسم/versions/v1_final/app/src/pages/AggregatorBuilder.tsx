import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Store,
  Users,
  Percent,
  BarChart3,
  Sparkles,
  Target,
  Globe,
  Shield,
  Zap,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";
import VendorManager from "@/components/VendorManager";
import CommissionSettings from "@/components/CommissionSettings";
import PlatformAnalytics from "@/components/PlatformAnalytics";

type TabId = "vendors" | "commission" | "analytics";

const nicheOptions = [
  { id: "maintenance", label: "صيانة", icon: "🔧", desc: "خدمات الصيانة المنزلية" },
  { id: "delivery", label: "توصيل", icon: "🚚", desc: "خدمات التوصيل والشحن" },
  { id: "handicrafts", label: "حرف يدوية", icon: "✂️", desc: "الحرف اليدوية التقليدية" },
  { id: "beauty", label: "تجميل", icon: "💄", desc: "خدمات التجميل والعناية" },
  { id: "cleaning", label: "تنظيف", icon: "🧹", desc: "خدمات التنظيف المنزلي" },
  { id: "education", label: "تعليم", icon: "📚", desc: "الدروس والتدريب" },
  { id: "health", label: "صحة", icon: "🏥", desc: "الخدمات الصحية والعيادات" },
  { id: "food", label: "مطاعم", icon: "🍽", desc: "تجميع المطاعم" },
];

const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "vendors", label: "التجار", icon: <Users className="w-4 h-4" /> },
  { id: "commission", label: "العمولة", icon: <Percent className="w-4 h-4" /> },
  { id: "analytics", label: "التحليلات", icon: <BarChart3 className="w-4 h-4" /> },
];

export default function AggregatorBuilder() {
  const [selectedNiche, setSelectedNiche] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>("vendors");
  const [step, setStep] = useState<1 | 2>(1);

  const selectedNicheData = nicheOptions.find((n) => n.id === selectedNiche);

  return (
    <div
      className="w-full h-full overflow-y-auto p-4 pb-20"
      style={{ direction: "rtl" }}
    >
      {step === 1 ? (
        <>
          {/* Hero */}
          <div className="relative mb-6 p-5 rounded-2xl overflow-hidden border border-white/[0.08]">
            <div
              className="absolute inset-0 opacity-20"
              style={{
                background:
                  "radial-gradient(ellipse at top left, rgba(168,85,247,0.15), transparent 60%), radial-gradient(ellipse at bottom right, rgba(0,212,255,0.1), transparent 50%)",
              }}
            />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-9 h-9 rounded-xl bg-[var(--purple)]/15 flex items-center justify-center">
                  <Store className="w-5 h-5 text-[var(--purple)]" />
                </div>
                <div>
                  <h1 className="text-xl font-extrabold text-[var(--text)]">
                    أنشئ سوقك التجميعي
                  </h1>
                  <p className="text-xs text-[var(--text2)]">
                    اختر تخصصك وابدأ بجمع التجار في سوق واحد
                  </p>
                </div>
              </div>

              <div className="flex gap-4 mt-3">
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--text2)]">
                  <Target className="w-3 h-3 text-[var(--purple)]" />
                  <span>تخصص دقيق</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--text2)]">
                  <Zap className="w-3 h-3 text-[var(--gold)]" />
                  <span>إطلاق سريع</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-[var(--text2)]">
                  <Globe className="w-3 h-3 text-[var(--blue)]" />
                  <span>تغطية واسعة</span>
                </div>
              </div>
            </div>
          </div>

          {/* Niche selector */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-[var(--text)] mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[var(--cyan)]" />
              اختر تخصص سوقك
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {nicheOptions.map((niche) => {
                const isSelected = selectedNiche === niche.id;
                return (
                  <button
                    key={niche.id}
                    onClick={() => setSelectedNiche(niche.id)}
                    className={cn(
                      "relative flex flex-col items-center text-center p-4 rounded-2xl border transition-all duration-300",
                      isSelected
                        ? "border-[var(--purple)]/40 bg-[var(--purple)]/[0.08]"
                        : "border-white/[0.08] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
                    )}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-[var(--purple)] flex items-center justify-center">
                        <CheckCircle2 className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <span className="text-2xl mb-2">{niche.icon}</span>
                    <h4
                      className={cn(
                        "text-sm font-bold mb-0.5 transition-colors",
                        isSelected ? "text-[var(--purple)]" : "text-[var(--text)]"
                      )}
                    >
                      {niche.label}
                    </h4>
                    <p className="text-[10px] text-[var(--text2)] leading-relaxed">
                      {niche.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Proceed button */}
          <div className="flex justify-center">
            <button
              onClick={() => selectedNiche && setStep(2)}
              disabled={!selectedNiche}
              className={cn(
                "px-8 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 transition-all",
                selectedNiche
                  ? "bg-gradient-to-r from-[var(--purple)] to-[var(--blue)] text-white hover:opacity-90"
                  : "bg-white/10 text-[var(--text2)] cursor-not-allowed"
              )}
            >
              متابعة إلى إدارة السوق
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Step 2 header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStep(1)}
                className="text-[10px] text-[var(--text2)] hover:text-[var(--text)] transition-colors"
              >
                ← العودة للتخصص
              </button>
              <div className="w-px h-4 bg-white/10" />
              <div>
                <h2 className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                  <Store className="w-4 h-4 text-[var(--purple)]" />
                  {selectedNicheData?.label || "السوق التجميعي"}
                </h2>
                <p className="text-[10px] text-[var(--text2)]">
                  إدارة التجار والعمولات والتحليلات
                </p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 mb-4 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center justify-center gap-1.5 flex-1 py-2 rounded-lg text-xs font-medium transition-all",
                  activeTab === tab.id
                    ? "bg-[var(--purple)]/15 text-[var(--purple)] border border-[var(--purple)]/20"
                    : "text-[var(--text2)] hover:text-[var(--text)] hover:bg-white/[0.03]"
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div
            className={cn(
              "p-4 rounded-2xl border border-white/[0.08] backdrop-blur-md",
              "bg-white/[0.02]"
            )}
          >
            {activeTab === "vendors" && <VendorManager />}
            {activeTab === "commission" && <CommissionSettings />}
            {activeTab === "analytics" && <PlatformAnalytics />}
          </div>
        </>
      )}
    </div>
  );
}
