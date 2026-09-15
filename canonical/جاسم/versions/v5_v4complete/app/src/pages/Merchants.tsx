import { useState, useMemo } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import MerchantCard from "@/components/MerchantCard";
import { mockMerchants, businessTypeLabels, marketNames } from "@/data/mockCommerce";
import type { BusinessType } from "@/types/commerce";

const filterTabs: { key: string; label: string }[] = [
  { key: "all", label: "الكل" },
  { key: "restaurant", label: "مطاعم" },
  { key: "pharmacy", label: "صيدليات" },
  { key: "clothing", label: "موضة" },
  { key: "grocery", label: "بقالة" },
  { key: "electronics", label: "إلكترونيات" },
  { key: "salon", label: "صالونات" },
  { key: "real_estate", label: "عقارات" },
  { key: "workshop", label: "ورش" },
  { key: "wholesale", label: "جملة" },
  { key: "clinic", label: "عيادات" },
];

export default function Merchants() {
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [halalOnly, setHalalOnly] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<string>("all");

  // Available markets from mock data
  const availableMarkets = useMemo(() => {
    const codes = new Set(mockMerchants.map((m) => m.marketCode));
    return Array.from(codes).sort();
  }, []);

  const filtered = useMemo(() => {
    return mockMerchants.filter((m) => {
      // Tab filter
      if (activeTab !== "all" && m.businessType !== activeTab) return false;
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        const typeAr = businessTypeLabels[m.businessType]?.toLowerCase() ?? "";
        if (
          !m.businessName.toLowerCase().includes(q) &&
          !typeAr.includes(q) &&
          !m.marketCode.toLowerCase().includes(q)
        )
          return false;
      }
      // Halal filter
      if (halalOnly && m.isHalal === false) return false;
      // Market filter
      if (selectedMarket !== "all" && m.marketCode !== selectedMarket) return false;

      return true;
    });
  }, [search, activeTab, halalOnly, selectedMarket]);

  return (
    <div className="w-full h-full overflow-y-auto p-4 pb-20" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[var(--text)] mb-1">
          المتاجر والأعمال
        </h1>
        <p className="text-sm text-[var(--text2)]">
          اكتشف أفضل المتاجر والتجار في جميع الأسواق العربية
        </p>
      </div>

      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text2)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن متجر..."
          className={cn(
            "w-full h-11 pl-10 pr-4 rounded-xl",
            "bg-white/5 border border-white/10",
            "text-[var(--text)] text-sm placeholder:text-[var(--text2)]/50",
            "focus:outline-none focus:border-[var(--cyan)]/40 focus:bg-white/[0.07]",
            "transition-all duration-200"
          )}
        />
      </div>

      {/* Filters row */}
      <div className="flex flex-col gap-3 mb-5">
        {/* Market selector */}
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-[var(--text2)] flex-shrink-0" />
          <select
            value={selectedMarket}
            onChange={(e) => setSelectedMarket(e.target.value)}
            className={cn(
              "h-8 px-2.5 rounded-lg text-xs",
              "bg-white/5 border border-white/10",
              "text-[var(--text)] focus:outline-none focus:border-[var(--cyan)]/40",
              "cursor-pointer"
            )}
          >
            <option value="all">جميع الأسواق</option>
            {availableMarkets.map((code) => (
              <option key={code} value={code}>
                {marketNames[code] ?? code} ({code})
              </option>
            ))}
          </select>

          {/* Halal toggle */}
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <div
              onClick={() => setHalalOnly(!halalOnly)}
              className={cn(
                "w-9 h-5 rounded-full transition-all duration-200 flex items-center px-0.5",
                halalOnly ? "bg-emerald-500/60" : "bg-white/15"
              )}
            >
              <div
                className={cn(
                  "w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200",
                  halalOnly ? "translate-x-4" : "translate-x-0"
                )}
              />
            </div>
            <span className="text-xs text-emerald-300 font-medium">وضع الحلال فقط</span>
          </label>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium",
                "border transition-all duration-200 whitespace-nowrap",
                activeTab === tab.key
                  ? "bg-[var(--cyan)]/20 border-[var(--cyan)]/40 text-[var(--cyan)]"
                  : "bg-white/5 border-white/10 text-[var(--text2)] hover:bg-white/[0.08] hover:text-[var(--text)]"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-[var(--text2)]">
          {filtered.length} متجر
        </span>
        {halalOnly && (
          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-lg border border-emerald-500/20">
            وضع الحلال مفعل
          </span>
        )}
      </div>

      {/* Merchants grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((merchant) => (
            <MerchantCard
              key={merchant.id}
              merchant={merchant}
              onViewProducts={(id) => {
                // Navigate to products page with merchant filter - will be handled by router
                window.location.href = `/products?merchant=${id}`;
              }}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-[var(--text2)]" />
          </div>
          <p className="text-[var(--text2)] text-sm mb-1">لا توجد متاجر مطابقة</p>
          <p className="text-[var(--text2)]/60 text-xs">جرب تغيير الفلاتر أو البحث</p>
        </div>
      )}
    </div>
  );
}
