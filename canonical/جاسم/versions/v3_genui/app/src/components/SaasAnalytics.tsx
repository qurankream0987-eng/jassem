import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  ShoppingBag,
  DollarSign,
  Users,
  BarChart3,
  Calendar,
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

interface SaasAnalyticsProps {
  platformName?: string;
}

const dateRanges = [
  { label: "7 أيام", value: 7 },
  { label: "30 يوم", value: 30 },
  { label: "90 يوم", value: 90 },
];

const generateDailyData = (days: number) => {
  const data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    data.push({
      date: d.toLocaleDateString("ar-SA", { month: "short", day: "numeric" }),
      orders: Math.floor(Math.random() * 30) + 5,
      revenue: Math.floor(Math.random() * 3000) + 500,
      visitors: Math.floor(Math.random() * 200) + 50,
    });
  }
  return data;
};

const categoryData = [
  { name: "منتجات رئيسية", value: 45, color: "#00d4ff" },
  { name: "إضافات", value: 25, color: "#a855f7" },
  { name: "مشروبات", value: 20, color: "#ec4899" },
  { name: "أخرى", value: 10, color: "#f59e0b" },
];

const paymentMethodData = [
  { name: "عند الاستلام", value: 55, color: "#00d4ff" },
  { name: "بطاقة", value: 30, color: "#4a9eff" },
  { name: "محفظة", value: 15, color: "#10b981" },
];

export default function SaasAnalytics({ platformName }: SaasAnalyticsProps) {
  const [range, setRange] = useState(7);

  const data = useMemo(() => generateDailyData(range), [range]);

  const stats = useMemo(() => {
    const totalOrders = data.reduce((s, d) => s + d.orders, 0);
    const totalRevenue = data.reduce((s, d) => s + d.revenue, 0);
    const totalVisitors = data.reduce((s, d) => s + d.visitors, 0);
    const conversionRate = totalVisitors > 0 ? ((totalOrders / totalVisitors) * 100).toFixed(1) : "0";
    return { totalOrders, totalRevenue, totalVisitors, conversionRate };
  }, [data]);

  const statCards = [
    {
      label: "إجمالي الطلبات",
      value: stats.totalOrders.toLocaleString(),
      change: "+12%",
      up: true,
      icon: <ShoppingBag className="w-4 h-4" />,
      color: "#00d4ff",
    },
    {
      label: "الإيرادات",
      value: `${stats.totalRevenue.toLocaleString()} ر.س`,
      change: "+8%",
      up: true,
      icon: <DollarSign className="w-4 h-4" />,
      color: "#10b981",
    },
    {
      label: "الزوار",
      value: stats.totalVisitors.toLocaleString(),
      change: "-3%",
      up: false,
      icon: <Users className="w-4 h-4" />,
      color: "#a855f7",
    },
    {
      label: "معدل التحويل",
      value: `${stats.conversionRate}%`,
      change: "+1.2%",
      up: true,
      icon: <BarChart3 className="w-4 h-4" />,
      color: "#f59e0b",
    },
  ];

  return (
    <div className="w-full space-y-4" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[var(--cyan)]" />
          <h3 className="text-sm font-bold text-[var(--text)]">
            {platformName ? `إحصائيات ${platformName}` : "إحصائيات المنصة"}
          </h3>
        </div>

        {/* Date range */}
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

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-2">
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
                {s.up ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {s.change}
              </div>
            </div>
            <p className="text-lg font-extrabold text-[var(--text)]">{s.value}</p>
            <p className="text-[10px] text-[var(--text2)] mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Revenue chart */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
          الإيرادات اليومية
        </h4>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
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
              tickFormatter={(v) => `${v}`}
            />
            <Tooltip
              contentStyle={{
                background: "rgba(0,0,0,0.85)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "8px",
                fontSize: "11px",
                color: "#f0f4ff",
              }}
              formatter={(value: number) => [`${value.toLocaleString()} ر.س`, "الإيرادات"]}
            />
            <Area
              type="monotone"
              dataKey="revenue"
              stroke="#00d4ff"
              fill="url(#revenueGrad)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Orders bar chart */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
            الطلبات اليومية
          </h4>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={data.slice(-7)}>
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
              />
              <Bar dataKey="orders" fill="#a855f7" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Category pie */}
        <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
          <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
            التصنيفات
          </h4>
          <ResponsiveContainer width="100%" height={140}>
            <PieChart>
              <Pie
                data={categoryData}
                cx="50%"
                cy="50%"
                innerRadius={30}
                outerRadius={55}
                paddingAngle={3}
                dataKey="value"
              >
                {categoryData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "rgba(0,0,0,0.85)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: "#f0f4ff",
                }}
                formatter={(value: number) => [`${value}%`, ""]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-2 mt-1 justify-center">
            {categoryData.map((c) => (
              <div key={c.name} className="flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-[9px] text-[var(--text2)]">{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Payment methods */}
      <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-[10px] font-medium text-[var(--text2)] mb-3">
          طرق الدفع
        </h4>
        <div className="flex items-center gap-4">
          <ResponsiveContainer width="100%" height={100}>
            <PieChart>
              <Pie
                data={paymentMethodData}
                cx="50%"
                cy="50%"
                outerRadius={45}
                dataKey="value"
              >
                {paymentMethodData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: "rgba(0,0,0,0.85)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "8px",
                  fontSize: "11px",
                  color: "#f0f4ff",
                }}
                formatter={(value: number) => [`${value}%`, ""]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-2 flex-1">
            {paymentMethodData.map((p) => (
              <div key={p.name} className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="text-[10px] text-[var(--text)]">{p.name}</span>
                </div>
                <span className="text-[10px] text-[var(--text2)]">{p.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
