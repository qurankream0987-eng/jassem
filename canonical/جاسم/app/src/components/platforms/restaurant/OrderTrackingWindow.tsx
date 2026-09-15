import { useState, useEffect } from "react";
import {
  X,
  Package,
  ChefHat,
  Bike,
  MapPin,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export type TrackingStep =
  | "confirmed"
  | "preparing"
  | "ready"
  | "out_for_delivery"
  | "delivered";

export interface OrderTrackingWindowProps {
  orderId: string;
  estimatedMinutes?: number;
  driverName?: string;
  driverNameAr?: string;
  driverRating?: number;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Step Config                                                        */
/* ------------------------------------------------------------------ */
interface StepConfig {
  key: TrackingStep;
  icon: React.ReactNode;
  labelAr: string;
  label: string;
}

const STEPS: StepConfig[] = [
  { key: "confirmed", icon: <Package className="w-5 h-5" />, labelAr: "تم التأكيد", label: "Confirmed" },
  { key: "preparing", icon: <ChefHat className="w-5 h-5" />, labelAr: "قيد التحضير", label: "Preparing" },
  { key: "ready", icon: <CheckCircle className="w-5 h-5" />, labelAr: "جاهز", label: "Ready" },
  { key: "out_for_delivery", icon: <Bike className="w-5 h-5" />, labelAr: "في الطريق", label: "Out for Delivery" },
  { key: "delivered", icon: <MapPin className="w-5 h-5" />, labelAr: "تم التوصيل", label: "Delivered" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function OrderTrackingWindow({
  orderId,
  estimatedMinutes = 25,
  driverName = "Ahmad Khalid",
  driverNameAr = "أحمد خالد",
  driverRating = 4.8,
  onClose,
}: OrderTrackingWindowProps) {
  const [currentStepIdx, setCurrentStepIdx] = useState(1); // starts at "preparing"
  const [minutesLeft, setMinutesLeft] = useState(estimatedMinutes);

  /* ---- simulate progress ---- */
  useEffect(() => {
    const stepTimer = setInterval(() => {
      setCurrentStepIdx((prev) => Math.min(prev + 1, STEPS.length - 1));
    }, 15000);
    return () => clearInterval(stepTimer);
  }, []);

  useEffect(() => {
    const minTimer = setInterval(() => {
      setMinutesLeft((prev) => Math.max(0, prev - 1));
    }, 60000);
    return () => clearInterval(minTimer);
  }, []);

  const currentStep = STEPS[currentStepIdx];

  return (
    <div
      className="relative flex flex-col w-full max-w-lg max-h-[85vh] bg-gray-950/80 backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden"
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
            <Bike className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              تتبع الطلب / Track Order
            </h2>
            <p className="text-white/50 text-xs mt-0.5">
              طلب / Order <span className="text-cyan-400 font-mono">{orderId}</span>
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

      <div className="flex-1 overflow-y-auto min-h-0 p-5 space-y-6">
        {/* ---- Status Badge ---- */}
        <div className="text-center">
          <Badge
            className="px-4 py-1.5 text-sm font-semibold h-auto"
            style={{
              background: "linear-gradient(135deg, rgba(0,180,255,0.15), rgba(100,50,255,0.1))",
              color: "#67e8f9",
              border: "1px solid rgba(0,180,255,0.2)",
            }}
          >
            {currentStep.labelAr} / {currentStep.label}
          </Badge>
          <p className="text-white/40 text-xs mt-2">
            {minutesLeft > 0 ? `الوقت المتوقع: ${minutesLeft} دقيقة / ETA: ${minutesLeft} min` : "وصل تقريباً / Arriving soon"}
          </p>
        </div>

        {/* ---- Progress Steps ---- */}
        <div className="relative">
          {/* Connector line */}
          <div
            className="absolute top-5 right-8 left-8 h-0.5"
            style={{ background: "rgba(255,255,255,0.06)" }}
          >
            <div
              className="h-full transition-all duration-700"
              style={{
                background: "linear-gradient(90deg, rgba(0,180,255,0.5), rgba(100,50,255,0.3))",
                width: `${(currentStepIdx / (STEPS.length - 1)) * 100}%`,
              }}
            />
          </div>

          {/* Steps */}
          <div className="relative flex justify-between">
            {STEPS.map((step, idx) => {
              const isActive = idx <= currentStepIdx;
              const isCurrent = idx === currentStepIdx;
              return (
                <div key={step.key} className="flex flex-col items-center gap-2 z-10">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500 ${isCurrent ? "animate-pulse" : ""}`}
                    style={{
                      background: isActive
                        ? isCurrent
                          ? "linear-gradient(135deg, rgba(0,180,255,0.3), rgba(100,50,255,0.2))"
                          : "rgba(0,180,255,0.15)"
                        : "rgba(255,255,255,0.05)",
                      border: `2px solid ${isActive ? (isCurrent ? "rgba(0,180,255,0.5)" : "rgba(0,180,255,0.2)") : "rgba(255,255,255,0.08)"}`,
                      boxShadow: isCurrent ? "0 0 16px rgba(0,180,255,0.15)" : "none",
                    }}
                  >
                    <span style={{ color: isActive ? "#67e8f9" : "rgba(255,255,255,0.2)" }}>
                      {step.icon}
                    </span>
                  </div>
                  <span
                    className="text-[10px] text-center leading-tight max-w-[60px]"
                    style={{ color: isActive ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)" }}
                  >
                    {step.labelAr}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- Map Placeholder ---- */}
        <div
          className="rounded-xl overflow-hidden relative"
          style={{
            background: "rgba(10, 15, 30, 0.8)",
            border: "1px solid rgba(255,255,255,0.06)",
            height: "160px",
          }}
        >
          {/* Grid pattern simulating map */}
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: "linear-gradient(rgba(0,180,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.15) 1px, transparent 1px)",
              backgroundSize: "30px 30px",
            }}
          />
          {/* Route line */}
          <svg className="absolute inset-0 w-full h-full" viewBox="0 0 400 160" preserveAspectRatio="none">
            <path
              d="M 40 120 Q 120 80, 200 100 T 360 40"
              fill="none"
              stroke="rgba(0,180,255,0.3)"
              strokeWidth="2"
              strokeDasharray="6 4"
            >
              <animate attributeName="stroke-dashoffset" from="100" to="0" dur="3s" repeatCount="indefinite" />
            </path>
          </svg>
          {/* Restaurant pin */}
          <div className="absolute bottom-6 left-8 flex flex-col items-center">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(0,180,255,0.2)", border: "1px solid rgba(0,180,255,0.3)" }}
            >
              <ChefHat className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-[9px] text-white/40 mt-0.5">المطعم</span>
          </div>
          {/* Driver pin */}
          <div
            className="absolute flex flex-col items-center"
            style={{ top: "30%", right: "20%" }}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center animate-bounce"
              style={{
                background: "linear-gradient(135deg, rgba(0,180,255,0.3), rgba(100,50,255,0.2))",
                border: "2px solid rgba(0,180,255,0.4)",
                boxShadow: "0 0 12px rgba(0,180,255,0.2)",
              }}
            >
              <Bike className="w-4 h-4 text-cyan-300" />
            </div>
          </div>
          {/* Destination pin */}
          <div className="absolute top-3 right-4 flex flex-col items-center">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.25)" }}
            >
              <MapPin className="w-4 h-4 text-green-400" />
            </div>
            <span className="text-[9px] text-white/40 mt-0.5">أنت</span>
          </div>
        </div>

        {/* ---- Driver Info ---- */}
        <div
          className="flex items-center gap-3 p-3 rounded-xl"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.15), rgba(100,50,255,0.1))" }}
          >
            <Bike className="w-5 h-5 text-cyan-400" />
          </div>
          <div className="flex-1">
            <p className="text-white/80 text-sm">{driverNameAr} / {driverName}</p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-amber-400 text-xs">
                {"★".repeat(Math.floor(driverRating))}
              </span>
              <span className="text-white/40 text-xs">{driverRating}</span>
            </div>
          </div>
          <div className="text-right">
            <p className="text-cyan-400 text-xs font-semibold">{minutesLeft} دقيقة</p>
            <p className="text-white/30 text-[10px]">ETA</p>
          </div>
        </div>
      </div>

      {/* ---- Footer ---- */}
      <div className="shrink-0 p-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }}>
        <Button
          variant="outline"
          className="w-full h-9 text-xs rounded-lg border-red-400/20 text-red-400 hover:bg-red-400/10 hover:text-red-300 transition-all"
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
          إلغاء الطلب / Cancel Order
        </Button>
      </div>
    </div>
  );
}
