import { CheckCircle, Store, MapPin, Percent, Package } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Merchant } from "@/types/commerce";
import { businessTypeLabels, tierColors, typeColors, marketNames } from "@/data/mockCommerce";

interface MerchantCardProps {
  merchant: Merchant;
  onViewProducts?: (merchantId: number) => void;
}

export default function MerchantCard({ merchant, onViewProducts }: MerchantCardProps) {
  const tierStyle = tierColors[merchant.subscriptionTier] ?? tierColors.starter;
  const typeClass = typeColors[merchant.businessType] ?? typeColors.other;
  const marketName = marketNames[merchant.marketCode] ?? merchant.marketCode;
  const typeLabel = businessTypeLabels[merchant.businessType] ?? merchant.businessType;

  return (
    <div
      className={cn(
        "group relative rounded-2xl border backdrop-blur-xl p-5",
        "bg-gradient-to-br from-white/[0.08] to-white/[0.02]",
        "border-white/10 hover:border-[var(--cyan)]/30",
        "transition-all duration-300 ease-[var(--smooth)]",
        "hover:shadow-[0_0_30px_rgba(0,212,255,0.08)]",
        "hover:-translate-y-1"
      )}
    >
      {/* Glow on hover */}
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[var(--cyan)]/[0.03] to-[var(--purple)]/[0.03] opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      <div className="relative z-10">
        {/* Header: Name + Verification */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[var(--cyan)]/20 to-[var(--purple)]/20 flex items-center justify-center flex-shrink-0">
              <Store className="w-5 h-5 text-[var(--cyan)]" />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-[var(--text)] text-sm truncate leading-tight">
                {merchant.businessName}
              </h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <MapPin className="w-3 h-3 text-[var(--text2)] flex-shrink-0" />
                <span className="text-xs text-[var(--text2)]">{marketName}</span>
              </div>
            </div>
          </div>
          {merchant.isVerified && (
            <CheckCircle className="w-5 h-5 text-[var(--green)] flex-shrink-0" />
          )}
        </div>

        {/* Badges */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {/* Business type badge */}
          <span className={cn("px-2 py-0.5 rounded-lg text-[10px] font-medium border", typeClass)}>
            {typeLabel}
          </span>
          {/* Subscription tier badge */}
          <span className={cn("px-2 py-0.5 rounded-lg text-[10px] font-medium border", tierStyle.bg, tierStyle.text, tierStyle.border)}>
            {merchant.subscriptionTier === "starter" && " Starter "}
            {merchant.subscriptionTier === "pro" && " Pro "}
            {merchant.subscriptionTier === "enterprise" && " Enterprise "}
            {merchant.subscriptionTier === "ultimate" && " Ultimate "}
          </span>
          {merchant.isHalal !== false && (
            <span className="px-2 py-0.5 rounded-lg text-[10px] font-medium border bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
              حلال
            </span>
          )}
        </div>

        {/* Info row */}
        <div className="flex items-center gap-3 mb-4 text-xs text-[var(--text2)]">
          <div className="flex items-center gap-1">
            <Percent className="w-3.5 h-3.5" />
            <span>عمولة: {(merchant.commissionRate * 100).toFixed(1)}%</span>
          </div>
        </div>

        {/* Action button */}
        <button
          onClick={() => onViewProducts?.(merchant.id)}
          className={cn(
            "w-full flex items-center justify-center gap-2 py-2 rounded-xl",
            "bg-gradient-to-r from-[var(--cyan)]/20 to-[var(--purple)]/20",
            "border border-[var(--cyan)]/20 text-[var(--cyan)] text-sm font-medium",
            "hover:from-[var(--cyan)]/30 hover:to-[var(--purple)]/30",
            "hover:border-[var(--cyan)]/40 transition-all duration-200",
            "active:scale-[0.97]"
          )}
        >
          <Package className="w-4 h-4" />
          عرض المنتجات
        </button>
      </div>
    </div>
  );
}
