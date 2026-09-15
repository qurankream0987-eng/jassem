import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Mail,
  Phone,
  UserPlus,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Trash2,
  Store,
  Send,
  User,
} from "lucide-react";

type VendorStatus = "pending" | "approved" | "rejected";

interface Vendor {
  id: number;
  name: string;
  email: string;
  phone: string;
  businessName: string;
  status: VendorStatus;
  date: string;
}

const statusConfig: Record<
  VendorStatus,
  { label: string; color: string; icon: React.ReactNode }
> = {
  pending: {
    label: "قيد المراجعة",
    color: "#f59e0b",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  approved: {
    label: "معتمد",
    color: "#10b981",
    icon: <CheckCircle2 className="w-3.5 h-3.5" />,
  },
  rejected: {
    label: "مرفوض",
    color: "#ef4444",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
};

const mockVendors: Vendor[] = [
  {
    id: 1,
    name: "أحمد محمد",
    email: "ahmed@example.com",
    phone: "+966501234567",
    businessName: "متجر الأحمدية",
    status: "approved",
    date: "2026-06-20",
  },
  {
    id: 2,
    name: "سارة عبدالله",
    email: "sara@example.com",
    phone: "+966507654321",
    businessName: "صالون سارة",
    status: "pending",
    date: "2026-06-25",
  },
  {
    id: 3,
    name: "خالد العلي",
    email: "khaled@example.com",
    phone: "+966509876543",
    businessName: "ورشة الخليج",
    status: "approved",
    date: "2026-06-18",
  },
  {
    id: 4,
    name: "نورة الفهد",
    email: "noura@example.com",
    phone: "+966501112223",
    businessName: "مطعم النور",
    status: "pending",
    date: "2026-06-26",
  },
  {
    id: 5,
    name: "فهد السالم",
    email: "fahd@example.com",
    phone: "+966504445556",
    businessName: "صيدلية السالم",
    status: "rejected",
    date: "2026-06-15",
  },
];

export default function VendorManager() {
  const [vendors, setVendors] = useState<Vendor[]>(mockVendors);
  const [inviteMethod, setInviteMethod] = useState<"email" | "phone">("email");
  const [inviteValue, setInviteValue] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<VendorStatus | "all">("all");

  const handleInvite = () => {
    if (!inviteValue.trim()) return;
    const newVendor: Vendor = {
      id: vendors.length + 1,
      name: "",
      email: inviteMethod === "email" ? inviteValue : "",
      phone: inviteMethod === "phone" ? inviteValue : "",
      businessName: "",
      status: "pending",
      date: new Date().toISOString().split("T")[0],
    };
    setVendors((prev) => [newVendor, ...prev]);
    setInviteValue("");
  };

  const updateStatus = (id: number, status: VendorStatus) => {
    setVendors((prev) =>
      prev.map((v) => (v.id === id ? { ...v, status } : v))
    );
  };

  const removeVendor = (id: number) => {
    setVendors((prev) => prev.filter((v) => v.id !== id));
  };

  const filtered = vendors.filter((v) => {
    if (filter !== "all" && v.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        v.name.toLowerCase().includes(q) ||
        v.businessName.toLowerCase().includes(q) ||
        v.email.toLowerCase().includes(q) ||
        v.phone.includes(q)
      );
    }
    return true;
  });

  const counts = {
    all: vendors.length,
    pending: vendors.filter((v) => v.status === "pending").length,
    approved: vendors.filter((v) => v.status === "approved").length,
    rejected: vendors.filter((v) => v.status === "rejected").length,
  };

  return (
    <div className="w-full space-y-4" style={{ direction: "rtl" }}>
      {/* Invite section */}
      <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.08]">
        <h4 className="text-xs font-bold text-[var(--text)] mb-3 flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-[var(--cyan)]" />
          دعوة تاجر جديد
        </h4>

        {/* Method toggle */}
        <div className="flex gap-1 mb-3 p-1 rounded-lg bg-white/[0.03] border border-white/[0.06]">
          <button
            onClick={() => setInviteMethod("email")}
            className={cn(
              "flex items-center justify-center gap-1 flex-1 py-1.5 rounded-md text-[10px] font-medium transition-all",
              inviteMethod === "email"
                ? "bg-[var(--cyan)]/15 text-[var(--cyan)]"
                : "text-[var(--text2)] hover:text-[var(--text)]"
            )}
          >
            <Mail className="w-3 h-3" />
            بريد إلكتروني
          </button>
          <button
            onClick={() => setInviteMethod("phone")}
            className={cn(
              "flex items-center justify-center gap-1 flex-1 py-1.5 rounded-md text-[10px] font-medium transition-all",
              inviteMethod === "phone"
                ? "bg-[var(--cyan)]/15 text-[var(--cyan)]"
                : "text-[var(--text2)] hover:text-[var(--text)]"
            )}
          >
            <Phone className="w-3 h-3" />
            جوال
          </button>
        </div>

        {/* Input */}
        <div className="flex gap-2">
          <input
            type={inviteMethod === "email" ? "email" : "tel"}
            value={inviteValue}
            onChange={(e) => setInviteValue(e.target.value)}
            placeholder={
              inviteMethod === "email"
                ? "البريد الإلكتروني للتاجر"
                : "رقم الجوال"
            }
            className={cn(
              "flex-1 h-10 px-4 rounded-xl",
              "bg-white/5 border border-white/10",
              "text-[var(--text)] text-xs placeholder:text-[var(--text2)]/40",
              "focus:outline-none focus:border-[var(--cyan)]/40"
            )}
          />
          <button
            onClick={handleInvite}
            disabled={!inviteValue.trim()}
            className={cn(
              "px-4 h-10 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all",
              inviteValue.trim()
                ? "bg-[var(--cyan)] text-black hover:bg-[var(--cyan)]/90"
                : "bg-white/10 text-[var(--text2)] cursor-not-allowed"
            )}
          >
            <Send className="w-3.5 h-3.5" />
            دعوة
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2">
        {( ["all", "pending", "approved", "rejected"] as const ).map((key) => {
          const cfg =
            key === "all"
              ? { label: "الكل", color: "#00d4ff" }
              : statusConfig[key];
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "p-2.5 rounded-xl border text-center transition-all",
                filter === key
                  ? "border-white/20 bg-white/[0.06]"
                  : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"
              )}
            >
              <p className="text-lg font-extrabold" style={{ color: cfg.color }}>
                {counts[key]}
              </p>
              <p className="text-[9px] text-[var(--text2)] mt-0.5">{cfg.label}</p>
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text2)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن تاجر..."
          className={cn(
            "w-full h-10 pl-10 pr-4 rounded-xl",
            "bg-white/5 border border-white/10",
            "text-[var(--text)] text-xs placeholder:text-[var(--text2)]/40",
            "focus:outline-none focus:border-[var(--cyan)]/40"
          )}
        />
      </div>

      {/* Vendor list */}
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {filtered.map((vendor) => {
          const cfg = statusConfig[vendor.status];
          return (
            <div
              key={vendor.id}
              className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08]"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${cfg.color}15`, color: cfg.color }}
                  >
                    {vendor.name ? (
                      <User className="w-4 h-4" />
                    ) : (
                      <Store className="w-4 h-4" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-xs font-medium text-[var(--text)] truncate">
                      {vendor.name || vendor.email || vendor.phone}
                    </h4>
                    {vendor.businessName && (
                      <p className="text-[10px] text-[var(--text2)]">
                        {vendor.businessName}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[9px] text-[var(--text2)]">
                        {vendor.email || vendor.phone}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1.5">
                  <div
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full border"
                    style={{
                      backgroundColor: `${cfg.color}10`,
                      borderColor: `${cfg.color}25`,
                      color: cfg.color,
                    }}
                  >
                    {cfg.icon}
                    <span className="text-[9px] font-medium">{cfg.label}</span>
                  </div>
                  <span className="text-[9px] text-[var(--text2)]">
                    {vendor.date}
                  </span>
                </div>
              </div>

              {/* Actions */}
              {vendor.status === "pending" && (
                <div className="flex gap-2 mt-2.5 pt-2 border-t border-white/[0.06]">
                  <button
                    onClick={() => updateStatus(vendor.id, "approved")}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    اعتماد
                  </button>
                  <button
                    onClick={() => updateStatus(vendor.id, "rejected")}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                  >
                    <XCircle className="w-3 h-3" />
                    رفض
                  </button>
                </div>
              )}

              {vendor.status !== "pending" && (
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => removeVendor(vendor.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] text-red-400 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="w-3 h-3" />
                    حذف
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="py-8 text-center">
            <Store className="w-8 h-8 text-[var(--text2)]/30 mx-auto mb-2" />
            <p className="text-xs text-[var(--text2)]">لا يوجد تجار مطابقين</p>
          </div>
        )}
      </div>
    </div>
  );
}
