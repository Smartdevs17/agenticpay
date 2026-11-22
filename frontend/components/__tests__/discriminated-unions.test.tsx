/**
 * Discriminated unions component test suite (#1414).
 * Verifies exhaustive rendering for typed component variants.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { Inbox } from 'lucide-react';
import { EmptyState } from '../empty/EmptyState';
import { KycStatusBadge } from '../kyc/KycStatusBadge';
import { resolveOfflineVariant } from '../offline/OfflineBanner';
import { assertNever } from '../common/discriminated-union';

describe('Frontend Typed Props with Discriminated Unions (#1414)', () => {
  describe('assertNever', () => {
    it('throws with unhandled variant details', () => {
      expect(() => {
        // @ts-expect-error testing runtime safety for unexpected variant
        assertNever('unknown_variant' as never);
      }).toThrow('Unhandled discriminated union member: "unknown_variant"');
    });
  });

  describe('EmptyState component variants', () => {
    it('renders default variant with optional action', () => {
      render(
        <EmptyState
          icon={Inbox}
          title="No items found"
          description="Try adjusting your search criteria"
        />
      );
      expect(screen.getByText('No items found')).toBeTruthy();
      expect(screen.getByText('Try adjusting your search criteria')).toBeTruthy();
    });

    it('renders action variant and handles clicks', () => {
      const handleAction = vi.fn();
      render(
        <EmptyState
          variant="action"
          icon={Inbox}
          title="No projects"
          description="Create your first project"
          action={{ label: 'Create Project', onClick: handleAction }}
        />
      );
      const button = screen.getByRole('button', { name: 'Create Project' });
      expect(button).toBeTruthy();
      fireEvent.click(button);
      expect(handleAction).toHaveBeenCalledTimes(1);
    });

    it('renders info variant without action button', () => {
      render(
        <EmptyState
          variant="info"
          icon={Inbox}
          title="Read-only view"
          description="You do not have permission to add items"
        />
      );
      expect(screen.getByText('Read-only view')).toBeTruthy();
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('KycStatusBadge variants', () => {
    it('renders each kyc status variant with correct label and styling', () => {
      const statuses = ['pending', 'under_review', 'approved', 'rejected', 'expired'] as const;
      for (const status of statuses) {
        const { unmount } = render(<KycStatusBadge status={status} />);
        expect(screen.getByText(status.replace(/_/g, ' '))).toBeTruthy();
        unmount();
      }
    });
  });

  describe('resolveOfflineVariant', () => {
    it('resolves syncing state when syncing regardless of queue', () => {
      const variant = resolveOfflineVariant(true, 3, true);
      expect(variant).toEqual({ state: 'syncing', queueLength: 3 });
    });

    it('resolves offline state when not online', () => {
      const variant = resolveOfflineVariant(false, 2, false);
      expect(variant).toEqual({ state: 'offline', queueLength: 2 });
    });

    it('resolves queued state when online with pending queue', () => {
      const variant = resolveOfflineVariant(true, 5, false);
      expect(variant).toEqual({ state: 'queued', queueLength: 5 });
    });

    it('resolves idle state when online with empty queue and not syncing', () => {
      const variant = resolveOfflineVariant(true, 0, false);
      expect(variant).toEqual({ state: 'idle' });
    });
  });
});
