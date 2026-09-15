import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  ShoppingCart,
  Home,
  Package,
  CreditCard,
  Plus,
  Minus,
  Trash2,
  Check,
  ArrowRight,
  Star,
  Heart,
} from "lucide-react";
import type { WizardData } from "./SaasWizard";
import { templates } from "./TemplateSelector";

interface PlatformPreviewProps {
  data: WizardData;
}

type PreviewPage = "home" | "products" | "cart" | "checkout";

export default function PlatformPreview({ data }: PlatformPreviewProps) {
  const [page, setPage] = useState<PreviewPage>("home");
  const [cart, setCart] = useState<{ name: string; price: number; qty: number }[]>([]);

  const template = templates.find((t) => t.id === data.templateId);
  const primaryColor = data.platformColor || "#00d4ff";

  const addToCart = (name: string, price: number) => {
    setCart((prev) => {
      const existing = prev.find((i) => i.name === name);
      if (existing) {
        return prev.map((i) =>
          i.name === name ? { ...i, qty: i.qty + 1 } : i
        );
      }
      return [...prev, { name, price, qty: 1 }];
    });
  };

  const updateQty = (name: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => (i.name === name ? { ...i, qty: i.qty + delta } : i))
        .filter((i) => i.qty > 0)
    );
  };

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const deliveryFee = parseFloat(data.deliveryFee || "0");

  const navItems: { id: PreviewPage; icon: React.ReactNode; label: string }[] = [
    { id: "home", icon: <Home className="w-4 h-4" />, label: "الرئيسية" },
    { id: "products", icon: <Package className="w-4 h-4" />, label: "المنتجات" },
    { id: "cart", icon: <ShoppingCart className="w-4 h-4" />, label: "السلة" },
    { id: "checkout", icon: <CreditCard className="w-4 h-4" />, label: "الدفع" },
  ];

  return (
    <div className="w-full h-full flex flex-col rounded-2xl overflow-hidden border border-white/10 bg-black/40">
      {/* Fake phone status bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/60 border-b border-white/5">
        <span className="text-[10px] text-[var(--text2)]">9:41</span>
        <div className="flex gap-1">
          <div className="w-3 h-3 rounded-full bg-white/20" />
          <div className="w-3 h-3 rounded-full bg-white/20" />
        </div>
      </div>

      {/* App header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ backgroundColor: `${primaryColor}15` }}
      >
        <div className="flex items-center gap-2">
          {template?.icon && (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: `${primaryColor}25`, color: primaryColor }}
            >
              {template.icon}
            </div>
          )}
          <span className="text-xs font-bold" style={{ color: primaryColor }}>
            {data.platformName || template?.title || "منصتي"}
          </span>
        </div>
        <button
          onClick={() => setPage("cart")}
          className="relative w-7 h-7 rounded-lg bg-white/5 flex items-center justify-center"
        >
          <ShoppingCart className="w-3.5 h-3.5 text-[var(--text2)]" />
          {cart.length > 0 && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center"
              style={{ backgroundColor: primaryColor, color: "#000" }}
            >
              {cart.reduce((s, i) => s + i.qty, 0)}
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3" style={{ direction: "rtl" }}>
        {/* Home page */}
        {page === "home" && (
          <div className="space-y-3 animate-in fade-in duration-200">
            {/* Hero banner */}
            <div
              className="rounded-xl p-4 text-center relative overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${primaryColor}20, ${primaryColor}08)`,
                border: `1px solid ${primaryColor}20`,
              }}
            >
              <h2 className="text-sm font-bold text-[var(--text)] mb-1">
                مرحباً بك في {data.platformName || "منصتك"}
              </h2>
              <p className="text-[10px] text-[var(--text2)]">
                اطلب الآن واستمتع بأفضل الخدمات
              </p>
            </div>

            {/* Quick categories */}
            <div className="flex gap-2 overflow-x-auto pb-1">
              {["الكل", "مميز", "جديد", "الأكثر مبيعاً"].map((cat, i) => (
                <button
                  key={cat}
                  className={cn(
                    "flex-shrink-0 px-3 py-1 rounded-lg text-[10px] font-medium border transition-colors",
                    i === 0
                      ? "border-white/20 bg-white/10 text-[var(--text)]"
                      : "border-white/5 bg-white/[0.02] text-[var(--text2)]"
                  )}
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Featured items */}
            <div className="grid grid-cols-2 gap-2">
              {data.products
                .filter((p) => p.name.trim())
                .slice(0, 4)
                .map((product, idx) => (
                  <div
                    key={idx}
                    className="rounded-xl bg-white/[0.03] border border-white/[0.08] p-2.5 space-y-2"
                  >
                    <div className="w-full h-16 rounded-lg bg-white/5 flex items-center justify-center">
                      <Package
                        className="w-6 h-6"
                        style={{ color: `${primaryColor}60` }}
                      />
                    </div>
                    <h4 className="text-[10px] font-medium text-[var(--text)] truncate">
                      {product.name}
                    </h4>
                    <div className="flex items-center justify-between">
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: primaryColor }}
                      >
                        {product.price} {data.currency}
                      </span>
                      <button
                        onClick={() =>
                          addToCart(product.name, parseFloat(product.price) || 0)
                        }
                        className="w-5 h-5 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: `${primaryColor}25` }}
                      >
                        <Plus className="w-3 h-3" style={{ color: primaryColor }} />
                      </button>
                    </div>
                  </div>
                ))}
              {data.products.filter((p) => p.name.trim()).length === 0 && (
                <div className="col-span-2 py-8 text-center">
                  <Package className="w-8 h-8 text-[var(--text2)]/30 mx-auto mb-2" />
                  <p className="text-[10px] text-[var(--text2)]">
                    أضف منتجات في المعالج
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Products page */}
        {page === "products" && (
          <div className="space-y-2 animate-in fade-in duration-200">
            <h3 className="text-xs font-bold text-[var(--text)] mb-2">المنتجات</h3>
            {data.products
              .filter((p) => p.name.trim())
              .map((product, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]"
                >
                  <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                    <Package
                      className="w-5 h-5"
                      style={{ color: `${primaryColor}50` }}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-[11px] font-medium text-[var(--text)]">
                      {product.name}
                    </h4>
                    <p className="text-[9px] text-[var(--text2)]">
                      {product.category || "عام"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[11px] font-bold"
                      style={{ color: primaryColor }}
                    >
                      {product.price} {data.currency}
                    </span>
                    <button
                      onClick={() =>
                        addToCart(product.name, parseFloat(product.price) || 0)
                      }
                      className="w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: `${primaryColor}20` }}
                    >
                      <Plus className="w-3.5 h-3.5" style={{ color: primaryColor }} />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}

        {/* Cart page */}
        {page === "cart" && (
          <div className="space-y-3 animate-in fade-in duration-200">
            <h3 className="text-xs font-bold text-[var(--text)] mb-2">
              سلة التسوق
            </h3>
            {cart.length === 0 ? (
              <div className="py-8 text-center">
                <ShoppingCart className="w-8 h-8 text-[var(--text2)]/30 mx-auto mb-2" />
                <p className="text-[10px] text-[var(--text2)]">
                  السلة فارغة
                </p>
              </div>
            ) : (
              <>
                {cart.map((item) => (
                  <div
                    key={item.name}
                    className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]"
                  >
                    <div className="flex-1 min-w-0">
                      <h4 className="text-[11px] font-medium text-[var(--text)] truncate">
                        {item.name}
                      </h4>
                      <span
                        className="text-[10px]"
                        style={{ color: primaryColor }}
                      >
                        {item.price} {data.currency}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => updateQty(item.name, -1)}
                        className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center"
                      >
                        {item.qty === 1 ? (
                          <Trash2 className="w-3 h-3 text-red-400" />
                        ) : (
                          <Minus className="w-3 h-3 text-[var(--text2)]" />
                        )}
                      </button>
                      <span className="w-6 text-center text-[11px] font-medium text-[var(--text)]">
                        {item.qty}
                      </span>
                      <button
                        onClick={() => updateQty(item.name, 1)}
                        className="w-6 h-6 rounded-md flex items-center justify-center"
                        style={{ backgroundColor: `${primaryColor}20` }}
                      >
                        <Plus className="w-3 h-3" style={{ color: primaryColor }} />
                      </button>
                    </div>
                  </div>
                ))}
                <div className="pt-3 border-t border-white/10 space-y-1">
                  <div className="flex justify-between text-[10px] text-[var(--text2)]">
                    <span>المجموع</span>
                    <span>
                      {cartTotal.toFixed(2)} {data.currency}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--text2)]">
                    <span>التوصيل</span>
                    <span>
                      {deliveryFee} {data.currency}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs font-bold text-[var(--text)] pt-1">
                    <span>الإجمالي</span>
                    <span style={{ color: primaryColor }}>
                      {(cartTotal + deliveryFee).toFixed(2)} {data.currency}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Checkout page */}
        {page === "checkout" && (
          <div className="space-y-3 animate-in fade-in duration-200">
            <h3 className="text-xs font-bold text-[var(--text)] mb-2">
              إتمام الطلب
            </h3>

            {/* Order summary */}
            <div className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.08] space-y-2">
              <h4 className="text-[10px] font-medium text-[var(--text2)]">
                ملخص الطلب
              </h4>
              {cart.map((item) => (
                <div
                  key={item.name}
                  className="flex justify-between text-[10px]"
                >
                  <span className="text-[var(--text)]">
                    {item.name} x{item.qty}
                  </span>
                  <span className="text-[var(--text2)]">
                    {(item.price * item.qty).toFixed(2)} {data.currency}
                  </span>
                </div>
              ))}
              <div className="pt-2 border-t border-white/10 flex justify-between text-xs font-bold">
                <span className="text-[var(--text)]">الإجمالي</span>
                <span style={{ color: primaryColor }}>
                  {(cartTotal + deliveryFee).toFixed(2)} {data.currency}
                </span>
              </div>
            </div>

            {/* Payment methods */}
            <div className="space-y-1.5">
              <h4 className="text-[10px] font-medium text-[var(--text2)]">
                طريقة الدفع
              </h4>
              {data.paymentMethods.map((method) => (
                <div
                  key={method}
                  className="flex items-center gap-2 p-2.5 rounded-xl bg-white/[0.03] border border-white/[0.08]"
                >
                  <Check
                    className="w-3.5 h-3.5"
                    style={{ color: primaryColor }}
                  />
                  <span className="text-[10px] text-[var(--text)]">
                    {method === "cod" && "الدفع عند الاستلام"}
                    {method === "card" && "بطاقة ائتمان"}
                    {method === "wallet" && "محفظة إلكترونية"}
                    {method === "bank" && "تحويل بنكي"}
                  </span>
                </div>
              ))}
            </div>

            {/* Confirm button */}
            <button
              className="w-full py-2.5 rounded-xl text-xs font-bold text-black transition-opacity hover:opacity-90"
              style={{ backgroundColor: primaryColor }}
            >
              تأكيد الطلب
            </button>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="flex items-center justify-around py-2 bg-black/60 border-t border-white/5">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setPage(item.id)}
            className={cn(
              "flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors",
              page === item.id ? "text-white" : "text-[var(--text2)]/50"
            )}
          >
            <div
              className={cn(
                "transition-colors",
                page === item.id ? "text-[var(--cyan)]" : "text-[var(--text2)]/50"
              )}
            >
              {item.icon}
            </div>
            <span className="text-[8px]">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
