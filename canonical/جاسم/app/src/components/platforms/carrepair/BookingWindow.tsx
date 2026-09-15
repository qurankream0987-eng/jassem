import { useState, useCallback } from "react";
import {
  X,
  Calendar,
  Clock,
  Car,
  ClipboardList,
  MapPin,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export type TimeSlot = "morning" | "afternoon" | "evening";

export interface BookingFormData {
  carMake: string;
  carModel: string;
  carYear: string;
  licensePlate: string;
  services: string[];
  description: string;
  date: string;
  timeSlot: TimeSlot;
  needsPickup: boolean;
  pickupAddress: string;
}

export interface BookingWindowProps {
  garageId?: string;
  garageName?: string;
  garageNameAr?: string;
  onClose: () => void;
  onSubmit?: (data: BookingFormData) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */
const SERVICES = [
  { id: "engine", labelAr: "محرك", label: "Engine" },
  { id: "transmission", labelAr: "ناقل حركة", label: "Transmission" },
  { id: "brakes", labelAr: "فرامل", label: "Brakes" },
  { id: "ac", labelAr: "تكييف", label: "AC" },
  { id: "electrical", labelAr: "كهرباء", label: "Electrical" },
  { id: "tires", labelAr: "إطارات", label: "Tires" },
  { id: "oil", labelAr: "تغيير زيت", label: "Oil Change" },
  { id: "diagnostics", labelAr: "فحص شامل", label: "Full Diagnostics" },
];

const TIME_SLOTS: { key: TimeSlot; labelAr: string; label: string; time: string }[] = [
  { key: "morning", labelAr: "صباحاً", label: "Morning", time: "8:00 - 12:00" },
  { key: "afternoon", labelAr: "ظهراً", label: "Afternoon", time: "12:00 - 16:00" },
  { key: "evening", labelAr: "مساءً", label: "Evening", time: "16:00 - 20:00" },
];

const CAR_MAKES = [
  { value: "", label: "اختر الماركة / Select Make" },
  { value: "toyota", label: "Toyota / تويوتا" },
  { value: "honda", label: "Honda / هوندا" },
  { value: "hyundai", label: "Hyundai / هيونداي" },
  { value: "kia", label: "Kia / كيا" },
  { value: "nissan", label: "Nissan / نيسان" },
  { value: "ford", label: "Ford / فورد" },
  { value: "bmw", label: "BMW / بي إم دبليو" },
  { value: "mercedes", label: "Mercedes / مرسيدس" },
  { value: "audi", label: "Audi / أودي" },
  { value: "lexus", label: "Lexus / لكزس" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function BookingWindow({
  garageName = "TurboCare Center",
  garageNameAr = "تيربو كير سنتر",
  onClose,
  onSubmit,
}: BookingWindowProps) {
  const [form, setForm] = useState<BookingFormData>({
    carMake: "",
    carModel: "",
    carYear: "",
    licensePlate: "",
    services: [],
    description: "",
    date: "",
    timeSlot: "morning",
    needsPickup: false,
    pickupAddress: "",
  });

  const toggleService = useCallback((serviceId: string) => {
    setForm((prev) => ({
      ...prev,
      services: prev.services.includes(serviceId)
        ? prev.services.filter((s) => s !== serviceId)
        : [...prev.services, serviceId],
    }));
  }, []);

  const updateField = useCallback(<K extends keyof BookingFormData>(key: K, value: BookingFormData[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit?.(form);
  }, [form, onSubmit]);

  const isValid = form.carMake && form.carModel && form.carYear && form.date && form.services.length > 0;

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
            <Calendar className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              حجز صيانة / Book Repair
            </h2>
            <p className="text-white/50 text-xs mt-0.5">{garageNameAr} / {garageName}</p>
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

      {/* ---- Form ---- */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
        {/* Car Info Section */}
        <div
          className="p-3 rounded-xl space-y-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <h3 className="text-white/70 text-xs font-semibold flex items-center gap-1.5 mb-1">
            <Car className="w-3.5 h-3.5 text-cyan-400" />
            معلومات السيارة / Car Info
          </h3>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-white/40 text-[10px] block mb-1">الماركة / Make</label>
              <div className="relative">
                <select
                  value={form.carMake}
                  onChange={(e) => updateField("carMake", e.target.value)}
                  className="w-full h-8 px-2 pr-7 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 outline-none appearance-none"
                >
                  {CAR_MAKES.map((m) => (
                    <option key={m.value} value={m.value} className="bg-gray-900">{m.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-white/30 pointer-events-none" />
              </div>
            </div>
            <div>
              <label className="text-white/40 text-[10px] block mb-1">الموديل / Model</label>
              <Input
                placeholder="مثلاً Camry"
                value={form.carModel}
                onChange={(e) => updateField("carModel", e.target.value)}
                className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/25"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-white/40 text-[10px] block mb-1">السنة / Year</label>
              <Input
                placeholder="2020"
                value={form.carYear}
                onChange={(e) => updateField("carYear", e.target.value)}
                className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/25"
              />
            </div>
            <div>
              <label className="text-white/40 text-[10px] block mb-1">اللوحة / Plate</label>
              <Input
                placeholder="أ ب ت 1234"
                value={form.licensePlate}
                onChange={(e) => updateField("licensePlate", e.target.value)}
                className="h-8 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/25"
              />
            </div>
          </div>
        </div>

        {/* Services Section */}
        <div
          className="p-3 rounded-xl space-y-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <h3 className="text-white/70 text-xs font-semibold flex items-center gap-1.5 mb-1">
            <ClipboardList className="w-3.5 h-3.5 text-cyan-400" />
            الخدمات المطلوبة / Services
          </h3>
          <div className="grid grid-cols-2 gap-1.5">
            {SERVICES.map((service) => {
              const isSelected = form.services.includes(service.id);
              return (
                <button
                  key={service.id}
                  onClick={() => toggleService(service.id)}
                  className="flex items-center gap-2 p-2 rounded-lg text-xs transition-all text-right"
                  style={{
                    background: isSelected ? "rgba(0,180,255,0.1)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isSelected ? "rgba(0,180,255,0.2)" : "rgba(255,255,255,0.05)"}`,
                    color: isSelected ? "#67e8f9" : "rgba(255,255,255,0.5)",
                  }}
                >
                  <div
                    className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                    style={{
                      borderColor: isSelected ? "rgba(0,180,255,0.4)" : "rgba(255,255,255,0.15)",
                      background: isSelected ? "rgba(0,180,255,0.2)" : "transparent",
                    }}
                  >
                    {isSelected && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1 4l2 2 4-4" stroke="#67e8f9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  {service.labelAr} / {service.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="text-white/40 text-[10px] block mb-1">وصف المشكلة / Problem Description</label>
          <Textarea
            placeholder="اشرح المشكلة التي تواجهك... / Describe the issue..."
            value={form.description}
            onChange={(e) => updateField("description", e.target.value)}
            className="min-h-[60px] text-xs bg-white/5 border-white/10 text-white placeholder:text-white/25 resize-none"
          />
        </div>

        {/* Date & Time */}
        <div
          className="p-3 rounded-xl space-y-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <h3 className="text-white/70 text-xs font-semibold flex items-center gap-1.5 mb-1">
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            الموعد / Appointment
          </h3>

          <div>
            <label className="text-white/40 text-[10px] block mb-1">التاريخ / Date</label>
            <Input
              type="date"
              value={form.date}
              onChange={(e) => updateField("date", e.target.value)}
              className="h-8 text-xs bg-white/5 border-white/10 text-white"
            />
          </div>

          <div>
            <label className="text-white/40 text-[10px] block mb-1">الفترة / Time Slot</label>
            <div className="grid grid-cols-3 gap-2">
              {TIME_SLOTS.map((slot) => (
                <button
                  key={slot.key}
                  onClick={() => updateField("timeSlot", slot.key)}
                  className="p-2 rounded-lg text-center transition-all"
                  style={{
                    background: form.timeSlot === slot.key ? "rgba(0,180,255,0.1)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${form.timeSlot === slot.key ? "rgba(0,180,255,0.2)" : "rgba(255,255,255,0.05)"}`,
                  }}
                >
                  <div className="text-[10px]" style={{ color: form.timeSlot === slot.key ? "#67e8f9" : "rgba(255,255,255,0.5)" }}>
                    {slot.labelAr}
                  </div>
                  <div className="text-[9px] text-white/30 mt-0.5">{slot.time}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Pickup Toggle */}
        <div
          className="p-3 rounded-xl space-y-3"
          style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <label className="flex items-center justify-between cursor-pointer">
            <div className="flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-white/70 text-xs">خدمة الاستلام / Pickup Service</span>
            </div>
            <div
              className="w-9 h-5 rounded-full relative transition-colors"
              style={{ background: form.needsPickup ? "rgba(0,180,255,0.4)" : "rgba(255,255,255,0.1)" }}
              onClick={() => updateField("needsPickup", !form.needsPickup)}
            >
              <div
                className="w-4 h-4 rounded-full bg-white absolute top-0.5 transition-all"
                style={{ right: form.needsPickup ? "18px" : "2px" }}
              />
            </div>
          </label>

          {form.needsPickup && (
            <div>
              <label className="text-white/40 text-[10px] block mb-1">عنوان الاستلام / Pickup Address</label>
              <Textarea
                placeholder="أدخل العنوان... / Enter address..."
                value={form.pickupAddress}
                onChange={(e) => updateField("pickupAddress", e.target.value)}
                className="min-h-[50px] text-xs bg-white/5 border-white/10 text-white placeholder:text-white/25 resize-none"
              />
            </div>
          )}
        </div>
      </div>

      {/* ---- Submit ---- */}
      <div className="shrink-0 p-4 border-t" style={{ borderColor: "rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }}>
        <Button
          onClick={handleSubmit}
          disabled={!isValid}
          className="w-full h-10 text-sm rounded-xl font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: isValid
              ? "linear-gradient(135deg, rgba(0,180,255,0.25), rgba(100,50,255,0.2))"
              : "rgba(255,255,255,0.05)",
            color: isValid ? "#67e8f9" : "rgba(255,255,255,0.3)",
            border: isValid ? "1px solid rgba(0,180,255,0.25)" : "1px solid rgba(255,255,255,0.08)",
          }}
        >
          إرسال الحجز / Submit Booking
        </Button>
      </div>
    </div>
  );
}
