import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export type ChartType = "area" | "bar" | "line" | "pie";

interface RevenueChartProps {
  data: Array<Record<string, string | number>>;
  type?: ChartType;
  dataKey?: string;
  xAxisKey?: string;
  name?: string;
  color?: string;
  height?: number;
  yFormatter?: (v: number) => string;
  tooltipFormatter?: (value: number, name: string) => [string, string];
  pieData?: Array<{ name: string; value: number; color: string }>;
}

const defaultTooltipStyle = {
  background: "rgba(0,0,0,0.85)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  fontSize: "11px",
  color: "#f0f4ff",
  direction: "rtl" as const,
};

export default function RevenueChart({
  data,
  type = "area",
  dataKey = "value",
  xAxisKey = "date",
  name,
  color = "#00d4ff",
  height = 180,
  yFormatter,
  tooltipFormatter,
  pieData,
}: RevenueChartProps) {
  const gradientId = useMemo(
    () => `chart-grad-${Math.random().toString(36).slice(2, 8)}`,
    []
  );

  const renderChart = () => {
    switch (type) {
      case "area":
        return (
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey={xAxisKey}
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={yFormatter}
            />
            <Tooltip
              contentStyle={defaultTooltipStyle}
              formatter={tooltipFormatter}
            />
            <Area
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              fill={`url(#${gradientId})`}
              strokeWidth={2}
              name={name}
            />
          </AreaChart>
        );

      case "bar":
        return (
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey={xAxisKey}
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={yFormatter}
            />
            <Tooltip
              contentStyle={defaultTooltipStyle}
              formatter={tooltipFormatter}
            />
            <Bar
              dataKey={dataKey}
              fill={color}
              radius={[4, 4, 0, 0]}
              name={name}
            />
          </BarChart>
        );

      case "line":
        return (
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis
              dataKey={xAxisKey}
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={yFormatter}
            />
            <Tooltip
              contentStyle={defaultTooltipStyle}
              formatter={tooltipFormatter}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              name={name}
            />
          </LineChart>
        );

      case "pie":
        const pd = pieData || [];
        return (
          <PieChart>
            <Pie
              data={pd}
              cx="50%"
              cy="50%"
              innerRadius={35}
              outerRadius={60}
              paddingAngle={3}
              dataKey="value"
            >
              {pd.map((entry, index) => (
                <Cell key={index} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip contentStyle={defaultTooltipStyle} />
          </PieChart>
        );

      default:
        return null;
    }
  };

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={height}>
        {renderChart()}
      </ResponsiveContainer>
      {type === "pie" && pieData && (
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {pieData.map((item) => (
            <div key={item.name} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-[10px] text-[var(--text2)]">{item.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
