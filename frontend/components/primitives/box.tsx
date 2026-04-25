import * as React from 'react';
import { cn } from '@/lib/utils';

// Box component props with polymorphic support
type BoxProps<T extends React.ElementType = 'div'> = {
  as?: T;
  className?: string;
  children?: React.ReactNode;
} & React.ComponentPropsWithoutRef<T>;

// Box component - basic container with styling
export const Box = React.forwardRef(
  <T extends React.ElementType = 'div'>(
    { as, className, children, ...props }: BoxProps<T>,
    ref: React.Ref<HTMLElement>
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
);

Box.displayName = 'Box';

// Type helper for Box props
export type BoxComponentProps<T extends React.ElementType = 'div'> = BoxProps<T>;
