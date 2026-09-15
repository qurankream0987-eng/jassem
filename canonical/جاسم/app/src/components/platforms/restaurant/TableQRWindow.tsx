import { useState, useCallback } from "react";
import {
  X,
  QrCode,
  ScanLine,
  Plus,
  Minus,
  ShoppingCart,
  Flame,
  Leaf,
  UtensilsCrossed,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface QuickItem {
  id: string;
  name: string;
  nameAr: string;
  price: number;
  currency: string;
  isSpicy?: boolean;
  isVegan?: boolean;
}

export interface TableQRWindowProps {
  tableId: string;
  restaurantId?: string;
  restaurantName?: string;
  restaurantNameAr?: string;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Demo Data                                                          */
/* ------------------------------------------------------------------ */
const POPULAR_ITEMS: QuickItem[] = [
  { id: "q1", name: "House Fries", nameAr: "بطاطس مقلية", price: 18, currency: "SAR" },
  { id: "q2", name: "Spicy Wings", nameAr: "أجنحة حارة", price: 32, currency: "SAR", isSpicy: true },
  { id: "q3", name: "Caesar Salad", nameAr: "سلطة سيزر", price: 28, currency: "SAR" },
  { id: "q4", name: "Vegan Bowl", nameAr: "بوول نباتي", price: 35, currency: "SAR", isVegan: true },
  { id: "q5", name: "Grilled Chicken", nameAr: "دجاج مشوي", price: 45, currency: "SAR" },
  { id: "q6", name: "Iced Latte", nameAr: "لاتيه مثلج", price: 16, currency: "SAR" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function TableQRWindow({
  tableId,
  restaurantName = "Bella Vista",
  restaurantNameAr = "بيلا فيستا",
  onClose,
}: TableQRWindowProps) {
  const [scanned, setScanned] = useState(false);
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const toggleScan = useCallback(() => {
    setScanned(true);
  }, []);

  const increment = useCallback((itemId: string) => {
    setQuantities((prev) => ({ ...prev, [itemId]: (prev[itemId] || 0) + 1 }));
  }, []);

  const decrement = useCallback((itemId: string) => {
    setQuantities((prev) => {
      const current = prev[itemId] || 0;
      if (current <= 1) {
        const next = { ...prev };
        delete next[itemId];
        return next;
      }
      return { ...prev, [itemId]: current - 1 };
    });
  }, []);

  const totalItems = Object.values(quantities).reduce((a, b) => a + b, 0);
  const totalPrice = POPULAR_ITEMS.reduce((sum, item) => {
    const qty = quantities[item.id] || 0;
    return sum + item.price * qty;
  }, 0);

  return (
    <div
      className="relative flex flex-col w-full max-w-md max-h-[85vh] bg-gray-950/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
      style={{ background: "rgba(0, 0, 20, 0.82)", borderColor: "rgba(0, 212, 255, 0.15)" }}
      dir="rtl"
    >
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: "rgba(0, 212, 255, 0.1)" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.2), rgba(100,50,255,0.15))" }}
          >
            <QrCode className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              طلب بالمسح / QR Order
            </h2>
            <p className="text-white/50 text-xs mt-0.5">{restaurantNameAr} / {restaurantName}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110"
          style={{ background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.2)" }}
        >
          <X className="w-3.5 h-3.5 text-red-400" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {!scanned ? (
          /* ---- QR Code View ---- */
          <div className="flex flex-col items-center justify-center p-8 gap-6">
            {/* Table Number */}
            <div className="text-center">
              <p className="text-white/50 text-sm mb-1">رقم الطاولة / Table</p>
              <div
                className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto"
                style={{
                  background: "linear-gradient(135deg, rgba(0,180,255,0.15), rgba(100,50,255,0.1))",
                  border: "1px solid rgba(0, 212, 255, 0.2)",
                }}
              >
                <span className="text-4xl font-bold text-cyan-400">{tableId}</span>
              </div>
            </div>

            {/* QR Code Placeholder */}
            <button
              onClick={toggleScan}
              className="group relative w-48 h-48 rounded-2xl flex flex-col items-center justify-center gap-3 transition-all hover:scale-[1.02] cursor-pointer"
              style={{
                background: "linear-gradient(135deg, rgba(0,180,255,0.08), rgba(100,50,255,0.05))",
                border: "2px dashed rgba(0, 212, 255, 0.25)",
              }}
            >
              <QrCode className="w-16 h-16 text-cyan-400/40 group-hover:text-cyan-400/70 transition-colors" />
              <span className="text-cyan-400/60 text-xs font-medium">انقر لمحاكاة المسح</span>
              <ScanLine className="absolute top-2 left-1/2 -translate-x-1/2 w-8 h-8 text-cyan-400/20 animate-pulse" />
            </button>

            {/* Instructions */}
            <div className="text-center space-y-1">
              <p className="text-white/70 text-sm font-medium">امسح الكود للطلب</p>
              <p className="text-white/40 text-xs">Scan the code to order</p>
            </div>

            {/* Decorative dots */}
            <div className="flex gap-1.5">
              <span className="w-2 h-2 rounded-full bg-cyan-400/30 animate-pulse" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 rounded-full bg-cyan-400/30 animate-pulse" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 rounded-full bg-cyan-400/30 animate-pulse" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        ) : (
          /* ---- Menu After Scan ---- */
          <div className="p-4 space-y-4">
            {/* Welcome message */}
            <div
              className="p-3 rounded-xl text-center"
              style={{ background: "rgba(0, 180, 255, 0.05)", border: "1px solid rgba(0, 212, 255, 0.1)" }}
            >
              <p className="text-cyan-400 text-sm font-medium">مرحباً! الطاولة {tableId} / Table {tableId}</p>
              <p className="text-white/40 text-xs mt-0.5">اختر من القائمة السريعة أدناه</p>
            </div>

            {/* Quick Order Items */}
            <div>
              <h3 className="text-white/70 text-xs font-semibold mb-2 flex items-center gap-1.5">
                <UtensilsCrossed className="w-3.5 h-3.5 text-cyan-400" />
                الأكثر طلباً / Popular
              </h3>
              <div className="space-y-2">
                {POPULAR_ITEMS.map((item) => {
                  const qty = quantities[item.id] || 0;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between p-3 rounded-xl"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-white/80 text-sm">{item.nameAr} / {item.name}</span>
                          {item.isSpicy && <Flame className="w-3 h-3 text-red-400 shrink-0" />}
                          {item.isVegan && <Leaf className="w-3 h-3 text-green-400 shrink-0" />}
                        </div>
                        <span className="text-cyan-400 text-xs font-semibold">{item.price} {item.currency}</span>
                      </div>

                      {qty > 0 ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => decrement(item.id)}
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(255,80,80,0.12)" }}
                          >
                            <Minus className="w-3.5 h-3.5 text-red-400" />
                          </button>
                          <span className="text-white text-sm font-semibold w-5 text-center">{qty}</span>
                          <button
                            onClick={() => increment(item.id)}
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{ background: "rgba(0,180,255,0.12)" }}
                          >
                            <Plus className="w-3.5 h-3.5 text-cyan-400" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => increment(item.id)}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all hover:scale-105"
                          style={{ background: "rgba(0,180,255,0.12)", color: "#67e8f9", border: "1px solid rgba(0,180,255,0.2)" }}
                        >
                          إضافة
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ---- Footer with total ---- */}
      {scanned && totalItems > 0 && (
        <div
          className="shrink-0 p-3 border-t"
          style={{ background: "rgba(0, 180, 255, 0.05)", borderColor: "rgba(0, 212, 255, 0.1)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-cyan-400" />
              <span className="text-white/70 text-xs">{totalItems} عنصر / items</span>
            </div>
            <span className="text-cyan-400 font-bold text-sm">{totalPrice.toFixed(2)} SAR</span>
          </div>
          <Button
            className="w-full h-9 text-xs rounded-lg font-medium"
            style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.25), rgba(100,50,255,0.2))", color: "#67e8f9", border: "1px solid rgba(0,180,255,0.25)" }}
          >
            إرسال الطلب / Submit Order
          </Button>
        </div>
      )}
    </div>
  );
}
