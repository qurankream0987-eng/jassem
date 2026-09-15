import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  ShoppingBag,
  DollarSign,
  Users,
  Star,
  Package,
  Settings,
  Plus,
  ListOrdered,
  TrendingUp,
  AlertTriangle,
  Calendar,
  ChevronLeft,
} from "lucide-react";
import StatsCards from "@/components/dashboard/StatsCards";
import type { StatCardData } from "@/components/dashboard/StatsCards";
import RevenueChart from "@/components/dashboard/RevenueChart";
import DataTable from "@/components/dashboard/DataTable";

const generateDailyRevenue = (days: number) => {
  const data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data.push({
      date: d.toLocaleDateString("ar-SA", { month: "short", day: "numeric" }),
      revenue: Math.floor(Math.random() * 5000) + 1000,
      orders: Math.floor(Math.random() * 25) + 3,
    });
  }
  return data;
};

const dateRanges = [
  { label: "7 أيام", value: 7 },
  { label: "30 يوم", value: 30 },
  { label: "90 يوم", value: 90 },
];

const recentOrders = [
  { id: "ORD-1842", customer: "أحمد محمد", total: 245, status: "delivered", date: "2026-06-27", items: 3 },
  { id: "ORD-1841", customer: "سارة علي", total: 189, status: "processing", date: "2026-06-27", items: 2 },
  { id: "ORD-1840", customer: "خالد عمر", total: 456, status: "pending", date: "2026-06-26", items: 5 },
  { id: "ORD-1839", customer: "نورة فهد", total: 120, status: "shipped", date: "2026-06-26", items: 1 },
  { id: "ORD-1838", customer: "فهد سالم", total: 334, status: "delivered", date: "2026-06-25", items: 4 },
  { id: "ORD-1837", customer: "لمياء عبدالله", total: 78, status: "cancelled", date: "2026-06-25", items: 1 },
  { id: "ORD-1836", customer: "محمد سعيد", total: 512, status: "delivered", date: "2026-06-24", items: 6 },
];

const topProducts = [
  { name: "برجر لحم أنجوس", sales: 342, revenue: 10260 },
  { name: "باستا الفريدو", sales: 278, revenue: 6940 },
  { name: "سلطة سيزر", sales: 245, revenue: 3675 },
  { name: "عصير برتقال طازج", sales: 198, revenue: 1980 },
  { name: "كيك الشوكولاتة", sales: 156, revenue: 2340 },
];

const inventoryAlerts = [
  { product: "برجر لحم أنجوس", stock: 5, minStock: 20 },
  { product: "صوص الباربيكيو", stock: 3, minStock: 15 },
  { product: "خبز برجر", stock: 8, minStock: 25 },
];

const statusBadge = (status: string) => {
  const styles: Record<string, string> = {
    delivered: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    pending: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    shipped: "bg-[var(--cyan)]/10 text-[var(--cyan)] border-[var(--cyan)]/20",
    cancelled: "bg-red-500/10 text-red-400 border-red-500/20",
  };
  const labels: Record<string, string> = {
    delivered: "تم التوصيل",
    processing: "قيد المعالجة",
    pending: "معلق",
    shipped: "تم الشحن",
    cancelled: "ملغي",
  };
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-full text-[9px] font-medium border",
        styles[status] || styles.pending
      )}
    >
      {labels[status] || status}
    </span>
  );
};

export default function MerchantDashboard() {
  const [range, setRange] = useState(7);
  const [activeSection, setActiveSection] = useState<string>("overview");

  const data = useMemo(() => generateDailyRevenue(range), [range]);

  const stats: StatCardData[] = [
    {
      label: "إجمالي الطلبات",
      value: "1,248",
      change: "+14%",
      up: true,
      icon: <ShoppingBag className="w-4 h-4" />,
      color: "#00d4ff",
    },
    {
      label: "الإيرادات",
      value: "45,230 ر.س",
      change: "+9%",
      up: true,
      icon: <DollarSign className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      label: "الزبائن",
      value: "892",
      change: "+22%",
      up: true,
      icon: <Users className="w-4 h-4" />,
      color: "#a855f7",
    },
    {
      label: "التقييم",
      value: "4.8",
      change: "+0.2",
      up: true,
      icon: <Star className="w-4 h-4" />,
      color: "#f59e0b",
    },
  ];

  const quickActions = [
    {
      label: "إضافة منتج",
      icon: <Plus className="w-4 h-4" />,
      color: "#00d4ff",
    },
    {
      label: "عرض الطلبات",
      icon: <ListOrdered className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      label: "الإعدادات",
      icon: <Settings className="w-4 h-4" />,
      color: "#a855f7",
    },
  ];

  return (
    <div
      className="w-full h-full overflow-y-auto p-4 pb-20"
      style={{ direction: "rtl" }}
    >
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-extrabold text-[var(--text)] mb-1">
          لوحة التاجر
        </h1>
        <p className="text-xs text-[var(--text2)]">
          نظرة شاملة على أداء متجرك
        </p>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 mb-4">
        {quickActions.map((action) => (
          <button
            key={action.label}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[10px] font-medium border transition-all",
              "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/15"
            )}
          >
            <span style={{ color: action.color }}>{action.icon}</span>
            <span className="text-[var(--text)]">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Stats */}
      <StatsCards cards={stats} columns={2} />

      {/* Revenue chart */}
      <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-[var(--text)] flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-[var(--cyan)]" />
            الإيرادات
          </h3>
          <div className="flex gap-1">
            {dateRanges.map((r) => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={cn(
                  "px-2 py-0.5 rounded-lg text-[9px] font-medium border transition-all",
                  range === r.value
                    ? "bg-[var(--cyan)]/15 border-[var(--cyan)]/30 text-[var(--cyan)]"
                    : "bg-white/5 border-white/5 text-[var(--text2)] hover:bg-white/[0.08]"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        <RevenueChart
          data={data}
          type="area"
          dataKey="revenue"
          xAxisKey="date"
          name="الإيرادات"
          color="#00d4ff"
          height={160}
          yFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
          tooltipFormatter={(value: number) => [`${value.toLocaleString()} ر.س`, "الإيرادات"]}
        />
      </div>

      {/* Two columns: Recent orders + Top products */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
        {/* Recent orders */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold text-[var(--text)] flex items-center gap-2">
              <ListOrdered className="w-3.5 h-3.5 text-[var(--cyan)]" />
              أحدث الطلبات
            </h3>
            <button className="text-[9px] text-[var(--cyan)] hover:underline flex items-center gap-0.5">
              عرض الكل
              <ChevronLeft className="w-3 h-3" />
            </button>
          </div>
          <DataTable
            columns={[
              { key: "id", header: "الطلب", width: "60px" },
              { key: "customer", header: "العميل", sortable: true },
              {
                key: "total",
                header: "المبلغ",
                render: (row: { total: number }) => (
                  <span className="font-bold">{row.total} ر.س</span>
                ),
              },
              {
                key: "status",
                header: "الحالة",
                render: (row: { status: string }) => statusBadge(row.status),
              },
            ]}
            data={recentOrders.slice(0, 5)}
            rowKey={(row) => row.id}
            searchable={false}
            maxHeight="200px"
          />
        </div>

        {/* Top products */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
            <Package className="w-3.5 h-3.5 text-[var(--purple)]" />
            الأكثر مبيعاً
          </h3>
          <div className="space-y-2">
            {topProducts.map((product, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.05]"
              >
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                  style={{
                    backgroundColor:
                      idx === 0
                        ? "#FFD70020"
                        : idx === 1
                          ? "#94a3b820"
                          : idx === 2
                            ? "#CD7F3220"
                            : "rgba(255,255,255,0.05)",
                    color:
                      idx === 0
                        ? "#FFD700"
                        : idx === 1
                          ? "#94a3b8"
                          : idx === 2
                            ? "#CD7F32"
                            : "var(--text2)",
                  }}
                >
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium text-[var(--text)] truncate">
                    {product.name}
                  </p>
                  <p className="text-[9px] text-[var(--text2)]">
                    {product.sales} مبيعة
                  </p>
                </div>
                <span className="text-[10px] font-bold text-[var(--text)]">
                  {product.revenue.toLocaleString()} ر.س
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Inventory alerts */}
      <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
          تنبيهات المخزون
        </h3>
        <div className="space-y-2">
          {inventoryAlerts.map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-3 p-2.5 rounded-xl bg-amber-500/[0.04] border border-amber-500/10"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-medium text-[var(--text)]">
                  {item.product}
                </p>
                <p className="text-[9px] text-[var(--text2)]">
                  المتبقي: {item.stock} | الحد الأدنى: {item.minStock}
                </p>
              </div>
              <div className="w-16 h-1.5 rounded-full bg-white/10 overflow-hidden flex-shrink-0">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{ width: `${(item.stock / item.minStock) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
