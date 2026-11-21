// @ts-nocheck
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '@/lib/utils';

// Interactive component props with polymorphic support
type InteractiveProps<T extends React.ElementType = 'button'> = {
  as?: T;
  asChild?: boolean;
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  variant?: keyof typeof variantMap;
  size?: keyof typeof sizeMap;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'asChild' | 'className' | 'children' | 'disabled' | 'variant' | 'size'>;

// Variant map for interactive variants
const variantMap = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
  outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  link: 'text-primary underline-offset-4 hover:underline',
} as const;

// Size map for interactive sizes
const sizeMap = {
  default: 'h-9 px-4 py-2',
  sm: 'h-8 rounded-md gap-1.5 px-3',
  lg: 'h-10 rounded-md px-6',
  icon: 'size-9',
  'icon-sm': 'size-8',
  'icon-lg': 'size-10',
} as const;

// Interactive component - for buttons, links, and other interactive elements
export const Interactive = React.forwardRef(
  <T extends React.ElementType = 'button'>(
    {
      as,
      asChild = false,
      className,
      children,
      disabled = false,
      variant = 'default',
      size = 'default',
      ...props
    }: InteractiveProps<T>,
    ref: React.ForwardedRef<React.ElementRef<T>>
  ) => {
    const Component = asChild ? Slot : as || 'button';
    return (
      <Component
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all',
          'disabled:pointer-events-none disabled:opacity-50',
          'outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          variantMap[variant],
          sizeMap[size],
          className
        )}
        disabled={disabled}
        {...props}
      >
        {children}
      </Component>
    );
  }
) as <T extends React.ElementType = 'button'>(
  props: InteractiveProps<T> & { ref?: React.ForwardedRef<React.ElementRef<T>> }
) => React.ReactElement;

Interactive.displayName = 'Interactive';

// Type helper for Interactive props
export type InteractiveComponentProps<T extends React.ElementType = 'button'> = InteractiveProps<T>;
