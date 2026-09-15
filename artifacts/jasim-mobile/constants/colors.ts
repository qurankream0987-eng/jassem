/**
 * JASIM soap-glass design tokens (approved "Soap Glass + Pop Bubbles" design).
 * The app is dark-only; values live under `light` so the shared useColors()
 * hook keeps working, and both color schemes resolve to the same palette.
 */

export const fonts = {
  regular: 'NotoSansArabic_400Regular',
  medium: 'NotoSansArabic_500Medium',
  semiBold: 'NotoSansArabic_600SemiBold',
  bold: 'NotoSansArabic_700Bold',
  extraBold: 'NotoSansArabic_800ExtraBold',
} as const;

export const palette = {
  black: '#000000',
  space0: '#010208',
  space1: '#030610',
  space2: '#070c1a',
  windowInner0: '#0a0e1a',
  windowInner1: '#070a14',
  windowInner2: '#050812',
  text: '#f0f4ff',
  text2: '#94a3b8',
  cyan: '#00d4ff',
  blue: '#4a9eff',
  purple: '#a855f7',
  pink: '#ec4899',
  gold: '#FFD700',
  orange: '#FF6B00',
  green: '#00c896',
  red: '#ff6b6b',
  amber: '#FFC107',
  slate: '#cbd5e1',
} as const;

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: palette.text,
    tint: palette.cyan,

    // Core surfaces
    background: palette.black,
    foreground: palette.text,

    // Cards / elevated surfaces
    card: palette.windowInner1,
    cardForeground: palette.text,

    // Primary action color (buttons, links, active states)
    primary: palette.cyan,
    primaryForeground: palette.space0,

    // Secondary / less-emphasis interactive surfaces
    secondary: palette.windowInner0,
    secondaryForeground: palette.text,

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: palette.space2,
    mutedForeground: palette.text2,

    // Accent highlights (badges, selected items, focus rings)
    accent: palette.purple,
    accentForeground: palette.text,

    // Destructive actions (delete, error states)
    destructive: palette.red,
    destructiveForeground: palette.text,

    // Borders and input outlines
    border: 'rgba(255,255,255,0.12)',
    input: 'rgba(255,255,255,0.10)',
  },

  // Border radius (in px). Bubbles and glass surfaces use larger radii.
  radius: 22,
};

export default colors;
