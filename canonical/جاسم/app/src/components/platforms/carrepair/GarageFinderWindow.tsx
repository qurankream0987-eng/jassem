import { useState, useMemo } from "react";
import {
  X,
  Search,
  MapPin,
  Star,
  Wrench,
  Car,
  Phone,
  Filter,
  ChevronDown,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface Garage {
  id: string;
  name: string;
  nameAr: string;
  rating: number;
  reviewCount: number;
  specialties: string[];
  specialtiesAr: string[];
  priceMin: number;
  priceMax: number;
  currency: string;
  distance: string;
  distanceKm: number;
  providesPickup: boolean;
  phone?: string;
  lat?: number;
  lng?: number;
}

export interface GarageFinderWindowProps {
  onClose: () => void;
  onSelectGarage?: (garage: Garage) => void;
}

/* ------------------------------------------------------------------ */
/*  Demo Data                                                          */
/* ------------------------------------------------------------------ */
const DEMO_GARAGES: Garage[] = [
  {
    id: "g1", name: "SpeedFix Auto", nameAr: "سبيدفيكس أوتو",
    rating: 4.8, reviewCount: 234,
    specialties: ["Engine", "Electrical"], specialtiesAr: ["محركات", "كهرباء"],
    priceMin: 150, priceMax: 800, currency: "SAR", distance: "2.3 km", distanceKm: 2.3,
    providesPickup: true, phone: "+966 50 123 4567", lat: 24.7, lng: 46.7,
  },
  {
    id: "g2", name: "Al-Riyadh Motors", nameAr: "الرياض موتورز",
    rating: 4.5, reviewCount: 189,
    specialties: ["Bodywork", "Paint"], specialtiesAr: ["سمكرة", "دهان"],
    priceMin: 200, priceMax: 1200, currency: "SAR", distance: "5.1 km", distanceKm: 5.1,
    providesPickup: false, phone: "+966 55 987 6543", lat: 24.68, lng: 46.72,
  },
  {
    id: "g3", name: "TurboCare Center", nameAr: "تيربو كير سنتر",
    rating: 4.9, reviewCount: 412,
    specialties: ["Transmission", "Brakes", "AC"], specialtiesAr: ["ناقل حركة", "فرامل", "تكييف"],
    priceMin: 100, priceMax: 600, currency: "SAR", distance: "1.8 km", distanceKm: 1.8,
    providesPickup: true, phone: "+966 54 456 7890", lat: 24.71, lng: 46.69,
  },
  {
    id: "g4", name: "Golden Wrench", nameAr: "ال扳手 الذهبي",
    rating: 4.2, reviewCount: 97,
    specialties: ["Tires", "Alignment"], specialtiesAr: ["إطارات", "توجيه"],
    priceMin: 50, priceMax: 400, currency: "SAR", distance: "3.5 km", distanceKm: 3.5,
    providesPickup: false, phone: "+966 56 321 6547", lat: 24.66, lng: 46.74,
  },
  {
    id: "g5", name: "Elite Auto Shop", nameAr: "إيليت أوتو شوب",
    rating: 4.7, reviewCount: 156,
    specialties: ["Engine", "Transmission", "Electrical"], specialtiesAr: ["محركات", "ناقل حركة", "كهرباء"],
    priceMin: 180, priceMax: 950, currency: "SAR", distance: "4.2 km", distanceKm: 4.2,
    providesPickup: true, phone: "+966 50 789 1234", lat: 24.65, lng: 46.68,
  },
];

const CAR_MAKES = [
  { value: "", label: "جميع الماركات / All Makes" },
  { value: "toyota", label: "Toyota / تويوتا" },
  { value: "honda", label: "Honda / هوندا" },
  { value: "hyundai", label: "Hyundai / هيونداي" },
  { value: "kia", label: "Kia / كيا" },
  { value: "nissan", label: "Nissan / نيسان" },
  { value: "ford", label: "Ford / فورد" },
  { value: "bmw", label: "BMW / بي إم دبليو" },
  { value: "mercedes", label: "Mercedes / مرسيدس" },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function GarageFinderWindow({
  onClose,
  onSelectGarage,
}: GarageFinderWindowProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMake, setSelectedMake] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [pickupOnly, setPickupOnly] = useState(false);
  const [minRating, setMinRating] = useState(0);
  const [maxPrice, setMaxPrice] = useState(2000);

  /* ---- filter garages ---- */
  const filtered = useMemo(() => {
    return DEMO_GARAGES.filter((g) => {
      if (pickupOnly && !g.providesPickup) return false;
      if (g.rating < minRating) return false;
      if (g.priceMin > maxPrice) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches =
          g.name.toLowerCase().includes(q) ||
          g.nameAr.includes(q) ||
          g.specialties.some((s) => s.toLowerCase().includes(q)) ||
          g.specialtiesAr.some((s) => s.includes(q));
        if (!matches) return false;
      }
      return true;
    }).sort((a, b) => {
      // sort by rating desc, then distance
      if (b.rating !== a.rating) return b.rating - a.rating;
      return a.distanceKm - b.distanceKm;
    });
  }, [searchQuery, pickupOnly, minRating, maxPrice]);

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
      className="relative flex flex-col w-full max-w-2xl max-h-[85vh] bg-gray-950/80 backdrop-blur-xl rounded-2xl border shadow-2xl overflow-hidden"
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
            <Search className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              البحث عن ورشة / Find Garage
            </h2>
            <p className="text-white/50 text-xs mt-0.5">قارن واختر الأفضل / Compare and choose</p>
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
        {/* ---- Search Bar ---- */}
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
              <Input
                placeholder="ابحث عن ورشة... / Search garages..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9 h-9 text-xs bg-white/5 border-white/10 text-white placeholder:text-white/30 rounded-lg"
              />
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="px-3 h-9 rounded-lg flex items-center gap-1.5 text-xs transition-all"
              style={{
                background: showFilters ? "rgba(0,180,255,0.15)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${showFilters ? "rgba(0,180,255,0.25)" : "rgba(255,255,255,0.08)"}`,
                color: showFilters ? "#67e8f9" : "rgba(255,255,255,0.5)",
              }}
            >
              <Filter className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">فلترة / Filter</span>
              <ChevronDown className={`w-3 h-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
            </button>
          </div>

          {/* ---- Filters ---- */}
          {showFilters && (
            <div
              className="p-3 rounded-xl space-y-3"
              style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {/* Car make */}
              <div>
                <label className="text-white/50 text-[10px] mb-1 block">ماركة السيارة / Car Make</label>
                <select
                  value={selectedMake}
                  onChange={(e) => setSelectedMake(e.target.value)}
                  className="w-full h-8 px-2 rounded-lg text-xs bg-white/5 border border-white/10 text-white/70 outline-none"
                >
                  {CAR_MAKES.map((make) => (
                    <option key={make.value} value={make.value} className="bg-gray-900">
                      {make.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3">
                {/* Pickup toggle */}
                <label className="flex items-center gap-2 cursor-pointer">
                  <div
                    className="w-8 h-4 rounded-full relative transition-colors"
                    style={{ background: pickupOnly ? "rgba(0,180,255,0.4)" : "rgba(255,255,255,0.1)" }}
                    onClick={() => setPickupOnly(!pickupOnly)}
                  >
                    <div
                      className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-all"
                      style={{ right: pickupOnly ? "18px" : "2px" }}
                    />
                  </div>
                  <span className="text-white/50 text-[10px]">استلام / Pickup</span>
                </label>

                {/* Min rating */}
                <div className="flex items-center gap-1.5">
                  <span className="text-white/50 text-[10px]">التقييم / Rating:</span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.5}
                    value={minRating}
                    onChange={(e) => setMinRating(parseFloat(e.target.value))}
                    className="w-16 accent-cyan-400"
                  />
                  <span className="text-cyan-400 text-[10px] w-6">{minRating}</span>
                </div>
              </div>
            </div>
          )}

          {/* ---- Map Placeholder ---- */}
          <div
            className="rounded-xl overflow-hidden relative h-28"
            style={{
              background: "rgba(10, 15, 30, 0.8)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              className="absolute inset-0 opacity-15"
              style={{
                backgroundImage: "linear-gradient(rgba(0,180,255,0.2) 1px, transparent 1px), linear-gradient(90deg, rgba(0,180,255,0.2) 1px, transparent 1px)",
                backgroundSize: "25px 25px",
              }}
            />
            {/* Pins */}
            {DEMO_GARAGES.map((g, i) => (
              <div
                key={g.id}
                className="absolute flex flex-col items-center group cursor-pointer"
                style={{
                  left: `${20 + i * 15}%`,
                  top: `${30 + (i % 2) * 30}%`,
                }}
                onClick={() => onSelectGarage?.(g)}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-transform group-hover:scale-110"
                  style={{
                    background: "rgba(0,180,255,0.2)",
                    border: "1px solid rgba(0,180,255,0.3)",
                  }}
                >
                  <Wrench className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <span className="text-[8px] text-white/40 mt-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {g.distance}
                </span>
              </div>
            ))}
            {/* User location */}
            <div className="absolute bottom-2 right-3">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-green-400/50" />
                <span className="text-[8px] text-white/30">أنت / You</span>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Garage List ---- */}
        <ScrollArea className="px-4 pb-4">
          <div className="space-y-2.5">
            {filtered.map((garage) => (
              <div
                key={garage.id}
                className="p-3.5 rounded-xl transition-all hover:brightness-110"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {/* Row 1: name + rating */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.1), rgba(100,50,255,0.08))" }}
                    >
                      <Car className="w-4 h-4 text-cyan-400" />
                    </div>
                    <div>
                      <h3 className="text-white/90 text-sm font-medium">{garage.nameAr} / {garage.name}</h3>
                      <div className="flex items-center gap-2 mt-0.5">
                        {renderStars(garage.rating)}
                        <span className="text-white/40 text-[10px]">({garage.reviewCount})</span>
                      </div>
                    </div>
                  </div>
                  {garage.providesPickup && (
                    <Badge className="text-[10px] h-5" style={{ background: "rgba(74,222,128,0.1)", color: "#4ade80", borderColor: "rgba(74,222,128,0.15)" }}>
                      استلام
                    </Badge>
                  )}
                </div>

                {/* Specialties */}
                <div className="flex flex-wrap gap-1 mb-2">
                  {garage.specialtiesAr.map((spec, i) => (
                    <span
                      key={i}
                      className="text-[10px] px-2 py-0.5 rounded-full"
                      style={{ background: "rgba(0,180,255,0.06)", color: "rgba(103,232,249,0.7)", border: "1px solid rgba(0,180,255,0.1)" }}
                    >
                      {spec}
                    </span>
                  ))}
                </div>

                {/* Row: distance + price + actions */}
                <div className="flex items-center justify-between pt-2" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-[10px] text-white/40">
                      <MapPin className="w-3 h-3" /> {garage.distance}
                    </span>
                    <span className="text-[10px] text-cyan-400/60">
                      {garage.priceMin}-{garage.priceMax} {garage.currency}
                    </span>
                  </div>
                  <div className="flex gap-1.5">
                    {garage.phone && (
                      <button
                        className="w-7 h-7 rounded-lg flex items-center justify-center"
                        style={{ background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.12)" }}
                        onClick={() => {}}
                      >
                        <Phone className="w-3.5 h-3.5 text-green-400" />
                      </button>
                    )}
                    <Button
                      onClick={() => onSelectGarage?.(garage)}
                      className="h-7 px-3 text-[10px] rounded-lg font-medium"
                      style={{ background: "rgba(0,180,255,0.12)", color: "#67e8f9", border: "1px solid rgba(0,180,255,0.2)" }}
                    >
                      <Wrench className="w-3 h-3 mr-1" />
                      طلب عرض / Quote
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
