// Deep — olive-black night, liquid glass, one glowing orb.
// The page is a very dark olive field with a soft light source at the top; content sits on frosted glass
// (translucent fill + a brighter hairline on the top edge). Lime is the interactive colour. Amber stays
// reserved for exactly one thing: a memory coming back.

export type ThemeName = 'deep' | 'paper';
export type ThemeChoice = ThemeName | 'system';

export interface Palette {
  bg: string; // solid fallback behind the gradient
  bgTop: string; // gradient start (light source)
  bgBottom: string; // gradient end
  glowA: string; // radial glow colour, top
  glowB: string; // secondary glow colour
  surface: string; // opaque-ish card fallback (Android / reduced transparency)
  surface2: string; // pressed / nested
  glass: string; // translucent fill
  glassStrong: string; // more opaque glass (sheets, tab bar)
  glassBorder: string;
  glassHighlight: string; // top-edge hairline
  fg: string;
  fg2: string;
  muted: string;
  hairline: string;
  accent: string; // lime — buttons, active, links
  accentSoft: string; // tinted fill
  ion: string; // lighter lime for accent text and glow rims
  onAccent: string;
  signal: string; // amber — ONLY for surfacing
  signalSoft: string;
  signalBorder: string; // hairline on the surfacing card and the signal button — never a literal in a component
  danger: string;
  /** Tinted danger ground — destructive rows, the swipe-to-delete backdrop. */
  dangerSoft: string;
  /** Foreground on the voice orb. White in both themes: the orb is a glowing object, not a filled button. */
  onOrb: string;
  scrim: string;
}

export interface Theme {
  name: ThemeName;
  dark: boolean;
  c: Palette;
}

export const DEEP: Theme = {
  name: 'deep',
  dark: true,
  // Olive-black field, lime as the ONE accent (Marko's v2 palette, 2026-08-25). The ground is a very dark
  // desaturated olive rather than neutral graphite, so the lime reads as the same light source rather than as
  // a sticker on top of grey. Only accent/ion/accentSoft carry the hue on things that are genuinely
  // interactive or active; glass layers stay borderless white-alpha over that ground.
  //
  // Note the inversion the lime forces: it is a LIGHT accent, so text on it must be dark (`onAccent`), unlike
  // the old emerald where it was white. Anything hardcoding white-on-accent will look broken.
  c: {
    bg: '#0B0C09',
    bgTop: '#181A11', // radial glow at the top of the field
    bgBottom: '#0B0C09',
    glowA: '#D7EC7C',
    glowB: '#181A11',
    surface: '#111310', // screen ground inside the phone
    surface2: '#191B15',
    glass: 'rgba(255,255,255,0.05)',
    glassStrong: 'rgba(25,27,21,0.97)', // capture drawer / sheet
    glassBorder: 'rgba(255,255,255,0.09)',
    glassHighlight: 'rgba(255,255,255,0.22)',
    fg: '#F2F3EC',
    fg2: '#C9CDBA',
    muted: '#8F937F',
    hairline: 'rgba(255,255,255,0.08)',
    accent: '#D7EC7C',
    // Used everywhere (every icon badge, every "ion" label) — kept quiet so it reads as ONE accent, not a wash.
    accentSoft: 'rgba(215,236,124,0.16)',
    ion: '#E4F49B',
    onAccent: '#14160E', // dark text ON lime — the accent is light, so this must be too
    signal: '#F5B23D',
    signalSoft: 'rgba(245,178,61,0.16)',
    signalBorder: 'rgba(245,178,61,0.35)',
    danger: '#FF6B6B',
    dangerSoft: 'rgba(255,107,107,0.16)',
    onOrb: '#FFFFFF',
    scrim: 'rgba(8,9,6,0.62)',
  },
};

export const PAPER: Theme = {
  name: 'paper',
  dark: false,
  // Same principle as Deep, and the same hue family — but lime cannot be the accent on white: #D7EC7C on a
  // light ground fails contrast for both text and icons. Daylight therefore uses the DARK end of the same
  // olive/lime axis, so the two themes read as one product rather than two palettes.
  c: {
    bg: '#F4F5EF',
    bgTop: '#ECEEE2',
    bgBottom: '#F8F9F3',
    glowA: '#C6DC86',
    glowB: '#E3EBC7',
    surface: '#FFFFFF',
    surface2: '#F4F5EF',
    glass: 'rgba(255,255,255,0.55)',
    glassStrong: 'rgba(255,255,255,0.85)',
    glassBorder: 'rgba(20,22,14,0.09)',
    glassHighlight: 'rgba(255,255,255,0.9)',
    fg: '#14160E',
    fg2: 'rgba(20,22,14,0.72)',
    muted: 'rgba(20,22,14,0.5)',
    hairline: 'rgba(20,22,14,0.08)',
    accent: '#5F7A1E',
    accentSoft: 'rgba(95,122,30,0.10)',
    ion: '#4C6317',
    onAccent: '#FFFFFF',
    signal: '#B8770F',
    signalSoft: 'rgba(184,119,15,0.14)',
    signalBorder: 'rgba(184,119,15,0.35)',
    danger: '#C93B3B',
    dangerSoft: 'rgba(201,59,59,0.12)',
    onOrb: '#FFFFFF',
    scrim: 'rgba(14,32,25,0.35)',
  },
};

export const THEMES: Record<ThemeName, Theme> = { deep: DEEP, paper: PAPER };
export const THEME_LABELS: Record<ThemeName, string> = { deep: 'Duboko', paper: 'Papir' };

// Spacing (4pt grid) and radii — glass wants generous corners
export const S = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const R = { sm: 12, md: 18, lg: 24, xl: 30, xxl: 36, pill: 999 } as const;

// Type scale — 11 / 13 / 15 / 17 / 22 / 34 / 48
export const T = { xs: 11, sm: 13, md: 15, lg: 17, xl: 22, xxl: 34, hero: 48 } as const;

// Manrope for display (geometric, calm, big numerals), Inter for everything else.
// Dates use Inter Medium with tabular figures — no typewriter face anywhere.
export const FONT = {
  display: 'Manrope_700Bold',
  displayMedium: 'Manrope_600SemiBold',
  displayLight: 'Manrope_500Medium',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemibold: 'Inter_600SemiBold',
  meta: 'Inter_500Medium',
} as const;

// Motion — the surfacing spring; everything else short.
export const SPRING = { damping: 14, stiffness: 120, mass: 1 } as const;
export const SPRING_SNAPPY = { damping: 20, stiffness: 240, mass: 0.8 } as const;
export const DUR = { fast: 140, base: 220, slow: 600 } as const;

/** Height of the floating tab bar + orb zone; scroll views pad their bottom by this. */
export const DOCK_HEIGHT = 96;
