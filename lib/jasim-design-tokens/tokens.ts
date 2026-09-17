/**
 * JASIM — semantic design tokens. ONE source for Web and Mobile.
 *
 * WHY A FILE AND NOT A PACKAGE. Web and Mobile need these values in different
 * forms — CSS custom properties on one side, a TypeScript object on the other —
 * and neither build system should have to grow a dependency to get them. So the
 * source lives here, each app keeps its own native form, and a test asserts the
 * two forms still agree. Drift is caught by a failing test rather than by
 * somebody noticing that the two apps have slowly stopped matching.
 *
 * SEMANTIC NAMES, NOT LITERAL ONES. `surface.glass` rather than `--cyan-05`.
 * A component that reaches for `palette.cyan` has encoded a decision about hue;
 * a component that reaches for `accent.primary` has encoded a decision about
 * meaning, and the hue can change without touching it.
 *
 * WHY SO LITTLE GLOW. The reference image is a marketing render: every surface
 * lit, every border luminous. In a product used for an hour, "everything
 * glows" reads as "nothing matters" — illumination stops being a signal. So
 * accent luminance is reserved for focus, selection, and JASIM's own presence,
 * and the default surface is quiet.
 */

// ── Primitive palette ───────────────────────────────────────────────────────
// The only place a literal colour appears. Nothing outside this object should
// contain a hex value.

export const palette = {
  black: "#000000",
  space0: "#010208",
  space1: "#030610",
  space2: "#070c1a",
  windowInner0: "#0a0e1a",
  windowInner1: "#070a14",
  windowInner2: "#050812",

  text: "#f0f4ff",
  /**
   * Secondary text. Raised from the previous #94a3b8 — that value cleared 4.5:1
   * against pure black but fell under it on a lit glass surface, which is where
   * secondary text actually lives. Contrast has to hold on the background the
   * text is really drawn on, not on the darkest one in the palette.
   */
  text2: "#b6c2da",
  /** Genuinely de-emphasised: timestamps and separators. Never body copy. */
  text3: "#8493ad",

  cyan: "#00d4ff",
  blue: "#4a9eff",
  purple: "#a855f7",
  pink: "#ec4899",
  gold: "#FFD700",
  orange: "#FF6B00",
  green: "#00c896",
  red: "#ff6b6b",
  amber: "#FFC107",
  slate: "#cbd5e1",
} as const;

// ── Semantic tokens ─────────────────────────────────────────────────────────

export const tokens = {
  background: {
    /** The environment behind everything. */
    base: palette.black,
    /** Deep field for large calm areas. */
    deep: palette.space1,
  },

  surface: {
    /** Soap glass: a translucent pane, not a solid card. */
    glass: "rgba(255,255,255,0.045)",
    /** One step nearer the viewer — the active generative surface. */
    elevated: "rgba(255,255,255,0.07)",
    /** Pressed / selected. */
    sunken: "rgba(255,255,255,0.025)",
    /** Opaque fallback where blur is unavailable or too costly. */
    opaque: palette.windowInner1,
  },

  border: {
    /** The thin edge that gives a glass pane its shape. */
    hairline: "rgba(255,255,255,0.10)",
    /** A pane the user is working in. */
    strong: "rgba(255,255,255,0.18)",
    /** Focus ring. Deliberately the loudest border in the system. */
    focus: palette.cyan,
  },

  text: {
    primary: palette.text,
    secondary: palette.text2,
    tertiary: palette.text3,
    /** On a filled accent surface. */
    onAccent: palette.space0,
  },

  accent: {
    primary: palette.cyan,
    secondary: palette.blue,
    /** Used sparingly: JASIM's own presence, and nothing else. */
    presence: palette.purple,
  },

  /**
   * Status colours. Each one is paired with a REQUIRED non-colour signal in the
   * components that use it — an icon and a word — because a status encoded only
   * as a hue is invisible to a large number of people and to anyone reading a
   * greyscale screenshot.
   */
  status: {
    success: palette.green,
    warning: palette.amber,
    danger: palette.red,
    info: palette.blue,
    /** Blocked is NOT a warning. It means JASIM cannot proceed, and it must not
     *  be dressed in a success or neutral colour. */
    blocked: palette.orange,
    /** Data exists but is not current. Distinct from unavailable. */
    stale: palette.slate,
  },

  radius: {
    sm: 10,
    md: 16,
    lg: 22,
    /** Pills and the composer. */
    full: 999,
  },

  /** A 4px rhythm. Components should not invent values between these. */
  space: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },

  /**
   * Type scale in px. The floor is 12: the previous UI used 10px and 11px for
   * timestamps, badges and hints, which is below what most people can read
   * comfortably and below what dynamic type can rescue.
   */
  fontSize: {
    caption: 12,
    body: 14,
    bodyLarge: 15,
    title: 17,
    heading: 20,
  },

  /** Arabic needs more leading than Latin at the same size. */
  lineHeight: {
    tight: 1.4,
    body: 1.75,
  },

  blur: {
    /** Glass panes. */
    surface: 20,
    /** Overlays and sheets. */
    overlay: 40,
  },

  elevation: {
    resting: "0 4px 24px rgba(0,0,0,0.15)",
    raised: "0 8px 32px rgba(0,0,0,0.30)",
  },

  /**
   * Motion. Short, because these durations run on every turn. Anything above
   * ~250ms starts to feel like the interface is deciding rather than responding.
   */
  duration: {
    instant: 120,
    quick: 180,
    /** Matches WORKSPACE_EXIT_DURATION_MS in workspacePresentationVisual.ts. */
    surface: 220,
  },

  easing: {
    standard: "cubic-bezier(0.4, 0, 0.2, 1)",
    entrance: "cubic-bezier(0.16, 1, 0.3, 1)",
  },
} as const;

export type JasimTokens = typeof tokens;

/**
 * The web form: CSS custom properties.
 *
 * Generated rather than hand-written so `index.css` and this file cannot drift.
 * A test asserts the stylesheet contains exactly what this produces.
 */
export function cssVariables(): Record<string, string> {
  const px = (value: number) => `${value}px`;
  return {
    "--jasim-bg": tokens.background.base,
    "--jasim-bg-deep": tokens.background.deep,

    "--jasim-surface": tokens.surface.glass,
    "--jasim-surface-elevated": tokens.surface.elevated,
    "--jasim-surface-sunken": tokens.surface.sunken,
    "--jasim-surface-opaque": tokens.surface.opaque,

    "--jasim-border": tokens.border.hairline,
    "--jasim-border-strong": tokens.border.strong,
    "--jasim-border-focus": tokens.border.focus,

    "--jasim-text": tokens.text.primary,
    "--jasim-text-secondary": tokens.text.secondary,
    "--jasim-text-tertiary": tokens.text.tertiary,
    "--jasim-text-on-accent": tokens.text.onAccent,

    "--jasim-accent": tokens.accent.primary,
    "--jasim-accent-secondary": tokens.accent.secondary,
    "--jasim-presence": tokens.accent.presence,

    "--jasim-success": tokens.status.success,
    "--jasim-warning": tokens.status.warning,
    "--jasim-danger": tokens.status.danger,
    "--jasim-info": tokens.status.info,
    "--jasim-blocked": tokens.status.blocked,
    "--jasim-stale": tokens.status.stale,

    "--jasim-radius-sm": px(tokens.radius.sm),
    "--jasim-radius-md": px(tokens.radius.md),
    "--jasim-radius-lg": px(tokens.radius.lg),

    "--jasim-space-xs": px(tokens.space.xs),
    "--jasim-space-sm": px(tokens.space.sm),
    "--jasim-space-md": px(tokens.space.md),
    "--jasim-space-lg": px(tokens.space.lg),
    "--jasim-space-xl": px(tokens.space.xl),

    "--jasim-font-caption": px(tokens.fontSize.caption),
    "--jasim-font-body": px(tokens.fontSize.body),
    "--jasim-font-title": px(tokens.fontSize.title),
    "--jasim-font-heading": px(tokens.fontSize.heading),
    "--jasim-line-body": String(tokens.lineHeight.body),

    "--jasim-blur-surface": px(tokens.blur.surface),
    "--jasim-blur-overlay": px(tokens.blur.overlay),

    "--jasim-elevation-resting": tokens.elevation.resting,
    "--jasim-elevation-raised": tokens.elevation.raised,

    "--jasim-duration-instant": `${tokens.duration.instant}ms`,
    "--jasim-duration-quick": `${tokens.duration.quick}ms`,
    "--jasim-duration-surface": `${tokens.duration.surface}ms`,
    "--jasim-ease": tokens.easing.standard,
    "--jasim-ease-entrance": tokens.easing.entrance,
  };
}

/** The stylesheet block, ready to paste into (and be verified against) index.css. */
export function cssVariableBlock(): string {
  const entries = Object.entries(cssVariables())
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `:root {\n${entries}\n}`;
}
