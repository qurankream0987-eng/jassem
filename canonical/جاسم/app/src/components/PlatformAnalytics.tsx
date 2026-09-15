import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Store,
  DollarSign,
  Users,
  ShoppingBag,
  AlertTriangle,
  Calendar,
  BarChart3,
  ArrowUpRight,
} from "lucide-react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";

const dateRanges = [
  { label: "7 أيام", value: 7 },
  { label: "30 يوم", value: 30 },
  { label: "90 يوم", value: 90 },
  { label: "سنة", value: 365 },
];

const generatePlatformData = (days: number) => {
  const data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data.push({
      date: d.toLocaleDateString("ar-SA", { month: "short", day: "numeric" }),
      gmv: Math.floor(Math.random() * 50000) + 10000,
      commission: Math.floor(Math.random() * 5000) + 1000,
      orders: Math.floor(Math.random() * 200) + 30,
      vendors: Math.floor(Math.random() * 10) + 40,
      disputes: Math.floor(Math.random() * 5),
    });
  }
  return data;
};

const topCategoriesData = [
  { name: "مطاعم", gmv: 180000, orders: 850, color: "#00d4ff" },
  { name: "صالونات", gmv: 120000, orders: 620, color: "#ec4899" },
  { name: "إلكترونيات", gmv: 250000, orders: 430, color: "#a855f7" },
  { name: "ملابس", gmv: 150000, orders: 710, color: "#f59e0b" },
  { name: "خدمات", gmv: 90000, orders: 520, color: "#10b981" },
  { name: "بقالة", gmv: 110000, orders: 930, color: "#ef4444" },
];

export default function PlatformAnalytics() {
  const [range, setRange] = useState(30);

  const data = useMemo(() => generatePlatformData(range), [range]);

  const stats = useMemo(() => {
    const totalGMV = data.reduce((s, d) => s + d.gmv, 0);
    const totalCommission = data.reduce((s, d) => s + d.commission, 0);
    const totalOrders = data.reduce((s, d) => s + d.orders, 0);
    const activeVendors = data[data.length - 1]?.vendors || 0;
    const totalDisputes = data.reduce((s, d) => s + d.disputes, 0);
    const disputeRate = totalOrders > 0 ? ((totalDisputes / totalOrders) * 100).toFixed(1) : "0";
    return { totalGMV, totalCommission, totalOrders, activeVendors, totalDisputes, disputeRate };
  }, [data]);

  const statCards = [
    {
      label: "GMV الإجمالي",
      value: `${(stats.totalGMV / 1000000).toFixed(2)} مليون ر.س`,
      change: "+18%",
      up: true,
      icon: <DollarSign className="w-4 h-4" />,
      color: "#00d4ff",
    },
    {
      label: "العمولة المحققة",
      value: `${(stats.totalCommission / 1000).toFixed(0)} ألف ر.س`,
      change: "+15%",
      up: true,
      icon: <TrendingUp className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      label: "التجار النشطون",
      value: stats.activeVendors.toString(),
      change: "+5",
      up: true,
      icon: <Store className="w-4 h-4" />,
      color: "#a855f7",
    },
    {
      label: "إجمالي الطلبات",
      value: stats.totalOrders.toLocaleString(),
      change: "+22%",
      up: true,
      icon: <ShoppingBag className="w-4 h-4" />,
      color: "#f59e0b",
    },
    {
      label: "معدل النزاعات",
      value: `${stats.disputeRate}%`,
      change: "-0.5%",
      up: false,
      icon: <AlertTriangle className="w-4 h-4" />,
      color: "#ef4444",
    },
  ];

  return (
    <div className="w-full space-y-4" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[var(--cyan)]" />
          <h3 className="text-sm font-bold text-[var(--text)]">
            تحليلات السوق التجميعي
          </h3>
        </div>
        <div className="flex gap-1">
          {dateRanges.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              className={cn(
                "px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-all",
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

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] backdrop-blur-sm"
          >
            <div className="flex items-center justify-between mb-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ backgroundColor: `${s.color}15`, color: s.color }}
              >
                {s.icon}
              </div>
              <div
                className={cn(
                  "flex items-center gap-0.5 text-[10px] font-medium",
                  s.up ? "text-emerald-400" : "text-red-400"
                )}
              >
                {s.change}
              </div>
            </div>
            <p className="text-sm font-extrabold text-[var(--text)]">{s.value}</p>
            <p className="text-[9px] text-[var(--text2)] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* GMV Chart */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
          GMV (إجمالي قيمة السلع) - يومي
        </h4>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00d4ff" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#00d4ff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(0,0,0,0.85)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "11px",
                color: "#f0f4ff",
              }}
              formatter={(value: number) => [`${value.toLocaleString()} ر.س`, "GMV"]}
            />
            <Area
              type="monotone"
              dataKey="gmv"
              stroke="#00d4ff"
              fill="url(#gmvGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Commission chart */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
            العمولة اليومية
          </h4>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={data.slice(-14)}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 8, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 8, fill: "#94a3b8" }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}K`}
              />
              <Tooltip
                contentStyle={{
                  background: "rgba(0,0,0,0.85)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: "#f0f4ff",
                }}
              />
              <Bar dataKey="commission" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Top categories */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
            أفضل التصنيفات
          </h4>
          <div className="space-y-2">
            {topCategoriesData.map((cat) => (
              <div key={cat.name} className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
                <span className="text-[10px] text-[var(--text)] w-16 flex-shrink-0">
                  {cat.name}
                </span>
                <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(cat.gmv / 250000) * 100}%`,
                      backgroundColor: cat.color,
                    }}
                  />
                </div>
                <span className="text-[9px] text-[var(--text2)] w-14 text-left flex-shrink-0">
                  {(cat.gmv / 1000).toFixed(0)}K
                </span>
                <div className="flex items-center gap-0.5 text-[9px] text-emerald-400">
                  <ArrowUpRight className="w-3 h-3" />
                  {cat.orders}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Vendors growth */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
          نمو عدد التجار
        </h4>
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 8, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(0,0,0,0.85)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "11px",
                color: "#f0f4ff",
              }}
              formatter={(value: number) => [`${value}`, "تجار"]}
            />
            <Line
              type="monotone"
              dataKey="vendors"
              stroke="#a855f7"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
