// @ts-nocheck
import * as React from 'react';
import { cn } from '@/lib/utils';

// Box component props with polymorphic support
type BoxProps<T extends React.ElementType = 'div'> = {
  as?: T;
  className?: string;
  children?: React.ReactNode;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>;

// Box component - basic container with styling
export const Box = React.forwardRef(
  <T extends React.ElementType = 'div'>(
    { as, className, children, ...props }: BoxProps<T>,
    ref: React.ForwardedRef<React.ElementRef<T>>
  ) => {
    const Component = as || 'div';
    return (
      <Component
        ref={ref}
        className={cn('box', className)}
        {...props}
      >
        {children}
      </Component>
    );
  }
) as <T extends React.ElementType = 'div'>(
  props: BoxProps<T> & { ref?: React.ForwardedRef<React.ElementRef<T>> }
) => React.ReactElement;

Box.displayName = 'Box';

// Type helper for Box props
export type BoxComponentProps<T extends React.ElementType = 'div'> = BoxProps<T>;
