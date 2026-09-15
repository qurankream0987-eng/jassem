import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

export interface StatCardData {
  label: string;
  value: string;
  change: string;
  up: boolean;
  icon: React.ReactNode;
  color: string;
}

interface StatsCardsProps {
  cards: StatCardData[];
  columns?: 2 | 3 | 4;
}

export default function StatsCards({ cards, columns = 2 }: StatsCardsProps) {
  const gridClass =
    columns === 4
      ? "grid-cols-2 lg:grid-cols-4"
      : columns === 3
        ? "grid-cols-3"
        : "grid-cols-2";

  return (
    <div className={`grid ${gridClass} gap-2`}>
      {cards.map((card) => (
        <div
          key={card.label}
          className={cn(
            "p-3 rounded-xl backdrop-blur-sm",
            "bg-white/[0.03] border border-white/[0.08]",
            "transition-all duration-200 hover:border-white/15 hover:bg-white/[0.05]"
          )}
        >
          <div className="flex items-center justify-between mb-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${card.color}15`, color: card.color }}
            >
              {card.icon}
            </div>
            <div
              className={cn(
                "flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full",
                card.up
                  ? "text-emerald-400 bg-emerald-500/10"
                  : "text-red-400 bg-red-500/10"
              )}
            >
              {card.up ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              {card.change}
            </div>
          </div>
          <p className="text-lg font-extrabold text-[var(--text)] leading-tight">
            {card.value}
          </p>
          <p className="text-[10px] text-[var(--text2)] mt-1">{card.label}</p>
        </div>
      ))}
    </div>
  );
}
