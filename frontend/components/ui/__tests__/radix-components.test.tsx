/**
 * Radix UI component smoke tests — Issue #491
 * Verify each migrated component renders and exports correctly.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

// ── Tooltip ────────────────────────────────────────────────────────────────────
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

describe('Tooltip', () => {
  it('renders trigger without crashing', () => {
    render(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger>hover me</TooltipTrigger>
          <TooltipContent>tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    expect(screen.getByText('hover me')).toBeTruthy();
  });
});

// ── Accordion ─────────────────────────────────────────────────────────────────
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';

describe('Accordion', () => {
  it('renders items and trigger text', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>Question</AccordionTrigger>
          <AccordionContent>Answer</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByText('Question')).toBeTruthy();
  });

  it('trigger has correct aria role', () => {
    render(
      <Accordion type="single" collapsible>
        <AccordionItem value="item-1">
          <AccordionTrigger>FAQ</AccordionTrigger>
          <AccordionContent>Details</AccordionContent>
        </AccordionItem>
      </Accordion>
    );
    expect(screen.getByRole('button', { name: /FAQ/i })).toBeTruthy();
  });
});

// ── Popover ────────────────────────────────────────────────────────────────────
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

describe('Popover', () => {
  it('renders trigger without crashing', () => {
    render(
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>popover body</PopoverContent>
      </Popover>
    );
    expect(screen.getByText('open')).toBeTruthy();
  });
});

// ── Toast ─────────────────────────────────────────────────────────────────────
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastDescription } from '@/components/ui/toast';

describe('Toast', () => {
  it('renders title and description', () => {
    render(
      <ToastProvider>
        <Toast>
          <ToastTitle>Success</ToastTitle>
          <ToastDescription>Payment received</ToastDescription>
        </Toast>
        <ToastViewport />
      </ToastProvider>
    );
    expect(screen.getByText('Success')).toBeTruthy();
    expect(screen.getByText('Payment received')).toBeTruthy();
  });
});
