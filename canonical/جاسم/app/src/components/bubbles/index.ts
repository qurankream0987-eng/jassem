/**
 * JASIM Bubble System — Public API
 * All bubble-related components, hooks, styles, and types.
 */

// ── Core Components ───────────────────────────────────────────────────────────
export { BubbleCanvas } from "./BubbleCanvas";
export type { BubbleCanvasProps } from "./BubbleCanvas";

export { Bubble } from "./Bubble";
export type { BubbleProps } from "./Bubble";

export { BubbleDock } from "./BubbleDock";
export type { BubbleDockProps, MinimizedBubble } from "./BubbleDock";

export { BubbleWindow } from "./BubbleWindow";
export type { BubbleWindowProps } from "./BubbleWindow";

// ── Physics Hook ──────────────────────────────────────────────────────────────
export { useBubblePhysics } from "./useBubblePhysics";
export type {
  BubblePhysics,
  PhysicsConfig,
  PhysicsOutput,
} from "./useBubblePhysics";

// ── Styles & Visual Utilities ─────────────────────────────────────────────────
export {
  getBubbleColors,
  getBubbleIcon,
  getBubbleRadius,
  getBubbleCSSVars,
  BUBBLE_MIN_RADIUS,
  BUBBLE_MAX_RADIUS,
  BUBBLE_BASE_RADIUS,
  PHYSICS,
  VISUALS,
} from "./bubble-styles";
export type { BubbleColors } from "./bubble-styles";
