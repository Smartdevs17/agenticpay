// Dark Mode Token Definitions
// Organized dark mode token values for easy theming

// Dark mode color overrides
export const darkModeColors = {
  background: 'oklch(0.145 0 0)',
  foreground: 'oklch(0.985 0 0)',
  card: 'oklch(0.205 0 0)',
  cardForeground: 'oklch(0.985 0 0)',
  popover: 'oklch(0.205 0 0)',
  popoverForeground: 'oklch(0.985 0 0)',
  primary: 'oklch(0.922 0 0)',
  primaryForeground: 'oklch(0.205 0 0)',
  secondary: 'oklch(0.269 0 0)',
  secondaryForeground: 'oklch(0.985 0 0)',
  muted: 'oklch(0.269 0 0)',
  mutedForeground: 'oklch(0.708 0 0)',
  accent: 'oklch(0.269 0 0)',
  accentForeground: 'oklch(0.985 0 0)',
  destructive: 'oklch(0.704 0.191 22.216)',
  border: 'oklch(1 0 0 / 10%)',
  input: 'oklch(1 0 0 / 15%)',
  ring: 'oklch(0.556 0 0)',
  chart1: 'oklch(0.488 0.243 264.376)',
  chart2: 'oklch(0.696 0.17 162.48)',
  chart3: 'oklch(0.769 0.188 70.08)',
  chart4: 'oklch(0.627 0.265 303.9)',
  chart5: 'oklch(0.645 0.246 16.439)',
  sidebar: 'oklch(0.205 0 0)',
  sidebarForeground: 'oklch(0.985 0 0)',
  sidebarPrimary: 'oklch(0.488 0.243 264.376)',
  sidebarPrimaryForeground: 'oklch(0.985 0 0)',
  sidebarAccent: 'oklch(0.269 0 0)',
  sidebarAccentForeground: 'oklch(0.985 0 0)',
  sidebarBorder: 'oklch(1 0 0 / 10%)',
  sidebarRing: 'oklch(0.556 0 0)',
} as const;

// Dark mode shadow overrides (if needed)
export const darkModeShadows = {
  // In dark mode, shadows are typically more subtle
  xs: '0 1px 2px 0 rgb(0 0 0 / 0.3)',
  sm: '0 1px 3px 0 rgb(0 0 0 / 0.4), 0 1px 2px -1px rgb(0 0 0 / 0.4)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.4), 0 2px 4px -2px rgb(0 0 0 / 0.4)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.4), 0 4px 6px -4px rgb(0 0 0 / 0.4)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.4), 0 8px 10px -6px rgb(0 0 0 / 0.4)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.5)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.3)',
} as const;

// Dark mode typography overrides (if needed)
export const darkModeTypography = {
  // Typography remains the same in dark mode
  // but you could add specific dark mode adjustments here
  // e.g., slightly lighter text for better contrast
} as const;

// Combined dark mode tokens
export const darkModeTokens = {
  colors: darkModeColors,
  shadows: darkModeShadows,
  typography: darkModeTypography,
} as const;

// Helper function to apply dark mode tokens
export function applyDarkModeTokens(element: HTMLElement): void {
  const root = element;
  const darkColors = darkModeTokens.colors;
  
  // Apply dark mode colors to CSS custom properties
  Object.entries(darkColors).forEach(([key, value]) => {
    const cssVarName = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
    root.style.setProperty(cssVarName, value);
  });
}

// Helper function to check if dark mode is active
export function isDarkMode(): boolean {
  if (typeof window === 'undefined') return false;
  return document.documentElement.classList.contains('dark');
}

// Helper function to toggle dark mode
export function toggleDarkMode(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark');
}
