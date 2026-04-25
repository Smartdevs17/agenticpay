// Design Tokens System
// Centralized token definitions for colors, spacing, typography, shadows, and more

// Color Tokens
export const colors = {
  // Base colors
  background: 'var(--background)',
  foreground: 'var(--foreground)',

  // Card
  card: 'var(--card)',
  cardForeground: 'var(--card-foreground)',

  // Popover
  popover: 'var(--popover)',
  popoverForeground: 'var(--popover-foreground)',

  // Primary
  primary: 'var(--primary)',
  primaryForeground: 'var(--primary-foreground)',

  // Secondary
  secondary: 'var(--secondary)',
  secondaryForeground: 'var(--secondary-foreground)',

  // Muted
  muted: 'var(--muted)',
  mutedForeground: 'var(--muted-foreground)',

  // Accent
  accent: 'var(--accent)',
  accentForeground: 'var(--accent-foreground)',

  // Destructive
  destructive: 'var(--destructive)',

  // Border & Input
  border: 'var(--border)',
  input: 'var(--input)',
  ring: 'var(--ring)',

  // Success & Warning
  success: 'var(--success)',
  warning: 'var(--warning)',

  // Chart colors
  chart1: 'var(--chart-1)',
  chart2: 'var(--chart-2)',
  chart3: 'var(--chart-3)',
  chart4: 'var(--chart-4)',
  chart5: 'var(--chart-5)',

  // Sidebar
  sidebar: 'var(--sidebar)',
  sidebarForeground: 'var(--sidebar-foreground)',
  sidebarPrimary: 'var(--sidebar-primary)',
  sidebarPrimaryForeground: 'var(--sidebar-primary-foreground)',
  sidebarAccent: 'var(--sidebar-accent)',
  sidebarAccentForeground: 'var(--sidebar-accent-foreground)',
  sidebarBorder: 'var(--sidebar-border)',
  sidebarRing: 'var(--sidebar-ring)',
} as const;

// Spacing Tokens
export const spacing = {
  // Base spacing units (in rems)
  '0': '0',
  '0.5': '0.125rem',
  '1': '0.25rem',
  '1.5': '0.375rem',
  '2': '0.5rem',
  '2.5': '0.625rem',
  '3': '0.75rem',
  '3.5': '0.875rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '7': '1.75rem',
  '8': '2rem',
  '9': '2.25rem',
  '10': '2.5rem',
  '11': '2.75rem',
  '12': '3rem',
  '14': '3.5rem',
  '16': '4rem',
  '20': '5rem',
  '24': '6rem',
  '28': '7rem',
  '32': '8rem',
  '36': '9rem',
  '40': '10rem',
  '44': '11rem',
  '48': '12rem',
  '52': '13rem',
  '56': '14rem',
  '60': '15rem',
  '64': '16rem',
  '72': '18rem',
  '80': '20rem',
  '96': '24rem',
} as const;

// Typography Tokens
export const typography = {
  // Font families
  fontFamily: {
    sans: 'var(--font-sans)',
    mono: 'var(--font-mono)',
  },

  // Font sizes
  fontSize: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
    '6xl': '3.75rem',
  },

  // Font weights
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },

  // Line heights
  lineHeight: {
    none: '1',
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.625',
    loose: '2',
  },

  // Letter spacing
  letterSpacing: {
    tighter: '-0.05em',
    tight: '-0.025em',
    normal: '0',
    wide: '0.025em',
    wider: '0.05em',
    widest: '0.1em',
  },
} as const;

// Radius Tokens
export const radius = {
  none: '0',
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
  xl: 'var(--radius-xl)',
  '2xl': 'var(--radius-2xl)',
  '3xl': 'var(--radius-3xl)',
  '4xl': 'var(--radius-4xl)',
  full: '9999px',
} as const;

// Shadow Tokens
export const shadows = {
  none: 'none',
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
} as const;

// Breakpoint Tokens (for responsive design)
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// Z-Index Tokens
export const zIndex = {
  dropdown: '1000',
  sticky: '1020',
  fixed: '1030',
  modalBackdrop: '1040',
  modal: '1050',
  popover: '1060',
  tooltip: '1070',
} as const;

// Export all tokens as a single object
export const tokens = {
  colors,
  spacing,
  typography,
  radius,
  shadows,
  breakpoints,
  zIndex,
} as const;

// Type helpers
export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type TypographyToken = keyof typeof typography;
export type RadiusToken = keyof typeof radius;
export type ShadowToken = keyof typeof shadows;
export type BreakpointToken = keyof typeof breakpoints;
export type ZIndexToken = keyof typeof zIndex;
