import { useState, useCallback, useMemo } from "react";
import {
  X,
  UtensilsCrossed,
  Clock,
  Star,
  ShoppingCart,
  Plus,
  Minus,
  Flame,
  Leaf,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */
export interface MenuItem {
  id: string;
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
  price: number;
  currency: string;
  category: string;
  categoryAr: string;
  image?: string;
  isSpicy?: boolean;
  isVegan?: boolean;
  isPopular?: boolean;
}

export interface CartItem extends MenuItem {
  quantity: number;
}

export interface MenuWindowProps {
  restaurantId: string;
  restaurantName?: string;
  restaurantNameAr?: string;
  cuisine?: string;
  cuisineAr?: string;
  rating?: number;
  deliveryTime?: string;
  deliveryTimeAr?: string;
  menuItems?: MenuItem[];
  onClose: () => void;
  onOrder?: (cart: CartItem[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Default Demo Data                                                  */
/* ------------------------------------------------------------------ */
const DEFAULT_MENU: MenuItem[] = [
  {
    id: "m1", name: "Margherita Pizza", nameAr: "بيتزا مارغريتا",
    description: "Fresh mozzarella, tomato sauce, and basil", descriptionAr: "موزاريلا طازجة، صلصة طماطم، وريحان",
    price: 48, currency: "SAR", category: "Main Dishes", categoryAr: "الأطباق الرئيسية",
    isPopular: true,
  },
  {
    id: "m2", name: "Spicy Chicken Pasta", nameAr: "معكرونة دجاج حار",
    description: "Creamy pasta with grilled chicken and chili", descriptionAr: "معكرونة كريمية مع دجاج مشوي وفلفل حار",
    price: 55, currency: "SAR", category: "Main Dishes", categoryAr: "الأطباق الرئيسية",
    isSpicy: true, isPopular: true,
  },
  {
    id: "m3", name: "Vegan Buddha Bowl", nameAr: "بوذا بويل نباتي",
    description: "Quinoa, avocado, chickpeas, and tahini dressing", descriptionAr: "كينوا، أفوكادو، حمص، وصلصة طحينة",
    price: 42, currency: "SAR", category: "Healthy", categoryAr: "صحي",
    isVegan: true,
  },
  {
    id: "m4", name: "Caesar Salad", nameAr: "سلطة سيزر",
    description: "Romaine lettuce, croutons, parmesan, caesar dressing", descriptionAr: "خس رومين، كروتون، بارميزان، صلصة سيزر",
    price: 32, currency: "SAR", category: "Starters", categoryAr: "مقبلات",
  },
  {
    id: "m5", name: "Grilled Salmon", nameAr: "سلمون مشوي",
    description: "Atlantic salmon with lemon butter sauce", descriptionAr: "سلمون أطلسي مع صلصة الليمون والزبدة",
    price: 78, currency: "SAR", category: "Main Dishes", categoryAr: "الأطباق الرئيسية",
    isPopular: true,
  },
  {
    id: "m6", name: "Chocolate Lava Cake", nameAr: "كيكة الشوكولاتة البركانية",
    description: "Warm chocolate cake with molten center", descriptionAr: "كيكة شوكولاتة دافئة مع مركز سائل",
    price: 28, currency: "SAR", category: "Desserts", categoryAr: "حلويات",
  },
  {
    id: "m7", name: "Fresh Orange Juice", nameAr: "عصير برتقال طازج",
    description: "Freshly squeezed oranges", descriptionAr: "برتقال معصور طازج",
    price: 16, currency: "SAR", category: "Drinks", categoryAr: "مشروبات",
  },
  {
    id: "m8", name: "Hot Wings", nameAr: "أجنحة حارة",
    description: "Crispy chicken wings with buffalo sauce", descriptionAr: "أجنحة دجاج مقرمشة مع صلصة بافلو",
    price: 36, currency: "SAR", category: "Starters", categoryAr: "مقبلات",
    isSpicy: true, isPopular: true,
  },
];

const GLASS_BG = "bg-gray-950/80";
const GLASS_BORDER = "border-white/10";

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */
export default function MenuWindow({
  restaurantId,
  restaurantName = "Bella Vista",
  restaurantNameAr = "بيلا فيستا",
  cuisine = "Italian & Mediterranean",
  cuisineAr = "إيطالي ومتوسطي",
  rating = 4.7,
  deliveryTime = "25-35 min",
  deliveryTimeAr = "٢٥-٣٥ دقيقة",
  menuItems = DEFAULT_MENU,
  onClose,
  onOrder,
}: MenuWindowProps) {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);

  /* ---- derive categories ---- */
  const categories = useMemo(() => {
    const map = new Map<string, { label: string; labelAr: string }>();
    menuItems.forEach((item) => {
      if (!map.has(item.category)) {
        map.set(item.category, { label: item.category, labelAr: item.categoryAr });
      }
    });
    return [{ key: "all", label: "All / الكل" }, ...Array.from(map.entries()).map(([k, v]) => ({ key: k, label: `${v.labelAr} / ${v.label}` }))];
  }, [menuItems]);

  /* ---- filter items ---- */
  const filteredItems = useMemo(() => {
    if (activeCategory === "all") return menuItems;
    return menuItems.filter((item) => item.category === activeCategory);
  }, [activeCategory, menuItems]);

  /* ---- cart helpers ---- */
  const addToCart = useCallback((item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) => (c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c));
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((itemId: string) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === itemId);
      if (existing && existing.quantity > 1) {
        return prev.map((c) => (c.id === itemId ? { ...c, quantity: c.quantity - 1 } : c));
      }
      return prev.filter((c) => c.id !== itemId);
    });
  }, []);

  const clearCart = useCallback(() => setCart([]), []);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );

  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  /* ---- place order ---- */
  const handleOrder = useCallback(() => {
    onOrder?.(cart);
  }, [cart, onOrder]);

  return (
    <div
      className={`relative flex flex-col w-full max-w-2xl max-h-[85vh] ${GLASS_BG} backdrop-blur-xl rounded-2xl ${GLASS_BORDER} border shadow-2xl overflow-hidden`}
      style={{ background: "rgba(0, 0, 20, 0.82)", borderColor: "rgba(0, 212, 255, 0.15)" }}
      dir="rtl"
    >
      {/* ---- Header ---- */}
      <div className="flex items-start justify-between p-4 border-b shrink-0" style={{ borderColor: "rgba(0, 212, 255, 0.1)" }}>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.2), rgba(100,50,255,0.15))" }}
          >
            <UtensilsCrossed className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h2 className="text-white font-semibold text-base leading-tight">
              {restaurantNameAr} / {restaurantName}
            </h2>
            <p className="text-white/50 text-xs mt-0.5">{cuisineAr} / {cuisine}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Rating */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "rgba(245, 158, 11, 0.1)" }}>
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span className="text-amber-400 text-xs font-semibold">{rating}</span>
          </div>
          {/* Delivery time */}
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg" style={{ background: "rgba(0, 180, 255, 0.08)" }}>
            <Clock className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-cyan-400 text-xs">{deliveryTimeAr}</span>
          </div>
          {/* Close */}
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full flex items-center justify-center transition-all hover:scale-110"
            style={{ background: "rgba(255,80,80,0.15)", border: "1px solid rgba(255,80,80,0.2)" }}
          >
            <X className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      </div>

      {/* ---- Category Tabs ---- */}
      <div className="px-4 pt-3 pb-1 shrink-0">
        <ScrollArea className="w-full whitespace-nowrap" orientation="horizontal">
          <div className="flex gap-2 pb-2">
            {categories.map((cat) => (
              <button
                key={cat.key}
                onClick={() => setActiveCategory(cat.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all shrink-0"
                style={{
                  background: activeCategory === cat.key ? "rgba(0, 180, 255, 0.15)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${activeCategory === cat.key ? "rgba(0, 180, 255, 0.3)" : "rgba(255,255,255,0.06)"}`,
                  color: activeCategory === cat.key ? "#67e8f9" : "rgba(255,255,255,0.5)",
                }}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* ---- Menu Items ---- */}
      <ScrollArea className="flex-1 px-4 py-2 min-h-0">
        <div className="grid grid-cols-1 gap-2.5 pb-4">
          {filteredItems.map((item) => {
            const cartItem = cart.find((c) => c.id === item.id);
            return (
              <div
                key={item.id}
                className="group flex items-start gap-3 p-3 rounded-xl transition-all hover:brightness-125"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                {/* Image placeholder */}
                <div
                  className="w-16 h-16 rounded-lg shrink-0 flex items-center justify-center"
                  style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.08), rgba(100,50,255,0.06))" }}
                >
                  <UtensilsCrossed className="w-6 h-6 text-white/20" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <h3 className="text-white/90 text-sm font-medium">{item.nameAr} / {item.name}</h3>
                    {item.isPopular && (
                      <Badge className="text-[10px] px-1.5 py-0 h-4" style={{ background: "rgba(245,158,11,0.15)", color: "#fbbf24", borderColor: "rgba(245,158,11,0.2)" }}>
                        Popular
                      </Badge>
                    )}
                  </div>
                  <p className="text-white/40 text-xs mt-0.5 line-clamp-1">{item.descriptionAr} / {item.description}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    {item.isSpicy && (
                      <span className="flex items-center gap-0.5 text-[10px]" style={{ color: "#f87171" }}>
                        <Flame className="w-3 h-3" /> حار
                      </span>
                    )}
                    {item.isVegan && (
                      <span className="flex items-center gap-0.5 text-[10px]" style={{ color: "#4ade80" }}>
                        <Leaf className="w-3 h-3" /> نباتي
                      </span>
                    )}
                  </div>
                </div>

                {/* Price & Add */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <span className="text-cyan-400 text-sm font-bold">{item.price} {item.currency}</span>
                  {cartItem ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: "rgba(255,80,80,0.15)" }}
                      >
                        {cartItem.quantity === 1 ? <Trash2 className="w-3 h-3 text-red-400" /> : <Minus className="w-3 h-3 text-red-400" />}
                      </button>
                      <span className="text-white text-xs font-semibold w-4 text-center">{cartItem.quantity}</span>
                      <button
                        onClick={() => addToCart(item)}
                        className="w-6 h-6 rounded-full flex items-center justify-center transition-colors"
                        style={{ background: "rgba(0,180,255,0.15)" }}
                      >
                        <Plus className="w-3 h-3 text-cyan-400" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => addToCart(item)}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all hover:scale-105"
                      style={{ background: "rgba(0,180,255,0.12)", color: "#67e8f9", border: "1px solid rgba(0,180,255,0.2)" }}
                    >
                      <Plus className="w-3 h-3" /> إضافة
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* ---- Floating Cart Summary ---- */}
      {cartCount > 0 && (
        <div
          className="shrink-0 p-3 border-t"
          style={{
            background: "rgba(0, 180, 255, 0.05)",
            borderColor: "rgba(0, 212, 255, 0.1)",
          }}
        >
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setShowCart(!showCart)}
              className="flex items-center gap-2 text-white/70 text-xs hover:text-white transition-colors"
            >
              <ShoppingCart className="w-4 h-4 text-cyan-400" />
              <span>السلة / Cart ({cartCount})</span>
              <ChevronRight className={`w-3 h-3 transition-transform ${showCart ? "rotate-90" : ""}`} />
            </button>
            <span className="text-cyan-400 font-bold text-sm">{cartTotal.toFixed(2)} {cart[0]?.currency}</span>
          </div>

          {showCart && (
            <div className="space-y-1.5 mb-3 max-h-32 overflow-y-auto">
              {cart.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <span className="text-white/70">{item.nameAr}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white/50">x{item.quantity}</span>
                    <span className="text-cyan-400">{(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              onClick={clearCart}
              variant="outline"
              className="flex-1 h-8 text-xs rounded-lg border-white/10 text-white/60 hover:text-white hover:bg-white/5"
            >
              إفراغ / Clear
            </Button>
            <Button
              onClick={handleOrder}
              className="flex-1 h-8 text-xs rounded-lg font-medium"
              style={{ background: "linear-gradient(135deg, rgba(0,180,255,0.25), rgba(100,50,255,0.2))", color: "#67e8f9", border: "1px solid rgba(0,180,255,0.25)" }}
            >
              اطلب الآن / Order Now
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
