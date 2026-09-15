import { ShoppingCart, Minus, Plus, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Product, CartItem } from "@/types/commerce";
import { categoryColors } from "@/data/mockCommerce";

interface ProductCardProps {
  product: Product;
  cartItem?: CartItem;
  onAddToCart: (product: Product) => void;
  onRemoveFromCart: (productId: number) => void;
}

export default function ProductCard({
  product,
  cartItem,
  onAddToCart,
  onRemoveFromCart,
}: ProductCardProps) {
  const catColor = categoryColors[product.category ?? "Food"] ?? categoryColors.Food;

  const getStockColor = () => {
    if (product.stock === 0) return "bg-red-500/15 text-red-300 border-red-500/30";
    if (product.stock < 10) return "bg-orange-500/15 text-orange-300 border-orange-500/30";
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  };

  const getStockLabel = () => {
    if (product.stock === 0) return "غير متوفر";
    if (product.stock < 10) return `متبقي: ${product.stock}`;
    return "متوفر";
  };

  const outOfStock = product.stock === 0;

  // Generate a deterministic color for the placeholder based on product name
  const placeholderHue = product.name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className={cn(
        "group relative rounded-2xl border backdrop-blur-xl overflow-hidden",
        "bg-gradient-to-br from-white/[0.08] to-white/[0.02]",
        "border-white/10 hover:border-[var(--cyan)]/30",
        "transition-all duration-300 ease-[var(--smooth)]",
        "hover:shadow-[0_0_30px_rgba(0,212,255,0.08)]",
        "hover:-translate-y-1",
        outOfStock && "opacity-60"
      )}
    >
      {/* Product image placeholder */}
      <div
        className="relative h-32 w-full flex items-center justify-center overflow-hidden"
        style={{ background: `linear-gradient(135deg, hsla(${placeholderHue}, 60%, 20%, 0.5), hsla(${placeholderHue}, 60%, 10%, 0.3))` }}
      >
        <PackageOpen className="w-10 h-10 text-white/20" />
        {product.isHalal && (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-medium border bg-emerald-500/20 text-emerald-300 border-emerald-500/30">
            حلال
          </span>
        )}
        <div className={cn("absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-medium border", catColor)}>
          {product.category}
        </div>
      </div>

      <div className="p-4">
        {/* Product name & merchant */}
        <h3 className="font-bold text-[var(--text)] text-sm mb-1 leading-tight truncate">
          {product.name}
        </h3>
        {product.merchantName && (
          <p className="text-[11px] text-[var(--text2)] mb-2 truncate">
            {product.merchantName}
          </p>
        )}

        {/* Price & Stock */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[var(--gold)] font-bold text-sm">
            {product.price.toFixed(2)} <span className="text-[10px] text-[var(--text2)]">{product.currency}</span>
          </span>
          <span className={cn("px-2 py-0.5 rounded-lg text-[10px] font-medium border", getStockColor())}>
            {getStockLabel()}
          </span>
        </div>

        {/* Cart controls */}
        {cartItem ? (
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={() => onRemoveFromCart(product.id)}
              className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center",
                "bg-red-500/15 border border-red-500/30 text-red-400",
                "hover:bg-red-500/25 transition-all duration-200 active:scale-90"
              )}
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm font-bold text-[var(--text)] min-w-[24px] text-center">
              {cartItem.quantity}
            </span>
            <button
              onClick={() => onAddToCart(product)}
              disabled={outOfStock}
              className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center",
                "bg-[var(--cyan)]/20 border border-[var(--cyan)]/30 text-[var(--cyan)]",
                "hover:bg-[var(--cyan)]/30 transition-all duration-200 active:scale-90",
                outOfStock && "opacity-40 cursor-not-allowed"
              )}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => onAddToCart(product)}
            disabled={outOfStock}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-2 rounded-xl",
              "bg-gradient-to-r from-[var(--cyan)]/20 to-[var(--purple)]/20",
              "border border-[var(--cyan)]/20 text-[var(--cyan)] text-sm font-medium",
              "hover:from-[var(--cyan)]/30 hover:to-[var(--purple)]/30",
              "hover:border-[var(--cyan)]/40 transition-all duration-200",
              "active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed"
            )}
          >
            <ShoppingCart className="w-4 h-4" />
            أضف للسلة
          </button>
        )}
      </div>
    </div>
  );
}
