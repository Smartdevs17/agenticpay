// @ts-nocheck
import * as React from 'react';
import { cn } from '@/lib/utils';

// Flex component props with polymorphic support
type FlexProps<T extends React.ElementType = 'div'> = {
  as?: T;
  className?: string;
  children?: React.ReactNode;
  direction?: 'row' | 'col' | 'row-reverse' | 'col-reverse';
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justify?: 'start' | 'end' | 'center' | 'between' | 'around' | 'evenly';
  items?: 'start' | 'end' | 'center' | 'baseline' | 'stretch';
  gap?: keyof typeof spacingMap;
  flex?: string;
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children' | 'direction' | 'wrap' | 'justify' | 'items' | 'gap'>;

// Spacing map for gap prop
const spacingMap = {
  '0': 'gap-0',
  '0.5': 'gap-0.5',
  '1': 'gap-1',
  '1.5': 'gap-1.5',
  '2': 'gap-2',
  '2.5': 'gap-2.5',
  '3': 'gap-3',
  '3.5': 'gap-3.5',
  '4': 'gap-4',
  '5': 'gap-5',
  '6': 'gap-6',
  '7': 'gap-7',
  '8': 'gap-8',
  '9': 'gap-9',
  '10': 'gap-10',
  '12': 'gap-12',
  '16': 'gap-16',
  '20': 'gap-20',
  '24': 'gap-24',
  '32': 'gap-32',
} as const;

// Direction map for direction prop
const directionMap = {
  row: 'flex-row',
  col: 'flex-col',
  'row-reverse': 'flex-row-reverse',
  'col-reverse': 'flex-col-reverse',
} as const;

// Justify map for justify prop
const justifyMap = {
  start: 'justify-start',
  end: 'justify-end',
  center: 'justify-center',
  between: 'justify-between',
  around: 'justify-around',
  evenly: 'justify-evenly',
} as const;

// Items map for items prop
const itemsMap = {
  start: 'items-start',
  end: 'items-end',
  center: 'items-center',
  baseline: 'items-baseline',
  stretch: 'items-stretch',
} as const;

// Wrap map for wrap prop
const wrapMap = {
  nowrap: 'flex-nowrap',
  wrap: 'flex-wrap',
  'wrap-reverse': 'flex-wrap-reverse',
} as const;

// Flex component - flexbox container
export const Flex = React.forwardRef(
  <T extends React.ElementType = 'div'>(
    {
      as,
      className,
      children,
      direction = 'row',
      wrap = 'nowrap',
      justify = 'start',
      items = 'stretch',
      gap = '0',
      flex,
      ...props
    }: FlexProps<T>,
    ref: React.ForwardedRef<React.ElementRef<T>>
  ) => {
    const Component = as || 'div';
    return (
      <Component
        ref={ref}
        className={cn(
          'flex',
          directionMap[direction],
          wrapMap[wrap],
          justifyMap[justify],
          itemsMap[items],
          gap !== '0' && spacingMap[gap],
          flex,
          className
        )}
        {...props}
      >
        {children}
      </Component>
    );
  }
) as <T extends React.ElementType = 'div'>(
  props: FlexProps<T> & { ref?: React.ForwardedRef<React.ElementRef<T>> }
) => React.ReactElement;

Flex.displayName = 'Flex';

// Type helper for Flex props
export type FlexComponentProps<T extends React.ElementType = 'div'> = FlexProps<T>;
