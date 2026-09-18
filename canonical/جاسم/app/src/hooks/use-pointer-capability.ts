import { useEffect, useState } from "react";

/**
 * Whether this device is driven by a coarse pointer with no hover — a finger.
 *
 * ─── WHY NOT THE VIEWPORT HOOK ──────────────────────────────────────────────
 *
 * `use-mobile.ts` answers "is the window narrow", which is a layout question.
 * This answers "is there a keyboard to press Shift on", which is a capability
 * question, and the two disagree in both directions: a desktop browser dragged
 * narrow still has a keyboard, and a 1024px tablet still does not.
 *
 * Showing «Shift + Enter لسطر جديد» to somebody holding a phone is not a
 * cosmetic error — it is an instruction they cannot follow, printed under the
 * one control they need.
 *
 * ─── THE DEFAULT IS THE SAFE ONE ────────────────────────────────────────────
 *
 * `false` until measured, so the first paint on a device without `matchMedia`
 * — or during SSR — shows the keyboard hint rather than hiding a real
 * affordance from somebody who has one.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    // Both halves matter. `pointer: coarse` alone is true for a touchscreen
    // laptop, which does have a keyboard; adding `hover: none` narrows it to
    // devices where touch is the only input.
    const query = window.matchMedia("(hover: none) and (pointer: coarse)");
    const apply = () => setCoarse(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return coarse;
}
