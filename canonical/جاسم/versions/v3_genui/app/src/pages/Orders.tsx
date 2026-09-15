import { useState, useMemo } from "react";
import { Package, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import OrderCard from "@/components/OrderCard";
import { mockOrders, mockMerchants, orderStatusConfig } from "@/data/mockCommerce";

const statusTabs = [
  { key: "all", label: "الكل" },
  { key: "pending", label: "قيد الانتظار" },
  { key: "confirmed", label: "مؤكد" },
  { key: "processing", label: "قيد التجهيز" },
  { key: "shipped", label: "تم الشحن" },
  { key: "delivered", label: "تم التوصيل" },
];

export default function Orders() {
  const [activeTab, setActiveTab] = useState("all");

  // Build a lookup for merchant names
  const merchantMap = useMemo(() => {
    const map = new Map<number, string>();
    mockMerchants.forEach((m) => map.set(m.id, m.businessName));
    return map;
  }, []);

  const filtered = useMemo(() => {
    if (activeTab === "all") return mockOrders;
    return mockOrders.filter((o) => o.status === activeTab);
  }, [activeTab]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: mockOrders.length };
    for (const tab of statusTabs) {
      if (tab.key !== "all") {
        c[tab.key] = mockOrders.filter((o) => o.status === tab.key).length;
      }
    }
    return c;
  }, []);

  return (
    <div className="w-full h-full overflow-y-auto p-4 pb-20" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--text)] mb-1">
              طلباتي
            </h1>
            <p className="text-sm text-[var(--text2)]">
              تتبع وإدارة طلباتك بكل سهولة
            </p>
          </div>
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[var(--cyan)]/20 to-[var(--purple)]/20 flex items-center justify-center">
            <ClipboardList className="w-6 h-6 text-[var(--cyan)]" />
          </div>
        </div>
      </div>

      {/* Status count cards */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-5">
        {statusTabs.map((tab) => {
          const statusCfg = orderStatusConfig[tab.key];
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={cn(
                "flex flex-col items-center gap-1 p-2.5 rounded-xl border transition-all duration-200",
                activeTab === tab.key
                  ? "bg-[var(--cyan)]/10 border-[var(--cyan)]/30"
                  : "bg-white/5 border-white/10 hover:bg-white/[0.08]"
              )}
            >
              {tab.key !== "all" && statusCfg && (
                <span className={cn("w-2 h-2 rounded-full", statusCfg.dot)} />
              )}
              {tab.key === "all" && (
                <Package className="w-3.5 h-3.5 text-[var(--text2)]" />
              )}
              <span className={cn(
                "text-xs font-medium",
                activeTab === tab.key ? "text-[var(--cyan)]" : "text-[var(--text2)]"
              )}>
                {tab.label}
              </span>
              <span className="text-lg font-bold text-[var(--text)]">{counts[tab.key] ?? 0}</span>
            </button>
          );
        })}
      </div>

      {/* Orders list */}
      {filtered.length > 0 ? (
        <div className="space-y-3">
          {filtered.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              merchantName={merchantMap.get(order.merchantId)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
            <Package className="w-10 h-10 text-[var(--text2)]/30" />
          </div>
          <h3 className="text-lg font-bold text-[var(--text)] mb-1">
            لا توجد طلبات بعد
          </h3>
          <p className="text-sm text-[var(--text2)] mb-6">
            ابدأ التسوق وستظهر طلباتك هنا
          </p>
          <a
            href="/products"
            className={cn(
              "px-6 py-2.5 rounded-xl text-sm font-medium",
              "bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)]",
              "text-white shadow-lg shadow-[var(--cyan)]/20",
              "hover:shadow-[var(--cyan)]/30 transition-all active:scale-[0.98]"
            )}
          >
            تصفح المنتجات
          </a>
        </div>
      )}
    </div>
  );
}
