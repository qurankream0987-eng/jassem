import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Rocket,
  LayoutTemplate,
  BarChart3,
  Eye,
  RotateCcw,
  CheckCircle2,
  Zap,
  Globe,
  Shield,
} from "lucide-react";
import SaasWizard from "@/components/SaasWizard";
import PlatformPreview from "@/components/PlatformPreview";
import SaasAnalytics from "@/components/SaasAnalytics";
import type { WizardData } from "@/components/SaasWizard";

type ViewMode = "wizard" | "preview" | "analytics";

export default function SaasBuilder() {
  const [view, setView] = useState<ViewMode>("wizard");
  const [wizardData, setWizardData] = useState<WizardData | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const handleComplete = useCallback((data: WizardData) => {
    setWizardData(data);
    setIsComplete(true);
    setView("preview");
  }, []);

  const navItems: { id: ViewMode; icon: React.ReactNode; label: string }[] = [
    { id: "wizard", icon: <LayoutTemplate className="w-4 h-4" />, label: "المعالج" },
    { id: "preview", icon: <Eye className="w-4 h-4" />, label: "المعاينة" },
    { id: "analytics", icon: <BarChart3 className="w-4 h-4" />, label: "التحليلات" },
  ];

  return (
    <div
      className="w-full h-full overflow-y-auto p-4 pb-20"
      style={{ direction: "rtl" }}
    >
      {/* Hero */}
      <div className="relative mb-6 p-5 rounded-2xl overflow-hidden border border-white/[0.08]">
        <div
          className="absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(ellipse at top right, rgba(0,212,255,0.15), transparent 60%), radial-gradient(ellipse at bottom left, rgba(168,85,247,0.1), transparent 50%)",
          }}
        />
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-9 h-9 rounded-xl bg-[var(--cyan)]/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[var(--cyan)]" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-[var(--text)]">
                ابنِ منصتك في 30 ثانية
              </h1>
              <p className="text-xs text-[var(--text2)]">
                اختر قالب، خصصه، واطلق منصتك فوراً
              </p>
            </div>
          </div>

          {/* Quick stats */}
          <div className="flex gap-4 mt-3">
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text2)]">
              <Zap className="w-3 h-3 text-[var(--gold)]" />
              <span>سريع</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text2)]">
              <Globe className="w-3 h-3 text-[var(--blue)]" />
              <span>متعدد الأسواق</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-[var(--text2)]">
              <Shield className="w-3 h-3 text-[var(--green)]" />
              <span>آمن</span>
            </div>
          </div>
        </div>
      </div>

      {/* Success banner */}
      {isComplete && wizardData && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-emerald-300">
              تم إنشاء "{wizardData.platformName}" بنجاح!
            </p>
            <p className="text-[10px] text-emerald-300/70">
              منصتك جاهزة للإطلاق. يمكنك معاينتها أو مشاهدة التحليلات.
            </p>
          </div>
        </div>
      )}

      {/* View tabs */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={cn(
              "flex items-center justify-center gap-1.5 flex-1 py-2 rounded-lg text-xs font-medium transition-all",
              view === item.id
                ? "bg-[var(--cyan)]/15 text-[var(--cyan)] border border-[var(--cyan)]/20"
                : "text-[var(--text2)] hover:text-[var(--text)] hover:bg-white/[0.03]"
            )}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {view === "wizard" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Wizard panel */}
          <div
            className={cn(
              "p-4 rounded-2xl border border-white/[0.08] backdrop-blur-md",
              "bg-white/[0.02]"
            )}
          >
            <SaasWizard onComplete={handleComplete} />
          </div>

          {/* Preview panel - side by side */}
          <div className="hidden lg:block">
            <div className="sticky top-0">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-[var(--text2)]">
                  معاينة مباشرة
                </h3>
                <span className="text-[9px] text-[var(--text2)] bg-white/5 px-2 py-0.5 rounded-full">
                  يتم التحديث تلقائياً
                </span>
              </div>
              <div className="h-[560px] rounded-2xl overflow-hidden border border-white/10">
                <PlatformPreview
                  data={
                    wizardData || {
                      templateId: null,
                      platformName: "",
                      platformColor: "#00d4ff",
                      logo: "",
                      currency: "SAR",
                      products: [{ name: "", price: "", category: "" }],
                      deliveryFee: "15",
                      paymentMethods: ["cod"],
                    }
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "preview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div
            className={cn(
              "p-4 rounded-2xl border border-white/[0.08] backdrop-blur-md",
              "bg-white/[0.02] h-[600px]"
            )}
          >
            {isComplete ? (
              <PlatformPreview data={wizardData!} />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <Eye className="w-10 h-10 text-[var(--text2)]/30 mb-3" />
                <p className="text-sm text-[var(--text2)] mb-1">
                  أكمل المعالج أولاً
                </p>
                <p className="text-[10px] text-[var(--text2)]/60">
                  ستظهر معاينة منصتك هنا بعد الإنشاء
                </p>
                <button
                  onClick={() => setView("wizard")}
                  className="mt-4 px-4 py-2 rounded-xl bg-[var(--cyan)]/15 text-[var(--cyan)] text-xs font-medium border border-[var(--cyan)]/20 hover:bg-[var(--cyan)]/25 transition-colors"
                >
                  ابدأ المعالج
                </button>
              </div>
            )}
          </div>

          {/* Launch actions */}
          {isComplete && (
            <div className="space-y-3">
              <div
                className={cn(
                  "p-4 rounded-2xl border border-white/[0.08] backdrop-blur-md",
                  "bg-white/[0.02]"
                )}
              >
                <h3 className="text-sm font-bold text-[var(--text)] mb-3 flex items-center gap-2">
                  <Rocket className="w-4 h-4 text-[var(--cyan)]" />
                  خطوات الإطلاق
                </h3>
                <div className="space-y-2">
                  {[
                    { label: "إنشاء المنصة", done: true },
                    { label: "تفعيل الدفع", done: false },
                    { label: "ربط النطاق", done: false },
                    { label: "الإطلاق الرسمي", done: false },
                  ].map((step) => (
                    <div
                      key={step.label}
                      className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06]"
                    >
                      <div
                        className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                          step.done
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-white/5 text-[var(--text2)]"
                        )}
                      >
                        {step.done ? (
                          <CheckCircle2 className="w-4 h-4" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-[var(--text2)]/30" />
                        )}
                      </div>
                      <span
                        className={cn(
                          "text-xs",
                          step.done
                            ? "text-[var(--text)]"
                            : "text-[var(--text2)]"
                        )}
                      >
                        {step.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <button
                className={cn(
                  "w-full py-3 rounded-2xl text-sm font-bold text-black",
                  "bg-gradient-to-r from-[var(--cyan)] to-[var(--blue)]",
                  "hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
                )}
              >
                <Rocket className="w-4 h-4" />
                إطلاق المنصة
              </button>

              <button
                onClick={() => {
                  setIsComplete(false);
                  setWizardData(null);
                  setView("wizard");
                }}
                className={cn(
                  "w-full py-2.5 rounded-2xl text-xs font-medium",
                  "bg-white/5 border border-white/10 text-[var(--text2)]",
                  "hover:bg-white/[0.08] hover:text-[var(--text)] transition-colors",
                  "flex items-center justify-center gap-2"
                )}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                إنشاء منصة جديدة
              </button>
            </div>
          )}
        </div>
      )}

      {view === "analytics" && (
        <div
          className={cn(
            "p-4 rounded-2xl border border-white/[0.08] backdrop-blur-md",
            "bg-white/[0.02]"
          )}
        >
          {isComplete ? (
            <SaasAnalytics platformName={wizardData?.platformName} />
          ) : (
            <div className="py-16 text-center">
              <BarChart3 className="w-10 h-10 text-[var(--text2)]/30 mx-auto mb-3" />
              <p className="text-sm text-[var(--text2)] mb-1">
                لا توجد تحليلات بعد
              </p>
              <p className="text-[10px] text-[var(--text2)]/60">
                أكمل إنشاء منصة لرؤية التحليلات
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
