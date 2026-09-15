import { useState, useMemo } from "react";
import { Search, ShoppingCart, Trash2, X, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import ProductCard from "@/components/ProductCard";
import { useCart } from "@/hooks/useCart";
import { mockProducts, categoryColors } from "@/data/mockCommerce";

const categories = [
  { key: "all", label: "الكل" },
  { key: "Food", label: "مأكولات" },
  { key: "Clothing", label: "ملابس" },
  { key: "Electronics", label: "إلكترونيات" },
  { key: "Pharmacy", label: "صيدلية" },
  { key: "Grocery", label: "بقالة" },
  { key: "Beauty", label: "جمال" },
  { key: "Home", label: "منزل" },
];

export default function Products() {
  const cart = useCart();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 500]);
  const [showCart, setShowCart] = useState(false);
  const [showPriceFilter, setShowPriceFilter] = useState(false);

  // Find min/max from mock data for slider
  const { minPrice, maxPrice } = useMemo(() => {
    const prices = mockProducts.map((p) => p.price);
    return { minPrice: Math.floor(Math.min(...prices)), maxPrice: Math.ceil(Math.max(...prices)) };
  }, []);

  const filtered = useMemo(() => {
    return mockProducts.filter((p) => {
      // Category filter
      if (activeCategory !== "all" && p.category !== activeCategory) return false;
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !p.name.toLowerCase().includes(q) &&
          !p.merchantName?.toLowerCase().includes(q) &&
          !p.category?.toLowerCase().includes(q)
        )
          return false;
      }
      // Price filter
      if (p.price < priceRange[0] || p.price > priceRange[1]) return false;
      return true;
    });
  }, [search, activeCategory, priceRange]);

  return (
    <div className="w-full h-full overflow-y-auto p-4 pb-20 relative" style={{ direction: "rtl" }}>
      {/* Header */}
      <div className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-[var(--text)] mb-1">
              المنتجات
            </h1>
            <p className="text-sm text-[var(--text2)]">
              تصفح واطلب من آلاف المنتجات الحلال
            </p>
          </div>

          {/* Cart floating button */}
          <button
            onClick={() => setShowCart(true)}
            className={cn(
              "relative w-12 h-12 rounded-2xl flex items-center justify-center",
              "bg-gradient-to-br from-[var(--cyan)]/20 to-[var(--purple)]/20",
              "border border-[var(--cyan)]/30 text-[var(--cyan)]",
              "hover:from-[var(--cyan)]/30 hover:to-[var(--purple)]/30",
              "transition-all duration-200 shadow-lg shadow-[var(--cyan)]/5"
            )}
          >
            <ShoppingCart className="w-5 h-5" />
            {cart.totalItems > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-[var(--orange)] text-white text-[10px] font-bold flex items-center justify-center">
                {cart.totalItems}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text2)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ابحث عن منتج أو متجر..."
          className={cn(
            "w-full h-11 pl-10 pr-4 rounded-xl",
            "bg-white/5 border border-white/10",
            "text-[var(--text)] text-sm placeholder:text-[var(--text2)]/50",
            "focus:outline-none focus:border-[var(--cyan)]/40 focus:bg-white/[0.07]",
            "transition-all duration-200"
          )}
        />
      </div>

      {/* Price range toggle */}
      <div className="mb-3">
        <button
          onClick={() => setShowPriceFilter(!showPriceFilter)}
          className={cn(
            "flex items-center gap-1.5 text-xs text-[var(--text2)] hover:text-[var(--text)]",
            "transition-colors duration-200"
          )}
        >
          {showPriceFilter ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          فلتر السعر
        </button>
        {showPriceFilter && (
          <div className="mt-2 p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3">
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text2)] block mb-1">الحد الأدنى: {priceRange[0]}</label>
              <input
                type="range"
                min={minPrice}
                max={maxPrice}
                value={priceRange[0]}
                onChange={(e) => setPriceRange([Number(e.target.value), priceRange[1]])}
                className="w-full accent-[var(--cyan)]"
              />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-[var(--text2)] block mb-1">الحد الأقصى: {priceRange[1]}</label>
              <input
                type="range"
                min={minPrice}
                max={maxPrice}
                value={priceRange[1]}
                onChange={(e) => setPriceRange([priceRange[0], Number(e.target.value)])}
                className="w-full accent-[var(--cyan)]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-2 mb-4 scrollbar-hide">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => setActiveCategory(cat.key)}
            className={cn(
              "flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium",
              "border transition-all duration-200 whitespace-nowrap",
              activeCategory === cat.key
                ? "bg-[var(--cyan)]/20 border-[var(--cyan)]/40 text-[var(--cyan)]"
                : "bg-white/5 border-white/10 text-[var(--text2)] hover:bg-white/[0.08] hover:text-[var(--text)]"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Results count */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-[var(--text2)]">
          {filtered.length} منتج
        </span>
        {cart.totalItems > 0 && (
          <span className="text-[10px] text-[var(--gold)] bg-[var(--gold)]/10 px-2 py-0.5 rounded-lg border border-[var(--gold)]/20">
            {cart.totalItems} في السلة
          </span>
        )}
      </div>

      {/* Products grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              cartItem={cart.cartItems.find((c) => c.productId === product.id)}
              onAddToCart={cart.addToCart}
              onRemoveFromCart={cart.removeFromCart}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-[var(--text2)]" />
          </div>
          <p className="text-[var(--text2)] text-sm mb-1">لا توجد منتجات مطابقة</p>
          <p className="text-[var(--text2)]/60 text-xs">جرب تغيير الفلاتر أو البحث</p>
        </div>
      )}

      {/* Cart overlay panel */}
      {showCart && (
        <div className="fixed inset-0 z-50 flex justify-end" style={{ direction: "rtl" }}>
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setShowCart(false)}
          />
          {/* Panel */}
          <div
            className={cn(
              "relative w-full max-w-sm h-full overflow-y-auto",
              "bg-[#0a0a0f] border-r border-white/10",
              "p-5 flex flex-col"
            )}
          >
            {/* Panel header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold text-[var(--text)] flex items-center gap-2">
                <ShoppingCart className="w-5 h-5 text-[var(--cyan)]" />
                سلة المشتريات
              </h2>
              <button
                onClick={() => setShowCart(false)}
                className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[var(--text2)] hover:text-[var(--text)] hover:bg-white/10 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {cart.cartItems.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <ShoppingCart className="w-12 h-12 text-[var(--text2)]/30 mb-3" />
                <p className="text-[var(--text2)] text-sm">السلة فارغة</p>
                <p className="text-[var(--text2)]/60 text-xs mt-1">أضف منتجات لتظهر هنا</p>
              </div>
            ) : (
              <>
                <div className="flex-1 space-y-3">
                  {cart.cartItems.map((item) => (
                    <div
                      key={item.productId}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10"
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--cyan)]/20 to-[var(--purple)]/20 flex items-center justify-center flex-shrink-0 text-lg">
                        {item.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">{item.name}</p>
                        <p className="text-xs text-[var(--gold)]">
                          {item.price.toFixed(2)} {item.currency}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => cart.removeFromCart(item.productId)}
                          className="w-6 h-6 rounded-md bg-red-500/15 text-red-400 flex items-center justify-center hover:bg-red-500/25 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <span className="text-sm font-bold text-[var(--text)] w-4 text-center">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() =>
                            cart.addToCart({
                              id: item.productId,
                              name: item.name,
                              price: item.price,
                              currency: item.currency,
                              stock: 99,
                              isHalal: true,
                            } as import("@/types/commerce").Product)
                          }
                          className="w-6 h-6 rounded-md bg-[var(--cyan)]/15 text-[var(--cyan)] flex items-center justify-center hover:bg-[var(--cyan)]/25 transition-all"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Cart footer */}
                <div className="mt-5 pt-4 border-t border-white/10">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-[var(--text2)]">المجموع</span>
                    <span className="text-xl font-bold text-[var(--gold)]">
                      {cart.totalAmount.toFixed(2)} KWD
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        cart.clearCart();
                        setShowCart(false);
                      }}
                      className={cn(
                        "flex-1 py-2.5 rounded-xl text-sm font-medium",
                        "bg-red-500/10 text-red-400 border border-red-500/20",
                        "hover:bg-red-500/20 transition-all"
                      )}
                    >
                      <Trash2 className="w-4 h-4 inline ml-1.5" />
                      إفراغ
                    </button>
                    <button
                      className={cn(
                        "flex-[2] py-2.5 rounded-xl text-sm font-bold",
                        "bg-gradient-to-r from-[var(--cyan)] to-[var(--purple)]",
                        "text-white shadow-lg shadow-[var(--cyan)]/20",
                        "hover:shadow-[var(--cyan)]/30 transition-all active:scale-[0.98]"
                      )}
                    >
                      إتمام الطلب
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
