/**
 * Shared styles, color palettes, and visual constants for the JASIM bubble system.
 * All bubbles are generic — colors map to bubble *schema type*, not domain.
 */

import type { BubbleType } from "@contracts/jasim";

// ═══════════════════════════════════════════════════════════════════════════════
// Color Palettes — each bubble type gets a distinct neon gradient + glow
// ═══════════════════════════════════════════════════════════════════════════════

export interface BubbleColors {
  /** Primary background gradient start (hex) */
  bgStart: string;
  /** Primary background gradient end (hex) */
  bgEnd: string;
  /** Glow / neon accent color */
  glow: string;
  /** Primary text color */
  text: string;
  /** Secondary / muted text color */
  textMuted: string;
  /** Border / ring color */
  border: string;
}

const palettes: Record<string, BubbleColors> = {
  // ── Interactive / input ──
  form: {
    bgStart: "#1e3a5f",
    bgEnd: "#0f172a",
    glow: "#3b82f6",
    text: "#f8fafc",
    textMuted: "#94a3b8",
    border: "rgba(59,130,246,0.4)",
  },
  list: {
    bgStart: "#1e293b",
    bgEnd: "#0f172a",
    glow: "#64748b",
    text: "#f8fafc",
    textMuted: "#94a3b8",
    border: "rgba(100,116,139,0.4)",
  },
  card: {
    bgStart: "#312e81",
    bgEnd: "#1e1b4b",
    glow: "#818cf8",
    text: "#f8fafc",
    textMuted: "#a5b4fc",
    border: "rgba(129,140,248,0.4)",
  },

  // ── Data display ──
  comparison: {
    bgStart: "#4c1d95",
    bgEnd: "#2e1065",
    glow: "#a855f7",
    text: "#f8fafc",
    textMuted: "#c4b5fd",
    border: "rgba(168,85,247,0.4)",
  },
  gallery: {
    bgStart: "#701a75",
    bgEnd: "#4a044e",
    glow: "#e879f9",
    text: "#f8fafc",
    textMuted: "#f0abfc",
    border: "rgba(232,121,249,0.4)",
  },
  map: {
    bgStart: "#14532d",
    bgEnd: "#052e16",
    glow: "#22c55e",
    text: "#f8fafc",
    textMuted: "#86efac",
    border: "rgba(34,197,94,0.4)",
  },

  // ── Communication ──
  chat: {
    bgStart: "#0369a1",
    bgEnd: "#082f49",
    glow: "#38bdf8",
    text: "#f8fafc",
    textMuted: "#7dd3fc",
    border: "rgba(56,189,248,0.4)",
  },

  // ── Dashboard / progress ──
  dashboard: {
    bgStart: "#0c4a6e",
    bgEnd: "#082f49",
    glow: "#0ea5e9",
    text: "#f8fafc",
    textMuted: "#7dd3fc",
    border: "rgba(14,165,233,0.4)",
  },
  timeline: {
    bgStart: "#1e293b",
    bgEnd: "#0f172a",
    glow: "#38bdf8",
    text: "#f8fafc",
    textMuted: "#94a3b8",
    border: "rgba(56,189,248,0.3)",
  },
  progress: {
    bgStart: "#1e40af",
    bgEnd: "#172554",
    glow: "#60a5fa",
    text: "#f8fafc",
    textMuted: "#93c5fd",
    border: "rgba(96,165,250,0.4)",
  },

  // ── Action / decision ──
  confirmation: {
    bgStart: "#7c2d12",
    bgEnd: "#431407",
    glow: "#fb923c",
    text: "#f8fafc",
    textMuted: "#fdba74",
    border: "rgba(251,146,60,0.4)",
  },
  notification: {
    bgStart: "#164e63",
    bgEnd: "#083344",
    glow: "#22d3ee",
    text: "#f8fafc",
    textMuted: "#67e8f9",
    border: "rgba(34,211,238,0.4)",
  },

  // ── Table / search / filter ──
  table: {
    bgStart: "#1e1b4b",
    bgEnd: "#0f172a",
    glow: "#6366f1",
    text: "#f8fafc",
    textMuted: "#a5b4fc",
    border: "rgba(99,102,241,0.4)",
  },
  search: {
    bgStart: "#0f766e",
    bgEnd: "#042f2e",
    glow: "#2dd4bf",
    text: "#f8fafc",
    textMuted: "#5eead4",
    border: "rgba(45,212,191,0.4)",
  },
  filter: {
    bgStart: "#3f6212",
    bgEnd: "#1a2e05",
    glow: "#a3e635",
    text: "#f8fafc",
    textMuted: "#bef264",
    border: "rgba(163,230,53,0.4)",
  },

  // ── Wizard ──
  wizard: {
    bgStart: "#581c87",
    bgEnd: "#3b0764",
    glow: "#c084fc",
    text: "#f8fafc",
    textMuted: "#d8b4fe",
    border: "rgba(192,132,252,0.4)",
  },
};

/** Fallback palette for unknown types */
const fallback: BubbleColors = {
  bgStart: "#1e293b",
  bgEnd: "#0f172a",
  glow: "#64748b",
  text: "#f8fafc",
  textMuted: "#94a3b8",
  border: "rgba(100,116,139,0.4)",
};

export function getBubbleColors(type: BubbleType): BubbleColors {
  return palettes[type] ?? fallback;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Icon Mapping — generic icons per bubble type (displayed in bubble center)
// ═══════════════════════════════════════════════════════════════════════════════

const iconMap: Record<string, string> = {
  form: "📝",
  list: "📋",
  card: "🃏",
  comparison: "⚖️",
  gallery: "🖼️",
  map: "🗺️",
  chat: "💬",
  dashboard: "📊",
  timeline: "⏱️",
  progress: "📈",
  confirmation: "✅",
  notification: "🔔",
  table: "📑",
  search: "🔍",
  filter: "🔧",
  wizard: "🧙",
};

export function getBubbleIcon(type: BubbleType): string {
  return iconMap[type] ?? "✨";
}

// ═══════════════════════════════════════════════════════════════════════════════
// Size Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const BUBBLE_MIN_RADIUS = 36;
export const BUBBLE_MAX_RADIUS = 72;
export const BUBBLE_BASE_RADIUS = 48;

/** Compute bubble radius from importance (0-1) */
export function getBubbleRadius(importance: number): number {
  const clamped = Math.max(0, Math.min(1, importance));
  return BUBBLE_MIN_RADIUS + clamped * (BUBBLE_MAX_RADIUS - BUBBLE_MIN_RADIUS);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Physics Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const PHYSICS = {
  /** Gravitational acceleration (upward drift — bubbles float) */
  gravity: -0.008,
  /** Friction / damping factor per frame */
  friction: 0.985,
  /** Spring stiffness for soft collisions */
  springK: 0.015,
  /** Mouse repulsion radius */
  mouseRepelRadius: 140,
  /** Mouse repulsion force */
  mouseRepelForce: 0.35,
  /** Base floating amplitude (px) */
  floatAmplitude: 0.4,
  /** Floating frequency (radians per ms) */
  floatFrequency: 0.0012,
  /** Max velocity cap */
  maxVelocity: 3.5,
  /** Edge bounce dampening */
  bounceDamp: 0.7,
  /** Velocity threshold to stop micro-jitter */
  sleepThreshold: 0.01,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// Visual Effect Constants
// ═══════════════════════════════════════════════════════════════════════════════

export const VISUALS = {
  /** Glow blur radius on canvas */
  glowBlur: 24,
  /** Pulse speed (radians per ms) */
  pulseSpeed: 0.002,
  /** Pulse scale range */
  pulseRange: 0.06,
  /** Connection line max distance */
  connectionDistance: 220,
  /** Connection line base opacity */
  connectionOpacity: 0.18,
  /** Min opacity for inactive bubbles */
  minOpacity: 0.65,
  /** Max opacity for active bubbles */
  maxOpacity: 1,
  /** Glass fill alpha */
  glassAlpha: 0.15,
  /** Border width */
  borderWidth: 1.5,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// CSS Helpers for DOM bubbles
// ═══════════════════════════════════════════════════════════════════════════════

export function getBubbleCSSVars(colors: BubbleColors): React.CSSProperties {
  return {
    "--bubble-bg-start": colors.bgStart,
    "--bubble-bg-end": colors.bgEnd,
    "bubble-glow": colors.glow,
    "--bubble-text": colors.text,
    "--bubble-text-muted": colors.textMuted,
    "--bubble-border": colors.border,
  } as React.CSSProperties;
}
