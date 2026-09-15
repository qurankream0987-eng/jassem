import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  LayoutGrid,
  Settings,
  Package,
  CreditCard,
  ChevronRight,
  ChevronLeft,
  Check,
  Store,
  Palette,
  ImageIcon,
  Type,
  Plus,
  Trash2,
  Bike,
  MapPin,
} from "lucide-react";
import TemplateSelector, { templates } from "./TemplateSelector";

interface WizardData {
  templateId: string | null;
  platformName: string;
  platformColor: string;
  logo: string;
  currency: string;
  products: { name: string; price: string; category: string }[];
  deliveryFee: string;
  paymentMethods: string[];
}

const initialData: WizardData = {
  templateId: null,
  platformName: "",
  platformColor: "#00d4ff",
  logo: "",
  currency: "SAR",
  products: [{ name: "", price: "", category: "" }],
  deliveryFee: "15",
  paymentMethods: ["cod"],
};

const steps = [
  { id: 1, label: "اختيار القالب", icon: LayoutGrid },
  { id: 2, label: "الإعدادات الأساسية", icon: Settings },
  { id: 3, label: "المنتجات والخدمات", icon: Package },
  { id: 4, label: "الدفع والتوصيل", icon: CreditCard },
];

const colorOptions = [
  "#00d4ff",
  "#4a9eff",
  "#a855f7",
  "#ec4899",
  "#ef4444",
  "#f59e0b",
  "#10b981",
  "#FF6B00",
];

const currencyOptions = [
  { value: "SAR", label: "ريال سعودي" },
  { value: "AED", label: "درهم إماراتي" },
  { value: "KWD", label: "دينار كويتي" },
  { value: "QAR", label: "ريال قطري" },
  { value: "BHD", label: "دينار بحريني" },
  { value: "OMR", label: "ريال عماني" },
  { value: "EGP", label: "جنيه مصري" },
  { value: "JOD", label: "دينار أردني" },
  { value: "USD", label: "دولار أمريكي" },
];

interface SaasWizardProps {
  onComplete?: (data: WizardData) => void;
}

export default function SaasWizard({ onComplete }: SaasWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [data, setData] = useState<WizardData>(initialData);

  const update = <K extends keyof WizardData>(
    key: K,
    value: WizardData[K]
  ) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const canProceed = () => {
    switch (currentStep) {
      case 1:
        return !!data.templateId;
      case 2:
        return data.platformName.trim().length > 0;
      case 3:
        return data.products.some((p) => p.name.trim() && p.price.trim());
      case 4:
        return data.paymentMethods.length > 0;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < 4) {
      setCurrentStep((s) => s + 1);
    } else {
      onComplete?.(data);
    }
  };

  const selectedTemplate = templates.find((t) => t.id === data.templateId);

  return (
    <div className="w-full flex flex-col h-full">
      {/* Step indicator */}
      <div className="flex items-center justify-between mb-6 px-2">
        {steps.map((step, idx) => {
          const Icon = step.icon;
          const isActive = step.id === currentStep;
          const isDone = step.id < currentStep;
          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1.5">
                <div
                  className={cn(
                    "w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-300 border",
                    isActive
                      ? "bg-[var(--cyan)]/20 border-[var(--cyan)]/50 text-[var(--cyan)]"
                      : isDone
                        ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                        : "bg-white/5 border-white/10 text-[var(--text2)]"
                  )}
                >
                  {isDone ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <Icon className="w-4 h-4" />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-medium transition-colors whitespace-nowrap",
                    isActive
                      ? "text-[var(--cyan)]"
                      : isDone
                        ? "text-emerald-400"
                        : "text-[var(--text2)]"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div
                  className={cn(
                    "flex-1 h-0.5 mx-2 rounded-full transition-colors",
                    isDone ? "bg-emerald-500/30" : "bg-white/10"
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Step 1: Template Selection */}
        {currentStep === 1 && (
          <div className="animate-in fade-in slide-in-from-left-2 duration-300">
            <TemplateSelector
              selectedId={data.templateId}
              onSelect={(id) => update("templateId", id)}
            />
            {selectedTemplate && (
              <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                <p className="text-xs text-[var(--text2)]">
                  {selectedTemplate.description}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Basic Settings */}
        {currentStep === 2 && (
          <div
            className="animate-in fade-in slide-in-from-right-2 duration-300 space-y-4"
            style={{ direction: "rtl" }}
          >
            {/* Platform name */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text)] mb-2">
                <Type className="w-3.5 h-3.5 text-[var(--cyan)]" />
                اسم المنصة
              </label>
              <input
                type="text"
                value={data.platformName}
                onChange={(e) => update("platformName", e.target.value)}
                placeholder="مثال: مطعم الذوق الرفيع"
                className={cn(
                  "w-full h-11 px-4 rounded-xl",
                  "bg-white/5 border border-white/10",
                  "text-[var(--text)] text-sm placeholder:text-[var(--text2)]/40",
                  "focus:outline-none focus:border-[var(--cyan)]/40 focus:bg-white/[0.07]",
                  "transition-all duration-200"
                )}
              />
            </div>

            {/* Color picker */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text)] mb-2">
                <Palette className="w-3.5 h-3.5 text-[var(--cyan)]" />
                لون العلامة التجارية
              </label>
              <div className="flex gap-2 flex-wrap">
                {colorOptions.map((c) => (
                  <button
                    key={c}
                    onClick={() => update("platformColor", c)}
                    className={cn(
                      "w-8 h-8 rounded-lg transition-all duration-200 border-2",
                      data.platformColor === c
                        ? "border-white scale-110"
                        : "border-transparent hover:scale-105"
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>

            {/* Currency */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text)] mb-2">
                <Store className="w-3.5 h-3.5 text-[var(--cyan)]" />
                العملة
              </label>
              <select
                value={data.currency}
                onChange={(e) => update("currency", e.target.value)}
                className={cn(
                  "w-full h-11 px-4 rounded-xl",
                  "bg-white/5 border border-white/10",
                  "text-[var(--text)] text-sm",
                  "focus:outline-none focus:border-[var(--cyan)]/40",
                  "transition-all duration-200"
                )}
              >
                {currencyOptions.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label} ({c.value})
                  </option>
                ))}
              </select>
            </div>

            {/* Logo placeholder */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text)] mb-2">
                <ImageIcon className="w-3.5 h-3.5 text-[var(--cyan)]" />
                الشعار
              </label>
              <div
                className={cn(
                  "w-full h-20 rounded-xl border-2 border-dashed flex items-center justify-center cursor-pointer transition-all",
                  "border-white/10 hover:border-[var(--cyan)]/30 bg-white/[0.02] hover:bg-white/[0.04]"
                )}
              >
                <span className="text-xs text-[var(--text2)]">
                  ارفع شعار منصتك (اختياري)
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Products/Services */}
        {currentStep === 3 && (
          <div
            className="animate-in fade-in slide-in-from-right-2 duration-300"
            style={{ direction: "rtl" }}
          >
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-medium text-[var(--text2)]">
                أضف منتجاتك أو خدماتك
              </h4>
              <button
                onClick={() =>
                  update("products", [
                    ...data.products,
                    { name: "", price: "", category: "" },
                  ])
                }
                className={cn(
                  "flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-medium",
                  "bg-[var(--cyan)]/10 text-[var(--cyan)] border border-[var(--cyan)]/20",
                  "hover:bg-[var(--cyan)]/20 transition-colors"
                )}
              >
                <Plus className="w-3 h-3" />
                إضافة
              </button>
            </div>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {data.products.map((product, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={product.name}
                      onChange={(e) => {
                        const next = [...data.products];
                        next[idx].name = e.target.value;
                        update("products", next);
                      }}
                      placeholder="اسم المنتج/الخدمة"
                      className={cn(
                        "flex-1 h-9 px-3 rounded-lg text-xs",
                        "bg-white/5 border border-white/10",
                        "text-[var(--text)] placeholder:text-[var(--text2)]/40",
                        "focus:outline-none focus:border-[var(--cyan)]/40"
                      )}
                    />
                    {data.products.length > 1 && (
                      <button
                        onClick={() => {
                          const next = data.products.filter((_, i) => i !== idx);
                          update("products", next);
                        }}
                        className="w-8 h-9 rounded-lg bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={product.price}
                      onChange={(e) => {
                        const next = [...data.products];
                        next[idx].price = e.target.value;
                        update("products", next);
                      }}
                      placeholder="السعر"
                      className={cn(
                        "w-24 h-9 px-3 rounded-lg text-xs",
                        "bg-white/5 border border-white/10",
                        "text-[var(--text)] placeholder:text-[var(--text2)]/40",
                        "focus:outline-none focus:border-[var(--cyan)]/40"
                      )}
                    />
                    <input
                      type="text"
                      value={product.category}
                      onChange={(e) => {
                        const next = [...data.products];
                        next[idx].category = e.target.value;
                        update("products", next);
                      }}
                      placeholder="التصنيف"
                      className={cn(
                        "flex-1 h-9 px-3 rounded-lg text-xs",
                        "bg-white/5 border border-white/10",
                        "text-[var(--text)] placeholder:text-[var(--text2)]/40",
                        "focus:outline-none focus:border-[var(--cyan)]/40"
                      )}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4: Payment & Delivery */}
        {currentStep === 4 && (
          <div
            className="animate-in fade-in slide-in-from-right-2 duration-300 space-y-4"
            style={{ direction: "rtl" }}
          >
            {/* Delivery fee */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text)] mb-2">
                <Bike className="w-3.5 h-3.5 text-[var(--cyan)]" />
                رسوم التوصيل
              </label>
              <input
                type="number"
                value={data.deliveryFee}
                onChange={(e) => update("deliveryFee", e.target.value)}
                className={cn(
                  "w-full h-11 px-4 rounded-xl",
                  "bg-white/5 border border-white/10",
                  "text-[var(--text)] text-sm",
                  "focus:outline-none focus:border-[var(--cyan)]/40"
                )}
              />
            </div>

            {/* Payment methods */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text)] mb-2">
                <CreditCard className="w-3.5 h-3.5 text-[var(--cyan)]" />
                طرق الدفع
              </label>
              <div className="space-y-2">
                {[
                  { id: "cod", label: "الدفع عند الاستلام" },
                  { id: "card", label: "بطاقة ائتمان" },
                  { id: "wallet", label: "محفظة إلكترونية" },
                  { id: "bank", label: "تحويل بنكي" },
                ].map((method) => (
                  <label
                    key={method.id}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                      data.paymentMethods.includes(method.id)
                        ? "border-[var(--cyan)]/30 bg-[var(--cyan)]/[0.05]"
                        : "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]"
                    )}
                  >
                    <div
                      className={cn(
                        "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
                        data.paymentMethods.includes(method.id)
                          ? "bg-[var(--cyan)] border-[var(--cyan)]"
                          : "border-white/20"
                      )}
                      onClick={() => {
                        const next = data.paymentMethods.includes(method.id)
                          ? data.paymentMethods.filter((m) => m !== method.id)
                          : [...data.paymentMethods, method.id];
                        update("paymentMethods", next);
                      }}
                    >
                      {data.paymentMethods.includes(method.id) && (
                        <Check className="w-3 h-3 text-black" />
                      )}
                    </div>
                    <span className="text-xs text-[var(--text)]">
                      {method.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Delivery zones */}
            <div>
              <label className="flex items-center gap-2 text-xs font-medium text-[var(--text)] mb-2">
                <MapPin className="w-3.5 h-3.5 text-[var(--cyan)]" />
                مناطق التوصيل
              </label>
              <div
                className={cn(
                  "w-full h-28 rounded-xl border-2 border-dashed flex items-center justify-center",
                  "border-white/10 bg-white/[0.02]"
                )}
              >
                <span className="text-xs text-[var(--text2)]">
                  حدد مناطق التوصيل على الخريطة
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/10">
        <button
          onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
          disabled={currentStep === 1}
          className={cn(
            "flex items-center gap-1 px-4 py-2 rounded-xl text-xs font-medium border transition-all",
            currentStep === 1
              ? "opacity-30 cursor-not-allowed border-white/5 text-[var(--text2)]"
              : "border-white/10 text-[var(--text2)] hover:bg-white/5 hover:text-[var(--text)]"
          )}
        >
          <ChevronRight className="w-3.5 h-3.5" />
          السابق
        </button>

        <div className="flex items-center gap-1">
          {steps.map((s) => (
            <div
              key={s.id}
              className={cn(
                "w-1.5 h-1.5 rounded-full transition-colors",
                s.id === currentStep ? "bg-[var(--cyan)]" : "bg-white/15"
              )}
            />
          ))}
        </div>

        <button
          onClick={handleNext}
          disabled={!canProceed()}
          className={cn(
            "flex items-center gap-1 px-5 py-2 rounded-xl text-xs font-bold transition-all",
            canProceed()
              ? "bg-[var(--cyan)] text-black hover:bg-[var(--cyan)]/90"
              : "bg-white/10 text-[var(--text2)] cursor-not-allowed"
          )}
        >
          {currentStep === 4 ? "إنشاء المنصة" : "التالي"}
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export type { WizardData };
