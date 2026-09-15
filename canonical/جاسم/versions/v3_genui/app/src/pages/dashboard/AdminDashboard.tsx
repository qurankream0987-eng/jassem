import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  Shield,
  Users,
  Store,
  ShoppingBag,
  DollarSign,
  BarChart3,
  Globe,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  TrendingUp,
  Zap,
  ChevronLeft,
  Search,
} from "lucide-react";
import StatsCards from "@/components/dashboard/StatsCards";
import type { StatCardData } from "@/components/dashboard/StatsCards";
import RevenueChart from "@/components/dashboard/RevenueChart";
import DataTable from "@/components/dashboard/DataTable";

const generateSystemData = (days: number) => {
  const data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data.push({
      date: d.toLocaleDateString("ar-SA", { month: "short", day: "numeric" }),
      revenue: Math.floor(Math.random() * 200000) + 50000,
      orders: Math.floor(Math.random() * 500) + 100,
      users: Math.floor(Math.random() * 200) + 50,
      merchants: Math.floor(Math.random() * 20) + 5,
    });
  }
  return data;
};

const dateRanges = [
  { label: "7 أيام", value: 7 },
  { label: "30 يوم", value: 30 },
  { label: "90 يوم", value: 90 },
];

const marketBreakdown = [
  { name: "السعودية", code: "SA", users: 45200, merchants: 1200, revenue: 2800000, color: "#00d4ff" },
  { name: "الإمارات", code: "AE", users: 28900, merchants: 850, revenue: 1900000, color: "#4a9eff" },
  { name: "مصر", code: "EG", users: 67800, merchants: 2100, revenue: 1200000, color: "#a855f7" },
  { name: "الكويت", code: "KW", users: 12400, merchants: 380, revenue: 980000, color: "#ec4899" },
  { name: "قطر", code: "QA", users: 9800, merchants: 290, revenue: 850000, color: "#f59e0b" },
  { name: "البحرين", code: "BH", users: 5600, merchants: 170, revenue: 420000, color: "#10b981" },
  { name: "عمان", code: "OM", users: 7200, merchants: 210, revenue: 380000, color: "#ef4444" },
  { name: "الأردن", code: "JO", users: 15400, merchants: 480, revenue: 320000, color: "#8b5cf6" },
  { name: "العراق", code: "IQ", users: 32100, merchants: 950, revenue: 280000, color: "#06b6d4" },
  { name: "المغرب", code: "MA", users: 28500, merchants: 720, revenue: 190000, color: "#84cc16" },
  { name: "تونس", code: "TN", users: 19800, merchants: 540, revenue: 140000, color: "#f97316" },
  { name: "لبنان", code: "LB", users: 11200, merchants: 340, revenue: 110000, color: "#eab308" },
  { name: "السودان", code: "SD", users: 22400, merchants: 620, revenue: 85000, color: "#14b8a6" },
  { name: "ليبيا", code: "LY", users: 8600, merchants: 210, revenue: 65000, color: "#6366f1" },
  { name: "الجزائر", code: "DZ", users: 31200, merchants: 780, revenue: 170000, color: "#d946ef" },
  { name: "اليمن", code: "YE", users: 18900, merchants: 430, revenue: 45000, color: "#22c55e" },
  { name: "موريتانيا", code: "MR", users: 3200, merchants: 85, revenue: 18000, color: "#0ea5e9" },
  { name: "فلسطين", code: "PS", users: 6700, merchants: 190, revenue: 52000, color: "#e11d48" },
];

const recentSignups = [
  { name: "مطعم الذوق الرفيع", type: "مطعم", market: "السعودية", date: "2026-06-27", status: "active" },
  { name: "صالون لمسة جمال", type: "صالون", market: "الإمارات", date: "2026-06-27", status: "pending" },
  { name: "إلكترونيات الغد", type: "إلكترونيات", market: "مصر", date: "2026-06-26", status: "active" },
  { name: "ورشة الصيانة السريعة", type: "صيانة", market: "الكويت", date: "2026-06-26", status: "active" },
  { name: "صيدلية الأمل", type: "صيدلية", market: "قطر", date: "2026-06-25", status: "flagged" },
];

const alerts = [
  { type: "warning", message: "5 تجار بحاجة لمراجعة KYC", time: "منذ ساعة" },
  { type: "success", message: "تم اعتماد 3 تجار جدد", time: "منذ ساعتين" },
  { type: "warning", message: "نسبة النزاعات مرتفعة في الكويت", time: "منذ 3 ساعات" },
  { type: "success", message: "تحديث النظام تم بنجاح", time: "منذ 5 ساعات" },
];

const revenueStreams = [
  { name: "عمولة الطلبات", value: 65, color: "#00d4ff" },
  { name: "اشتراكات", value: 20, color: "#a855f7" },
  { name: "إعلانات", value: 10, color: "#ec4899" },
  { name: "خدمات إضافية", value: 5, color: "#f59e0b" },
];

const agentPerformance = [
  { name: "Agent Alpha", tasks: 1240, success: 98.2, avgTime: "2.3s", color: "#00d4ff" },
  { name: "Agent Beta", tasks: 980, success: 96.5, avgTime: "3.1s", color: "#a855f7" },
  { name: "Agent Gamma", tasks: 1450, success: 99.1, avgTime: "1.8s", color: "#10b981" },
  { name: "Agent Delta", tasks: 760, success: 94.8, avgTime: "4.2s", color: "#f59e0b" },
];

export default function AdminDashboard() {
  const [range, setRange] = useState(30);
  const [marketSearch, setMarketSearch] = useState("");

  const data = useMemo(() => generateSystemData(range), [range]);

  const stats: StatCardData[] = [
    {
      label: "المستخدمين",
      value: "342K",
      change: "+18%",
      up: true,
      icon: <Users className="w-4 h-4" />,
      color: "#00d4ff",
    },
    {
      label: "التجار",
      value: "8,450",
      change: "+12%",
      up: true,
      icon: <Store className="w-4 h-4" />,
      color: "#a855f7",
    },
    {
      label: "الطلبات",
      value: "156.2K",
      change: "+25%",
      up: true,
      icon: <ShoppingBag className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      label: "الإيرادات",
      value: "8.5M ر.س",
      change: "+31%",
      up: true,
      icon: <DollarSign className="w-4 h-4" />,
      color: "#f59e0b",
    },
  ];

  const filteredMarkets = marketBreakdown.filter(
    (m) =>
      m.name.includes(marketSearch) ||
      m.code.toLowerCase().includes(marketSearch.toLowerCase())
  );

  return (
    <div
      className="w-full h-full overflow-y-auto p-4 pb-20"
      style={{ direction: "rtl" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-extrabold text-[var(--text)] mb-1 flex items-center gap-2">
            <Shield className="w-5 h-5 text-[var(--cyan)]" />
            لوحة المشرف العام
          </h1>
          <p className="text-xs text-[var(--text2)]">
            نظرة شاملة على أداء المنصة في جميع الأسواق
          </p>
        </div>
        <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[9px] text-emerald-400 font-medium">النظام يعمل</span>
        </div>
      </div>

      {/* Stats */}
      <StatsCards cards={stats} columns={4} />

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mt-4">
        {/* Revenue chart */}
        <div className="lg:col-span-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
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
            height={180}
            yFormatter={(v) => `${(v / 1000000).toFixed(1)}M`}
            tooltipFormatter={(value: number) => [`${(value / 1000000).toFixed(2)}M ر.س`, "الإيرادات"]}
          />
        </div>

        {/* Revenue streams */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
            <DollarSign className="w-3.5 h-3.5 text-[var(--purple)]" />
            مصادر الإيرادات
          </h3>
          <RevenueChart
            data={[]}
            type="pie"
            pieData={revenueStreams}
            height={120}
          />
          <div className="space-y-2 mt-3">
            {revenueStreams.map((s) => (
              <div key={s.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="text-[10px] text-[var(--text)]">{s.name}</span>
                </div>
                <span className="text-[10px] font-bold text-[var(--text)]">
                  {s.value}%
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Market breakdown */}
      <div className="mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold text-[var(--text)] flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-[var(--cyan)]" />
            تفصيل الأسواق (18 سوق)
          </h3>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[var(--text2)]" />
            <input
              type="text"
              value={marketSearch}
              onChange={(e) => setMarketSearch(e.target.value)}
              placeholder="بحث..."
              className={cn(
                "w-28 h-7 pl-7 pr-2 rounded-lg text-[10px]",
                "bg-white/5 border border-white/10",
                "text-[var(--text)] placeholder:text-[var(--text2)]/40",
                "focus:outline-none focus:border-[var(--cyan)]/40"
              )}
            />
          </div>
        </div>
        <div
          className="overflow-y-auto rounded-lg border border-white/[0.06]"
          style={{ maxHeight: "280px" }}
        >
          <table className="w-full text-right">
            <thead className="sticky top-0 z-10 bg-white/[0.05]">
              <tr>
                <th className="px-3 py-2 text-[10px] font-medium text-[var(--text2)]">
                  السوق
                </th>
                <th className="px-3 py-2 text-[10px] font-medium text-[var(--text2)]">
                  المستخدمين
                </th>
                <th className="px-3 py-2 text-[10px] font-medium text-[var(--text2)]">
                  التجار
                </th>
                <th className="px-3 py-2 text-[10px] font-medium text-[var(--text2)]">
                  الإيرادات
                </th>
                <th className="px-3 py-2 text-[10px] font-medium text-[var(--text2)]">
                  الحالة
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMarkets.map((m) => (
                <tr
                  key={m.code}
                  className="border-t border-white/[0.05] hover:bg-white/[0.02] transition-colors"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: m.color }}
                      />
                      <span className="text-[11px] text-[var(--text)] font-medium">
                        {m.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--text)]">
                    {m.users.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[11px] text-[var(--text)]">
                    {m.merchants.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-[11px] font-bold text-[var(--text)]">
                    {(m.revenue / 1000000).toFixed(2)}M
                  </td>
                  <td className="px-3 py-2">
                    <span className="px-1.5 py-0.5 rounded-full text-[8px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      نشط
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Two columns: Agent performance + Alerts/Signups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-4">
        {/* Agent performance */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-[var(--cyan)]" />
            أداء الوكلاء
          </h3>
          <div className="space-y-3">
            {agentPerformance.map((agent) => (
              <div
                key={agent.name}
                className="p-2.5 rounded-xl bg-white/[0.02] border border-white/[0.05]"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold"
                      style={{ backgroundColor: `${agent.color}15`, color: agent.color }}
                    >
                      {agent.name[6]}
                    </div>
                    <span className="text-[11px] font-medium text-[var(--text)]">
                      {agent.name}
                    </span>
                  </div>
                  <span className="text-[10px] text-[var(--text2)]">
                    {agent.tasks.toLocaleString()} مهمة
                  </span>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <div className="flex justify-between text-[9px] mb-1">
                      <span className="text-[var(--text2)]">نسبة النجاح</span>
                      <span className="text-[var(--text)]">{agent.success}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${agent.success}%`,
                          backgroundColor: agent.color,
                        }}
                      />
                    </div>
                  </div>
                  <div className="text-[9px] text-[var(--text2)] flex items-center gap-1">
                    <Zap className="w-3 h-3" style={{ color: agent.color }} />
                    {agent.avgTime}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts + Recent signups */}
        <div className="space-y-3">
          {/* Alerts */}
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              التنبيهات
            </h3>
            <div className="space-y-2">
              {alerts.map((alert, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex items-start gap-2 p-2.5 rounded-xl border",
                    alert.type === "warning"
                      ? "bg-amber-500/[0.03] border-amber-500/10"
                      : "bg-emerald-500/[0.03] border-emerald-500/10"
                  )}
                >
                  {alert.type === "warning" ? (
                    <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-[var(--text)]">
                      {alert.message}
                    </p>
                    <p className="text-[9px] text-[var(--text2)] mt-0.5">
                      {alert.time}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent signups */}
          <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
            <h3 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-[var(--purple)]" />
              أحدث التسجيلات
            </h3>
            <DataTable
              columns={[
                { key: "name", header: "الاسم", sortable: true },
                { key: "type", header: "النوع" },
                { key: "market", header: "السوق" },
                {
                  key: "status",
                  header: "الحالة",
                  render: (row: { status: string }) => (
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded-full text-[8px] font-medium border",
                        row.status === "active"
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                          : row.status === "pending"
                            ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
                            : "bg-red-500/10 text-red-400 border-red-500/20"
                      )}
                    >
                      {row.status === "active"
                        ? "نشط"
                        : row.status === "pending"
                          ? "معلق"
                          : "بحاجة مراجعة"}
                    </span>
                  ),
                },
              ]}
              data={recentSignups}
              rowKey={(row, idx) => idx}
              searchable={false}
              maxHeight="180px"
            />
          </div>
        </div>
      </div>

      {/* Footer spacing */}
      <div className="h-8" />
    </div>
  );
}
