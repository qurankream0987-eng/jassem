import { useState, useCallback, useMemo } from "react";
import type { CartItem, Product } from "@/types/commerce";

const CART_STORAGE_KEY = "jasim_cart";

function loadCart(): CartItem[] {
  try {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return [];
}

function saveCart(items: CartItem[]) {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

export function useCart() {
  const [cartItems, setCartItems] = useState<CartItem[]>(loadCart);

  const addToCart = useCallback((product: Product) => {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === product.id);
      let next: CartItem[];
      if (existing) {
        next = prev.map((i) =>
          i.productId === product.id
            ? { ...i, quantity: i.quantity + 1 }
            : i
        );
      } else {
        next = [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            price: product.price,
            currency: product.currency,
            quantity: 1,
            imageUrl: product.imageUrl ?? undefined,
          },
        ];
      }
      saveCart(next);
      return next;
    });
  }, []);

  const removeFromCart = useCallback((productId: number) => {
    setCartItems((prev) => {
      const existing = prev.find((i) => i.productId === productId);
      let next: CartItem[];
      if (existing && existing.quantity > 1) {
        next = prev.map((i) =>
          i.productId === productId
            ? { ...i, quantity: i.quantity - 1 }
            : i
        );
      } else {
        next = prev.filter((i) => i.productId !== productId);
      }
      saveCart(next);
      return next;
    });
  }, []);

  const removeItemCompletely = useCallback((productId: number) => {
    setCartItems((prev) => {
      const next = prev.filter((i) => i.productId !== productId);
      saveCart(next);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setCartItems([]);
    saveCart([]);
  }, []);

  const totalItems = useMemo(
    () => cartItems.reduce((sum, i) => sum + i.quantity, 0),
    [cartItems]
  );

  const totalAmount = useMemo(
    () => cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0),
    [cartItems]
  );

  return {
    cartItems,
    addToCart,
    removeFromCart,
    removeItemCompletely,
    clearCart,
    totalItems,
    totalAmount,
  };
}
