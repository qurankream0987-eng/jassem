import { useState, useEffect, useCallback, useMemo } from "react";
import {
  X,
  Timer,
  AlertTriangle,
  CheckCircle,
  ChefHat,
  GripVertical,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export type OrderStatus = "new" | "preparing" | "ready" | "served";

export interface OrderItem {
  name: string;
  nameAr: string;
  quantity: number;
}

export interface KitchenOrder {
  id: string;
  orderNumber: string;
  items: OrderItem[];
  status: OrderStatus;
  priority: "urgent" | "normal" | "low";
  createdAt: number; // timestamp
  tableId?: string;
  notes?: string;
}

export interface KitchenWindowProps {
  restaurantId?: string;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Demo Data                                                          */
/* ------------------------------------------------------------------ */
const INITIAL_ORDERS: KitchenOrder[] = [
  {
    id: "k1", orderNumber: "#2041", tableId: "12",
    items: [
      { nameAr: "بيتزا مارغريتا", name: "Margherita Pizza", quantity: 1 },
      { nameAr: "سلطة سيزر", name: "Caesar Salad", quantity: 2 },
    ],
    status: "new", priority: "urgent", createdAt: Date.now() - 1000 * 60 * 4,
    notes: "بدون جبن",
  },
  {
    id: "k2", orderNumber: "#2042", tableId: "8",
    items: [
      { nameAr: "سلمون مشوي", name: "Grilled Salmon", quantity: 1 },
      { nameAr: "أجنحة حارة", name: "Spicy Wings", quantity: 1 },
    ],
    status: "new", priority: "normal", createdAt: Date.now() - 1000 * 60 * 1,
  },
  {
    id: "k3", orderNumber: "#2038", tableId: "5",
    items: [
      { nameAr: "معكرونة دجاج", name: "Chicken Pasta", quantity: 3 },
    ],
    status: "preparing", priority: "normal", createdAt: Date.now() - 1000 * 60 * 12,
  },
  {
    id: "k4", orderNumber: "#2035", tableId: "3",
    items: [
      { nameAr: "بوول نباتي", name: "Vegan Bowl", quantity: 1 },
      { nameAr: "عصير برتقال", name: "Orange Juice", quantity: 2 },
    ],
    status: "preparing", priority: "low", createdAt: Date.now() - 1000 * 60 * 8,
  },
  {
    id: "k5", orderNumber: "#2032", tableId: "15",
    items: [
      { nameAr: "ستيك ريب آي", name: "Ribeye Steak", quantity: 2 },
      { nameAr: "بطاطس", name: "Fries", quantity: 1 },
    ],
    status: "ready", priority: "urgent", createdAt: Date.now() - 1000 * 60 * 18,
  },
  {
    id: "k6", orderNumber: "#2029", tableId: "7",
    items: [
      { nameAr: "كيكة شوكولاتة", name: "Chocolate Cake", quantity: 1 },
    ],
    status: "ready", priority: "normal", createdAt: Date.now() - 1000 * 60 * 22,
  },
];

const COLUMNS: { key: OrderStatus; labelAr: string; label: string; color: string }[] = [
  { key: "new", labelAr: "جديد", label: "New", color: "#22d3ee" },
  { key: "preparing", labelAr: "قيد التحضير", label: "Preparing", color: "#fbbf24" },
  { key: "ready", labelAr: "جاهز", label: "Ready", color: "#4ade80" },
  { key: "served", labelAr: "تم التقديم", label: "Served", color: "#94a3b8" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

function getCardBorderColor(priority: KitchenOrder["priority"], status: OrderStatus): string {
  if (status === "served") return "rgba(148, 163, 184, 0.15)";
  if (priority === "urgent") return "rgba(248, 113, 113, 0.35)";
  if (priority === "normal") return "rgba(251, 191, 36, 0.25)";
  return "rgba(74, 222, 128, 0.2)";
}

function getPriorityBadge(priority: KitchenOrder["priority"]) {
  switch (priority) {
    case "urgent":
      return (
        <Badge className="gap-1 h-5 text-[10px]" style={{ background: "rgba(248,113,113,0.15)", color: "#f87171", borderColor: "rgba(248,113,113,0.2)" }}>
          <AlertTriangle className="w-3 h-3" /> عاجل
        </Badge>
      );
    case "normal":
      return (
        <Badge className="h-5 text-[10px]" style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24", borderColor: "rgba(251,191,36,0.15)" }}>
          عادي
        </Badge>
      );
    default:
      return (
        <Badge className="h-5 text-[10px]" style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80", borderColor: "rgba(74,222,128,0.15)" }}>
          منخفض
        </Badge>
      );
  }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function KitchenWindow({
  onClose,
}: KitchenWindowProps) {
  const [orders, setOrders] = useState<KitchenOrder[]>(INITIAL_ORDERS);
  const [now, setNow] = useState(Date.now());

  /* ---- live timer ---- */
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  /* ---- advance status ---- */
  const advanceStatus = useCallback((orderId: string) => {
    const flow: OrderStatus[] = ["new", "preparing", "ready", "served"];
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const idx = flow.indexOf(o.status);
        if (idx < flow.length - 1) {
          return { ...o, status: flow[idx + 1] };
        }
        return o;
      })
    );
  }, []);

  /* ---- grouped orders ---- */
  const grouped = useMemo(() => {
    const g: Record<OrderStatus, KitchenOrder[]> = { new: [], preparing: [], ready: [], served: [] };
    orders.forEach((o) => g[o.status].push(o));
    return g;
  }, [orders]);

  return (
    <div
      className="relative flex flex-col w-full max-w-4xl max-h-[85vh] bg-gray-950/80 backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden"
      style={{ background: "rgba(0, 0, 20, 0.82)", borderColor: "rgba(0, 212, 255, 0.15)" }}
      dir="rtl"
    >
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: "rgba(0, 212, 255, 0.1)" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(239,68,68,0.1))" }}
          >
            <ChefHat className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              شاشة المطبخ / Kitchen Display
            </h2>
            <p className="text-white/50 text-xs mt-0.5">نظام عرض الطلبات المباشر / Live Order System</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg" style={{ background: "rgba(0,180,255,0.08)" }}>
            <Timer className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-cyan-400 text-xs font-mono">{formatElapsed(now)}</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.2)" }}
          >
            <X className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      </div>

      {/* ---- Kanban Columns ---- */}
      <div className="flex-1 overflow-x-auto min-h-0">
        <div className="flex gap-3 p-4 h-full min-w-max">
          {COLUMNS.map((col) => (
            <div
              key={col.key}
              className="flex flex-col w-56 rounded-xl overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.02)",
                border: `1px solid ${col.color}15`,
              }}
            >
              {/* Column Header */}
              <div
                className="flex items-center justify-between px-3 py-2.5 shrink-0"
                style={{ background: `${col.color}10`, borderBottom: `1px solid ${col.color}15` }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
                  <span className="text-xs font-semibold" style={{ color: col.color }}>
                    {col.labelAr} / {col.label}
                  </span>
                </div>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                  style={{ background: `${col.color}15`, color: col.color }}
                >
                  {grouped[col.key].length}
                </span>
              </div>

              {/* Orders */}
              <ScrollArea className="flex-1 p-2">
                <div className="space-y-2">
                  {grouped[col.key].map((order) => {
                    const elapsed = now - order.createdAt;
                    const isUrgent = order.priority === "urgent" && order.status !== "served";
                    return (
                      <button
                        key={order.id}
                        onClick={() => advanceStatus(order.id)}
                        className="w-full text-right p-3 rounded-lg transition-all hover:brightness-110 cursor-pointer"
                        style={{
                          background: isUrgent ? "rgba(248,113,113,0.06)" : "rgba(255,255,255,0.03)",
                          border: `1px solid ${getCardBorderColor(order.priority, order.status)}`,
                        }}
                      >
                        {/* Order header */}
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-1.5">
                            <GripVertical className="w-3 h-3 text-white/20" />
                            <span className="text-white font-semibold text-xs">{order.orderNumber}</span>
                          </div>
                          {getPriorityBadge(order.priority)}
                        </div>

                        {/* Table */}
                        <div className="text-white/40 text-[10px] mb-1.5">
                          طاولة / Table {order.tableId}
                        </div>

                        {/* Items */}
                        <div className="space-y-0.5 mb-2">
                          {order.items.map((item, i) => (
                            <div key={i} className="text-white/60 text-xs">
                              <span className="text-cyan-400/70 font-medium">x{item.quantity}</span>{" "}
                              {item.nameAr}
                            </div>
                          ))}
                        </div>

                        {/* Footer: timer + advance hint */}
                        <div className="flex items-center justify-between pt-1.5" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                          <div className={`flex items-center gap-1 text-[10px] font-mono ${isUrgent ? "text-red-400" : "text-white/40"}`}>
                            <Timer className="w-3 h-3" />
                            {formatElapsed(elapsed)}
                          </div>
                          {order.status !== "served" && (
                            <span className="text-[10px] text-white/30">انقر للتقدم</span>
                          )}
                          {order.status === "served" && (
                            <CheckCircle className="w-3.5 h-3.5" style={{ color: "#4ade80" }} />
                          )}
                        </div>

                        {/* Notes */}
                        {order.notes && (
                          <div className="mt-1.5 text-[10px] text-amber-400/70" style={{ background: "rgba(245,158,11,0.05)", padding: "2px 6px", borderRadius: "4px" }}>
                            {order.notes}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </ScrollArea>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
