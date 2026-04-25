// Component Variant System
// Centralized variant definitions for consistent component styling

import { cva, type VariantProps } from 'class-variance-authority';

// Color variants
export const colorVariants = cva('', {
  variants: {
    color: {
      default: '',
      primary: 'text-primary bg-primary/10',
      secondary: 'text-secondary bg-secondary/10',
      destructive: 'text-destructive bg-destructive/10',
      success: 'text-success bg-success/10',
      warning: 'text-warning bg-warning/10',
      muted: 'text-muted-foreground bg-muted/10',
      accent: 'text-accent bg-accent/10',
    },
  },
  defaultVariants: {
    color: 'default',
  },
});

// Size variants
export const sizeVariants = cva('', {
  variants: {
    size: {
      xs: 'text-xs',
      sm: 'text-sm',
      md: 'text-base',
      lg: 'text-lg',
      xl: 'text-xl',
      '2xl': 'text-2xl',
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// Variant props type
export type ColorVariantProps = VariantProps<typeof colorVariants>;
export type SizeVariantProps = VariantProps<typeof sizeVariants>;

// Combined variant props
export type VariantPropsType = ColorVariantProps & SizeVariantProps;

// Component variant configuration
export interface ComponentVariantConfig {
  base?: string;
  variants?: {
    color?: Record<string, string>;
    size?: Record<string, string>;
    variant?: Record<string, string>;
  };
  defaultVariants?: {
    color?: string;
    size?: string;
    variant?: string;
  };
}

// Helper function to create component variants
export function createComponentVariants(config: ComponentVariantConfig) {
  return cva(config.base || '', {
    variants: config.variants || {},
    defaultVariants: config.defaultVariants || {},
  });
}

// Common variant configurations
export const buttonVariants = createComponentVariants({
  base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50',
  variants: {
    variant: {
      default: 'bg-primary text-primary-foreground hover:bg-primary/90',
      destructive: 'bg-destructive text-white hover:bg-destructive/90',
      outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
      secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
      ghost: 'hover:bg-accent hover:text-accent-foreground',
      link: 'text-primary underline-offset-4 hover:underline',
    },
    size: {
      default: 'h-9 px-4 py-2',
      sm: 'h-8 rounded-md gap-1.5 px-3',
      lg: 'h-10 rounded-md px-6',
      icon: 'size-9',
      'icon-sm': 'size-8',
      'icon-lg': 'size-10',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export const cardVariants = createComponentVariants({
  base: 'bg-card text-card-foreground rounded-xl border shadow-sm',
  variants: {
    variant: {
      default: 'py-6',
      elevated: 'py-6 shadow-md',
      flat: 'py-6 shadow-none',
    },
    size: {
      default: 'py-6',
      sm: 'py-4',
      lg: 'py-8',
    },
  },
  defaultVariants: {
    variant: 'default',
    size: 'default',
  },
});

export const textVariants = createComponentVariants({
  base: '',
  variants: {
    variant: {
      h1: 'text-4xl font-bold',
      h2: 'text-3xl font-semibold',
      h3: 'text-2xl font-semibold',
      h4: 'text-xl font-semibold',
      h5: 'text-lg font-medium',
      h6: 'text-base font-medium',
      p: 'text-base',
      small: 'text-sm',
      muted: 'text-sm text-muted-foreground',
    },
    color: {
      default: 'text-foreground',
      muted: 'text-muted-foreground',
      primary: 'text-primary',
      destructive: 'text-destructive',
      success: 'text-success',
      warning: 'text-warning',
      accent: 'text-accent',
      secondary: 'text-secondary',
    },
  },
  defaultVariants: {
    variant: 'p',
    color: 'default',
  },
});

// Export types for component props
export type ButtonVariantProps = VariantProps<typeof buttonVariants>;
export type CardVariantProps = VariantProps<typeof cardVariants>;
export type TextVariantProps = VariantProps<typeof textVariants>;
