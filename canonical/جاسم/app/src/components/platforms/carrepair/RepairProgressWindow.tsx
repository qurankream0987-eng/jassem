import { useState } from "react";
import {
  X,
  Settings,
  Camera,
  MessageSquare,
  DollarSign,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export type RepairStep =
  | "diagnosis"
  | "parts_ordered"
  | "repair"
  | "testing"
  | "ready";

export interface ChatMessage {
  id: string;
  sender: "garage" | "customer";
  text: string;
  textAr: string;
  timestamp: string;
}

export interface RepairProgressWindowProps {
  bookingId?: string;
  currentStep?: RepairStep;
  estimatedCost?: number;
  actualCost?: number;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const STEPS: { key: RepairStep; labelAr: string; label: string }[] = [
  { key: "diagnosis", labelAr: "التشخيص", label: "Diagnosis" },
  { key: "parts_ordered", labelAr: "طلب القطع", label: "Parts Ordered" },
  { key: "repair", labelAr: "الإصلاح", label: "Repair" },
  { key: "testing", labelAr: "الفحص", label: "Testing" },
  { key: "ready", labelAr: "جاهز", label: "Ready" },
];

const DEMO_MESSAGES: ChatMessage[] = [
  {
    id: "c1", sender: "garage",
    textAr: "تم تشخيص المشكلة. يحتاج السيارة لتغيير فلاتر ومسح إلكتروني.",
    text: "Diagnosis complete. Your car needs filter replacement and electronic scan.",
    timestamp: "10:30 AM",
  },
  {
    id: "c2", sender: "customer",
    textAr: "تمام، يرجى المتابعة. هل هناك أي تكاليف إضافية متوقعة؟",
    text: "Go ahead. Any additional costs expected?",
    timestamp: "10:35 AM",
  },
  {
    id: "c3", sender: "garage",
    textAr: "القطع وصلت وبدأنا العمل. التكلفة الإضافية ١٢٠ ريال فقط.",
    text: "Parts arrived and work has started. Additional cost is only 120 SAR.",
    timestamp: "11:15 AM",
  },
];

const DEMO_PHOTOS = [
  { id: "p1", labelAr: "المحرك قبل الإصلاح", label: "Before repair" },
  { id: "p2", labelAr: "تغيير القطع", label: "Parts replacement" },
  { id: "p3", labelAr: "فحص النظام", label: "System check" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function RepairProgressWindow({
  bookingId = "BK-2024-0891",
  currentStep = "repair",
  estimatedCost = 580,
  actualCost = 700,
  onClose,
}: RepairProgressWindowProps) {
  const [activeTab, setActiveTab] = useState<"progress" | "photos" | "chat">("progress");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(DEMO_MESSAGES);
  const [chatInput, setChatInput] = useState("");
  const [showApproveModal, setShowApproveModal] = useState(false);

  const currentStepIdx = STEPS.findIndex((s) => s.key === currentStep);
  const costDifference = actualCost - estimatedCost;

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    const newMsg: ChatMessage = {
      id: `c${Date.now()}`,
      sender: "customer",
      text: chatInput,
      textAr: chatInput,
      timestamp: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
    };
    setChatMessages((prev) => [...prev, newMsg]);
    setChatInput("");
  };

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
            <Settings className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              متابعة الإصلاح / Repair Progress
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

      {/* ---- Tabs ---- */}
      <div className="flex gap-1 p-2 border-b shrink-0" style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.15)" }}>
        {([
          { key: "progress" as const, icon: <Settings className="w-3.5 h-3.5" />, labelAr: "التقدم", label: "Progress" },
          { key: "photos" as const, icon: <Camera className="w-3.5 h-3.5" />, labelAr: "الصور", label: "Photos" },
          { key: "chat" as const, icon: <MessageSquare className="w-3.5 h-3.5" />, labelAr: "الرسائل", label: "Chat" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs transition-all"
            style={{
              background: activeTab === tab.key ? "rgba(0,180,255,0.1)" : "transparent",
              color: activeTab === tab.key ? "#67e8f9" : "rgba(255,255,255,0.4)",
              border: `1px solid ${activeTab === tab.key ? "rgba(0,180,255,0.15)" : "transparent"}`,
            }}
          >
            {tab.icon}
            <span className="hidden sm:inline">{tab.labelAr} / {tab.label}</span>
          </button>
        ))}
      </div>

      {/* ---- Content ---- */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === "progress" && (
          <ScrollArea className="h-full p-4">
            <div className="space-y-5">
              {/* Progress Timeline */}
              <div className="relative pl-4">
                {/* Vertical line */}
                <div
                  className="absolute right-[11px] top-2 bottom-2 w-0.5"
                  style={{ background: "rgba(255,255,255,0.06)" }}
                >
                  <div
                    className="w-full transition-all duration-500"
                    style={{
                      background: "linear-gradient(180deg, rgba(0,180,255,0.4), rgba(100,50,255,0.2))",
                      height: `${(currentStepIdx / (STEPS.length - 1)) * 100}%`,
                    }}
                  />
                </div>

                <div className="space-y-4">
                  {STEPS.map((step, idx) => {
                    const isActive = idx <= currentStepIdx;
                    const isCurrent = idx === currentStepIdx;
                    return (
                      <div key={step.key} className="flex items-start gap-3 relative z-10">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isCurrent ? "animate-spin" : ""}`}
                          style={{
                            background: isActive
                              ? isCurrent
                                ? "linear-gradient(135deg, rgba(0,180,255,0.35), rgba(100,50,255,0.2))"
                                : "rgba(0,180,255,0.2)"
                              : "rgba(255,255,255,0.05)",
                            border: `2px solid ${isCurrent ? "rgba(0,180,255,0.5)" : isActive ? "rgba(0,180,255,0.15)" : "rgba(255,255,255,0.06)"}`,
                            animationDuration: isCurrent ? "3s" : "0s",
                          }}
                        >
                          {isActive ? (
                            <CheckCircle className="w-3 h-3" style={{ color: isCurrent ? "#67e8f9" : "#22d3ee" }} />
                          ) : (
                            <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-sm font-medium"
                              style={{ color: isActive ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.3)" }}
                            >
                              {step.labelAr} / {step.label}
                            </span>
                            {isCurrent && (
                              <Badge className="h-4 text-[9px] animate-pulse" style={{ background: "rgba(0,180,255,0.1)", color: "#67e8f9", borderColor: "rgba(0,180,255,0.15)" }}>
                                جاري / In Progress
                              </Badge>
                            )}
                          </div>
                          {isCurrent && (
                            <p className="text-white/30 text-[10px] mt-0.5">
                              {idx === 0 && "فحص المشكلة وتحديد العطل"}
                              {idx === 1 && "انتظار وصول القطع الغيار"}
                              {idx === 2 && "العمل على إصلاح السيارة"}
                              {idx === 3 && "اختبار شامل لجميع الأنظمة"}
                              {idx === 4 && "سيارتك جاهزة للاستلام!"}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Cost Tracking */}
              <div
                className="p-3.5 rounded-xl space-y-3"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
              >
                <h3 className="text-white/70 text-xs font-semibold flex items-center gap-1.5">
                  <DollarSign className="w-3.5 h-3.5 text-cyan-400" />
                  تتبع التكلفة / Cost Tracking
                </h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-white/50 text-xs">المقدر / Estimated</span>
                    <span className="text-white/70 text-sm font-medium">{estimatedCost} SAR</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-white/50 text-xs">الفعلي / Actual</span>
                    <span className="text-sm font-medium" style={{ color: costDifference > 0 ? "#f87171" : "#4ade80" }}>
                      {actualCost} SAR
                    </span>
                  </div>
                  {costDifference > 0 && (
                    <div
                      className="flex items-center gap-2 p-2 rounded-lg"
                      style={{ background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.1)" }}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                      <span className="text-red-400/80 text-[10px]">
                        زيادة بقيمة / Over by {costDifference} ر.س — in progress
                      </span>
                    </div>
                  )}

                  {/* Progress bar */}
                  <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(100, (actualCost / estimatedCost) * 100)}%`,
                        background: costDifference > 0
                          ? "linear-gradient(90deg, rgba(248,113,113,0.5), rgba(245,158,11,0.4))"
                          : "linear-gradient(90deg, rgba(74,222,128,0.5), rgba(0,180,255,0.3))",
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Approve Additional Work */}
              {costDifference > 0 && (
                <Button
                  onClick={() => setShowApproveModal(true)}
                  className="w-full h-9 text-xs rounded-lg font-medium transition-all hover:scale-[1.01]"
                  style={{
                    background: "linear-gradient(135deg, rgba(245,158,11,0.15), rgba(245,158,11,0.08))",
                    color: "#fbbf24",
                    border: "1px solid rgba(245,158,11,0.2)",
                  }}
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                  الموافقة على عمل إضافي / Approve Additional Work
                </Button>
              )}
            </div>
          </ScrollArea>
        )}

        {activeTab === "photos" && (
          <ScrollArea className="h-full p-4">
            <div className="grid grid-cols-2 gap-2">
              {DEMO_PHOTOS.map((photo) => (
                <div
                  key={photo.id}
                  className="rounded-xl overflow-hidden group"
                  style={{
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  {/* Photo placeholder */}
                  <div
                    className="aspect-[4/3] flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.05), rgba(100,50,255,0.03))" }}
                  >
                    <Camera className="w-8 h-8 text-white/15 group-hover:text-white/25 transition-colors" />
                  </div>
                  <div className="p-2">
                    <p className="text-white/60 text-[10px]">{photo.labelAr}</p>
                    <p className="text-white/30 text-[9px]">{photo.label}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {activeTab === "chat" && (
          <div className="h-full flex flex-col">
            <ScrollArea className="flex-1 p-4 min-h-0">
              <div className="space-y-3">
                {chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.sender === "customer" ? "justify-start" : "justify-end"}`}
                  >
                    <div
                      className="max-w-[85%] p-3 rounded-2xl"
                      style={{
                        background: msg.sender === "customer"
                          ? "rgba(0,180,255,0.08)"
                          : "rgba(100,50,255,0.06)",
                        border: `1px solid ${msg.sender === "customer" ? "rgba(0,180,255,0.1)" : "rgba(150,100,255,0.1)"}`,
                        borderRadius: msg.sender === "customer" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                      }}
                    >
                      <p className="text-white/80 text-xs leading-relaxed">{msg.textAr}</p>
                      <p className="text-white/40 text-[10px] mt-1 leading-relaxed">{msg.text}</p>
                      <p className="text-white/25 text-[9px] mt-1.5 text-left">{msg.timestamp}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>

            {/* Chat Input */}
            <div
              className="shrink-0 p-3 border-t flex gap-2"
              style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)" }}
            >
              <Textarea
                placeholder="اكتب رسالة... / Type a message..."
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                className="min-h-[36px] max-h-[80px] text-xs bg-white/5 border-white/10 text-white placeholder:text-white/25 resize-none flex-1"
              />
              <button
                onClick={sendMessage}
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 self-end transition-all hover:scale-105"
                style={{ background: "rgba(0,180,255,0.15)", border: "1px solid rgba(0,180,255,0.2)" }}
              >
                <MessageSquare className="w-4 h-4 text-cyan-400" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ---- Approve Modal Overlay ---- */}
      {showApproveModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
          <div
            className="w-full max-w-sm rounded-2xl p-5 space-y-4"
            style={{
              background: "rgba(0, 0, 20, 0.95)",
              border: "1px solid rgba(245, 158, 11, 0.2)",
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              <h3 className="text-amber-400 text-sm font-semibold">تأكيد / Confirm</h3>
            </div>
            <p className="text-white/60 text-xs leading-relaxed">
              هل تؤكد الموافقة على العمل الإضافي بقيمة {costDifference} ريال؟<br />
              Do you approve the additional work costing {costDifference} SAR?
            </p>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowApproveModal(false)}
                variant="outline"
                className="flex-1 h-8 text-xs rounded-lg border-white/10 text-white/60 hover:text-white hover:bg-white/5"
              >
                إلغاء / Cancel
              </Button>
              <Button
                onClick={() => setShowApproveModal(false)}
                className="flex-1 h-8 text-xs rounded-lg font-medium"
                style={{ background: "rgba(245,158,11,0.2)", color: "#fbbf24", border: "1px solid rgba(245,158,11,0.25)" }}
              >
                موافق / Approve
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
