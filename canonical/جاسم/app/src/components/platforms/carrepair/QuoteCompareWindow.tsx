import { useMemo } from "react";
import {
  X,
  Scale,
  DollarSign,
  Clock,
  Shield,
  CheckCircle,
  Star,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface Quote {
  id: string;
  garageName: string;
  garageNameAr: string;
  rating: number;
  reviewCount: number;
  totalPrice: number;
  currency: string;
  laborCost: number;
  partsCost: number;
  warrantyMonths: number;
  estimatedHours: number;
  specialties: string[];
  specialtiesAr: string[];
}

export interface QuoteCompareWindowProps {
  bookingId?: string;
  quotes?: Quote[];
  onAccept?: (quoteId: string) => void;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Demo Data                                                          */
/* ------------------------------------------------------------------ */
const DEFAULT_QUOTES: Quote[] = [
  {
    id: "q1", garageName: "SpeedFix Auto", garageNameAr: "سبيدفيكس أوتو",
    rating: 4.8, reviewCount: 234,
    totalPrice: 650, currency: "SAR",
    laborCost: 300, partsCost: 350,
    warrantyMonths: 6, estimatedHours: 4,
    specialties: ["Engine", "Electrical"], specialtiesAr: ["محركات", "كهرباء"],
  },
  {
    id: "q2", garageName: "TurboCare Center", garageNameAr: "تيربو كير سنتر",
    rating: 4.9, reviewCount: 412,
    totalPrice: 580, currency: "SAR",
    laborCost: 250, partsCost: 330,
    warrantyMonths: 12, estimatedHours: 5,
    specialties: ["Transmission", "Brakes", "AC"], specialtiesAr: ["ناقل حركة", "فرامل", "تكييف"],
  },
  {
    id: "q3", garageName: "Elite Auto Shop", garageNameAr: "إيليت أوتو شوب",
    rating: 4.7, reviewCount: 156,
    totalPrice: 720, currency: "SAR",
    laborCost: 350, partsCost: 370,
    warrantyMonths: 3, estimatedHours: 3,
    specialties: ["Engine", "Transmission", "Electrical"], specialtiesAr: ["محركات", "ناقل حركة", "كهرباء"],
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function QuoteCompareWindow({
  bookingId = "BK-2024-0891",
  quotes = DEFAULT_QUOTES,
  onAccept,
  onClose,
}: QuoteCompareWindowProps) {
  /* ---- find best price & warranty ---- */
  const { bestPriceId, bestWarrantyId, minPrice, maxWarranty } = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    let bestPrice = "";
    let bestWarranty = "";
    quotes.forEach((q) => {
      if (q.totalPrice < min) { min = q.totalPrice; bestPrice = q.id; }
      if (q.warrantyMonths > max) { max = q.warrantyMonths; bestWarranty = q.id; }
    });
    return { bestPriceId: bestPrice, bestWarrantyId: bestWarranty, minPrice: min, maxWarranty: max };
  }, [quotes]);

  const renderStars = (rating: number) => (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star
          key={s}
          className={`w-3 h-3 ${s <= Math.floor(rating) ? "text-amber-400 fill-amber-400" : "text-white/20"}`}
        />
      ))}
    </div>
  );

  return (
    <div
      className="relative flex flex-col w-full max-w-3xl max-h-[85vh] bg-gray-950/80 backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden"
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
            <Scale className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              مقارنة العروض / Compare Quotes
            </h2>
            <p className="text-white/50 text-xs mt-0.5">
              حجز / Booking <span className="text-cyan-400 font-mono">{bookingId}</span>
            </p>
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

      <ScrollArea className="flex-1 p-4 min-h-0">
        {/* ---- Summary Pills ---- */}
        <div className="flex gap-2 mb-4 flex-wrap">
          <Badge
            className="h-6 text-[10px]"
            style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80", borderColor: "rgba(74,222,128,0.15)" }}
          >
            <DollarSign className="w-3 h-3 mr-1" />
            أفضل سعر: {minPrice} ر.س
          </Badge>
          <Badge
            className="h-6 text-[10px]"
            style={{ background: "rgba(245,158,11,0.1)", color: "#fbbf24", borderColor: "rgba(245,158,11,0.15)" }}
          >
            <Shield className="w-3 h-3 mr-1" />
            أفضل ضمان: {maxWarranty} شهر
          </Badge>
        </div>

        {/* ---- Comparison Cards ---- */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {quotes.map((quote) => {
            const isBestPrice = quote.id === bestPriceId;
            const isBestWarranty = quote.id === bestWarrantyId;
            return (
              <div
                key={quote.id}
                className="rounded-xl overflow-hidden flex flex-col"
                style={{
                  background: isBestPrice
                    ? "rgba(74, 222, 128, 0.04)"
                    : "rgba(255,255,255,0.02)",
                  border: `1px solid ${isBestPrice ? "rgba(74,222,128,0.2)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                {/* Card Header */}
                <div className="p-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.1), rgba(100,50,255,0.08))" }}
                    >
                      <Wrench className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-white/90 text-sm font-medium truncate">{quote.garageNameAr}</h3>
                      <p className="text-white/40 text-[10px]">{quote.garageName}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {renderStars(quote.rating)}
                    <span className="text-white/40 text-[10px]">({quote.reviewCount})</span>
                  </div>
                </div>

                {/* Specialties */}
                <div className="px-3.5 py-2 flex flex-wrap gap-1">
                  {quote.specialtiesAr.map((spec, i) => (
                    <span
                      key={i}
                      className="text-[9px] px-1.5 py-0.5 rounded-full"
                      style={{ background: "rgba(0,180,255,0.06)", color: "rgba(103,232,249,0.6)", border: "1px solid rgba(0,180,255,0.08)" }}
                    >
                      {spec}
                    </span>
                  ))}
                </div>

                {/* Breakdown */}
                <div className="px-3.5 space-y-2 py-2">
                  {/* Total */}
                  <div
                    className="flex items-center justify-between p-2 rounded-lg"
                    style={{
                      background: isBestPrice ? "rgba(74,222,128,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${isBestPrice ? "rgba(74,222,128,0.12)" : "transparent"}`,
                    }}
                  >
                    <span className="text-white/50 text-xs">الإجمالي / Total</span>
                    <span className={`font-bold text-base ${isBestPrice ? "text-green-400" : "text-cyan-400"}`}>
                      {quote.totalPrice} {quote.currency}
                    </span>
                  </div>

                  {/* Labor */}
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 text-[11px] flex items-center gap-1">
                      <DollarSign className="w-3 h-3" /> العمالة / Labor
                    </span>
                    <span className="text-white/60 text-xs">{quote.laborCost} {quote.currency}</span>
                  </div>

                  {/* Parts */}
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 text-[11px] flex items-center gap-1">
                      <Wrench className="w-3 h-3" /> القطع / Parts
                    </span>
                    <span className="text-white/60 text-xs">{quote.partsCost} {quote.currency}</span>
                  </div>

                  {/* Warranty */}
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 text-[11px] flex items-center gap-1">
                      <Shield className="w-3 h-3" /> الضمان / Warranty
                    </span>
                    <span className={`text-xs ${isBestWarranty ? "text-amber-400 font-semibold" : "text-white/60"}`}>
                      {quote.warrantyMonths} شهر
                      {isBestWarranty && " ★"}
                    </span>
                  </div>

                  {/* Hours */}
                  <div className="flex items-center justify-between">
                    <span className="text-white/40 text-[11px] flex items-center gap-1">
                      <Clock className="w-3 h-3" /> الوقت / Hours
                    </span>
                    <span className="text-white/60 text-xs">{quote.estimatedHours} ساعة</span>
                  </div>
                </div>

                {/* CTA */}
                <div className="mt-auto p-3.5 pt-2">
                  <Button
                    onClick={() => onAccept?.(quote.id)}
                    className="w-full h-8 text-xs rounded-lg font-medium transition-all hover:scale-[1.02]"
                    style={{
                      background: isBestPrice
                        ? "linear-gradient(135deg, rgba(74,222,128,0.2), rgba(34,197,94,0.15))"
                        : "linear-gradient(135deg, rgba(0,180,255,0.15), rgba(100,50,255,0.1))",
                      color: isBestPrice ? "#4ade80" : "#67e8f9",
                      border: `1px solid ${isBestPrice ? "rgba(74,222,128,0.25)" : "rgba(0,180,255,0.2)"}`,
                    }}
                  >
                    <CheckCircle className="w-3.5 h-3.5 mr-1" />
                    {isBestPrice ? "أفضل سعر! اقبل / Accept" : "اقبل العرض / Accept"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
