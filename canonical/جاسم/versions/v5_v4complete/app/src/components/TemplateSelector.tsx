import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  UtensilsCrossed,
  Scissors,
  Stethoscope,
  Wrench,
  ShoppingCart,
  Truck,
  Check,
  Sparkles,
} from "lucide-react";

export interface SaasTemplate {
  id: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  color: string;
  features: string[];
}

export const templates: SaasTemplate[] = [
  {
    id: "restaurant",
    icon: <UtensilsCrossed className="w-7 h-7" />,
    title: "مطعم",
    subtitle: "توصيل طعام",
    description: "منصة توصيل طعام متكاملة مع إدارة قائمة الطعام والطلبات",
    color: "#ef4444",
    features: ["قائمة طعام تفاعلية", "إدارة الطلبات", "تتبع التوصيل"],
  },
  {
    id: "salon",
    icon: <Scissors className="w-7 h-7" />,
    title: "صالون",
    subtitle: "تجميل وحجوزات",
    description: "نظام حجوزات صالونات التجميل مع إدارة المواعيد",
    color: "#ec4899",
    features: ["حجوزات مواعيد", "إدارة الخدمات", "تذكير العملاء"],
  },
  {
    id: "clinic",
    icon: <Stethoscope className="w-7 h-7" />,
    title: "عيادة",
    subtitle: "طبي ومواعيد",
    description: "نظام إدارة عيادات طبية مع مواعيد وملفات مرضى",
    color: "#06b6d4",
    features: ["مواعيد مرضى", "ملفات طبية", "وصفات إلكترونية"],
  },
  {
    id: "maintenance",
    icon: <Wrench className="w-7 h-7" />,
    title: "صيانة",
    subtitle: "خدمات منزلية",
    description: "منصة خدمات الصيانة المنزلية مع تتببع الفنيين",
    color: "#f59e0b",
    features: ["طلبات صيانة", "تتبع الفنيين", "تقييم الخدمات"],
  },
  {
    id: "store",
    icon: <ShoppingCart className="w-7 h-7" />,
    title: "متجر",
    subtitle: "إلكتروني منتجات",
    description: "متجر إلكتروني متكامل مع سلة شراء ودفع",
    color: "#8b5cf6",
    features: ["سلة شراء", "دفع إلكتروني", "إدارة المخزون"],
  },
  {
    id: "delivery",
    icon: <Truck className="w-7 h-7" />,
    title: "توصيل",
    subtitle: "شركة توصيل",
    description: "منصة شركة توصيل مع تتبع الشحنات والعملاء",
    color: "#10b981",
    features: ["تتبع الشحنات", "إدارة السائقين", "تحديد المسارات"],
  },
];

interface TemplateSelectorProps {
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function TemplateSelector({
  selectedId,
  onSelect,
}: TemplateSelectorProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-[var(--cyan)]/15 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-[var(--cyan)]" />
        </div>
        <h3 className="text-sm font-bold text-[var(--text)]">
          القوالب المتاحة
        </h3>
        <span className="text-[10px] text-[var(--text2)] bg-white/5 px-2 py-0.5 rounded-full border border-white/10">
          {templates.length} قوالب
        </span>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {templates.map((t) => {
          const isSelected = selectedId === t.id;
          const isHovered = hoveredId === t.id;

          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={cn(
                "relative flex flex-col items-center text-center p-4 rounded-2xl border transition-all duration-300 cursor-pointer",
                "backdrop-blur-md",
                isSelected
                  ? "border-white/25 bg-white/[0.08] shadow-lg shadow-black/20"
                  : "border-white/[0.08] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.06]"
              )}
              style={{
                boxShadow: isSelected
                  ? `0 0 20px ${t.color}20, 0 4px 20px rgba(0,0,0,0.2)`
                  : isHovered
                    ? `0 0 12px ${t.color}10`
                    : undefined,
              }}
            >
              {/* Selected checkmark */}
              {isSelected && (
                <div
                  className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: t.color }}
                >
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}

              {/* Icon */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-transform duration-300"
                style={{
                  backgroundColor: `${t.color}18`,
                  color: t.color,
                  transform: isHovered ? "scale(1.1)" : "scale(1)",
                }}
              >
                {t.icon}
              </div>

              {/* Title */}
              <h4
                className="text-sm font-bold mb-0.5 transition-colors"
                style={{ color: isSelected ? t.color : "var(--text)" }}
              >
                {t.title}
              </h4>

              {/* Subtitle */}
              <p className="text-[11px] text-[var(--text2)] leading-relaxed">
                {t.subtitle}
              </p>

              {/* Features preview (visible on hover/select) */}
              <div
                className={cn(
                  "flex flex-wrap gap-1 mt-2 transition-all duration-300 overflow-hidden",
                  isSelected || isHovered
                    ? "max-h-20 opacity-100"
                    : "max-h-0 opacity-0"
                )}
              >
                {t.features.map((f, i) => (
                  <span
                    key={i}
                    className="text-[9px] px-1.5 py-0.5 rounded-md border border-white/10 text-[var(--text2)]"
                    style={{ backgroundColor: `${t.color}10` }}
                  >
                    {f}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
