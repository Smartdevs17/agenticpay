// Responsive Token Utilities
// Helper functions for working with responsive token values

import { breakpoints } from './tokens';

// Type for responsive token values
export type ResponsiveValue<T> = T | { base: T } & Partial<Record<keyof typeof breakpoints, T>>;

// Helper function to create responsive class names
export function responsiveClass(
  baseClass: string,
  responsiveClasses: Partial<Record<keyof typeof breakpoints, string>>
): string {
  const classes = [baseClass];
  
  for (const [breakpoint, className] of Object.entries(responsiveClasses)) {
    if (className) {
      classes.push(`${breakpoint}:${className}`);
    }
  }
  
  return classes.join(' ');
}

// Helper function to create responsive styles object
export function responsiveStyles<T>(
  baseValue: T,
  responsiveValues: Partial<Record<keyof typeof breakpoints, T>>
): { base: T } & Record<string, T> {
  const styles: { base: T } & Record<string, T> = { base: baseValue };
  
  for (const [breakpoint, value] of Object.entries(responsiveValues)) {
    if (value !== undefined) {
      styles[breakpoint] = value;
    }
  }
  
  return styles;
}

// Type-safe responsive token helper
export function createResponsiveToken<T>(
  token: T,
  responsive?: Partial<Record<keyof typeof breakpoints, T>>
): ResponsiveValue<T> {
  if (!responsive || Object.keys(responsive).length === 0) {
    return token;
  }
  
  return {
    base: token,
    ...responsive,
  };
}

// Example usage:
// const padding = createResponsiveToken('4', { sm: '6', md: '8', lg: '10' });
// const className = responsiveClass('p-4', { sm: 'p-6', md: 'p-8', lg: 'p-10' });
