import { Package, CreditCard, Truck, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Order } from "@/types/commerce";
import { orderStatusConfig, paymentStatusConfig } from "@/data/mockCommerce";

interface OrderCardProps {
  order: Order;
  merchantName?: string;
}

export default function OrderCard({ order, merchantName }: OrderCardProps) {
  const statusCfg = orderStatusConfig[order.status] ?? orderStatusConfig.pending;
  const payCfg = paymentStatusConfig[order.paymentStatus] ?? paymentStatusConfig.pending;

  const formattedDate = new Date(order.createdAt).toLocaleDateString("ar-KW", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const etaText = order.deliveryEta
    ? new Date(order.deliveryEta).toLocaleDateString("ar-KW", {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "غير محدد";

  // Timeline steps
  const steps = ["pending", "confirmed", "processing", "shipped", "delivered"];
  const currentStep = steps.indexOf(order.status);

  return (
    <div
      className={cn(
        "group relative rounded-2xl border backdrop-blur-xl p-5",
        "bg-gradient-to-br from-white/[0.08] to-white/[0.02]",
        "border-white/10 hover:border-[var(--cyan)]/20",
        "transition-all duration-300 ease-[var(--smooth)]",
        "hover:shadow-[0_0_20px_rgba(0,212,255,0.05)]"
      )}
    >
      {/* Order header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", statusCfg.bg)}>
            <Package className={cn("w-5 h-5", statusCfg.color)} />
          </div>
          <div>
            <h3 className="font-bold text-[var(--text)] text-sm">طلب #{order.id}</h3>
            {merchantName && (
              <p className="text-[11px] text-[var(--text2)]">{merchantName}</p>
            )}
          </div>
        </div>
        <span className={cn("px-3 py-1 rounded-lg text-xs font-medium border flex items-center gap-1.5", statusCfg.bg, statusCfg.color)}>
          <span className={cn("w-1.5 h-1.5 rounded-full", statusCfg.dot)} />
          {statusCfg.label}
        </span>
      </div>

      {/* Progress Timeline */}
      {order.status !== "cancelled" && order.status !== "returned" && (
        <div className="mb-4 px-1">
          <div className="flex items-center gap-0">
            {steps.map((step, idx) => (
              <div key={step} className="flex-1 flex items-center">
                <div className="flex flex-col items-center gap-1 w-full">
                  <div
                    className={cn(
                      "w-2.5 h-2.5 rounded-full border-2 transition-all",
                      idx <= currentStep
                        ? "bg-[var(--cyan)] border-[var(--cyan)]"
                        : "bg-transparent border-white/20"
                    )}
                  />
                </div>
                {idx < steps.length - 1 && (
                  <div className={cn(
                    "h-0.5 flex-1 mx-0.5 rounded-full",
                    idx < currentStep ? "bg-[var(--cyan)]/60" : "bg-white/10"
                  )} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Order details grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-center gap-2 text-xs">
          <CreditCard className="w-3.5 h-3.5 text-[var(--text2)] flex-shrink-0" />
          <div>
            <p className="text-[10px] text-[var(--text2)]">طريقة الدفع</p>
            <p className="text-[var(--text)]">{order.paymentMethod ?? "غير محدد"}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Package className="w-3.5 h-3.5 text-[var(--text2)] flex-shrink-0" />
          <div>
            <p className="text-[10px] text-[var(--text2)]">المنتجات</p>
            <p className="text-[var(--text)]">{order.productIds.length} منتج</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Calendar className="w-3.5 h-3.5 text-[var(--text2)] flex-shrink-0" />
          <div>
            <p className="text-[10px] text-[var(--text2)]">التاريخ</p>
            <p className="text-[var(--text)]">{formattedDate}</p>
          </div>
        </div>
        {order.trackingNumber && (
          <div className="flex items-center gap-2 text-xs">
            <Truck className="w-3.5 h-3.5 text-[var(--text2)] flex-shrink-0" />
            <div>
              <p className="text-[10px] text-[var(--text2)]">رقم التتبع</p>
              <p className="text-[var(--cyan)] text-[10px] truncate">{order.trackingNumber}</p>
            </div>
          </div>
        )}
      </div>

      {/* Payment status + Delivery ETA */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text2)]">الدفع:</span>
          <span className={cn("text-xs font-medium", payCfg.color)}>{payCfg.label}</span>
        </div>
        {order.deliveryEta && (
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3 text-[var(--text2)]" />
            <span className="text-[10px] text-[var(--text2)]">وصول متوقع: {etaText}</span>
          </div>
        )}
      </div>

      {/* Total */}
      <div className="mt-3 flex items-center justify-between pt-3 border-t border-white/5">
        <span className="text-xs text-[var(--text2)]">المجموع</span>
        <span className="text-lg font-bold text-[var(--gold)]">{order.totalAmount.toFixed(2)} KWD</span>
      </div>
    </div>
  );
}
