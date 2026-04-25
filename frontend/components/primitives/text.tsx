import * as React from 'react';
import { cn } from '@/lib/utils';

// Text component props with polymorphic support
type TextProps<T extends React.ElementType = 'span'> = {
  as?: T;
  className?: string;
  children?: React.ReactNode;
  variant?: keyof typeof variantMap;
  color?: keyof typeof colorMap;
  weight?: keyof typeof weightMap;
  size?: keyof typeof sizeMap;
  align?: 'left' | 'center' | 'right';
  truncate?: boolean;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children' | 'variant' | 'color' | 'weight' | 'size' | 'align' | 'truncate'>;

// Variant map for text variants
const variantMap = {
  h1: 'text-4xl font-bold',
  h2: 'text-3xl font-semibold',
  h3: 'text-2xl font-semibold',
  h4: 'text-xl font-semibold',
  h5: 'text-lg font-medium',
  h6: 'text-base font-medium',
  p: 'text-base',
  small: 'text-sm',
  muted: 'text-sm text-muted-foreground',
  code: 'text-sm font-mono bg-muted px-1.5 py-0.5 rounded',
} as const;

// Color map for text colors
const colorMap = {
  foreground: 'text-foreground',
  muted: 'text-muted-foreground',
  primary: 'text-primary',
  destructive: 'text-destructive',
  success: 'text-success',
  warning: 'text-warning',
  accent: 'text-accent',
  secondary: 'text-secondary',
} as const;

// Weight map for font weights
const weightMap = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
} as const;

// Size map for font sizes
const sizeMap = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
  '5xl': 'text-5xl',
  '6xl': 'text-6xl',
} as const;

// Text component - typography component
export const Text = React.forwardRef(
  <T extends React.ElementType = 'span'>(
    {
      as,
      className,
      children,
      variant,
      color,
      weight,
      size,
      align = 'left',
      truncate = false,
      ...props
    }: TextProps<T>,
    ref: React.ForwardedRef<React.ElementRef<T>>
  ) => {
    const Component = as || 'span';
    return (
      <Component
        ref={ref}
        className={cn(
          variant && variantMap[variant],
          color && colorMap[color],
          weight && weightMap[weight],
          size && sizeMap[size],
          align === 'center' && 'text-center',
          align === 'right' && 'text-right',
          truncate && 'truncate',
          className
        )}
        {...props}
      >
        {children}
      </Component>
    );
  }
) as <T extends React.ElementType = 'span'>(
  props: TextProps<T> & { ref?: React.ForwardedRef<React.ElementRef<T>> }
) => React.ReactElement;

Text.displayName = 'Text';

// Type helper for Text props
export type TextComponentProps<T extends React.ElementType = 'span'> = TextProps<T>;
