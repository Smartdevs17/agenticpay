import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { ChunkErrorBoundary } from '@/components/ui/ChunkErrorBoundary';
import {
  AnalyticsChartsSkeleton,
  RateLimitChartsSkeleton,
  PayoutFailureChartsSkeleton,
} from '@/components/dashboard/ChartSkeletons';

function collectPageFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectPageFiles(full));
    } else if (entry.isFile() && entry.name === 'page.tsx') {
      results.push(full);
    }
  }
  return results;
}

describe('Dashboard route group code-splitting (#1448)', () => {
  describe('ChunkErrorBoundary', () => {
    it('renders children when no chunk error occurs', () => {
      render(
        <ChunkErrorBoundary fallbackTitle="Analytics Charts">
          <div>Loaded chart content</div>
        </ChunkErrorBoundary>,
      );

      expect(screen.getByText('Loaded chart content')).toBeTruthy();
    });

    it('catches chunk load failures and allows retry', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      let shouldThrow = true;

      function FlakyChunk() {
        if (shouldThrow) {
          throw new Error('ChunkLoadError: Loading chunk analytics-charts failed');
        }
        return <div>Recovered chart content</div>;
      }

      render(
        <ChunkErrorBoundary fallbackTitle="Analytics Visualizations">
          <FlakyChunk />
        </ChunkErrorBoundary>,
      );

      expect(screen.getByText('Analytics Visualizations')).toBeTruthy();
      const retryButton = screen.getByRole('button', { name: /retry loading visualization/i });
      expect(retryButton).toBeTruthy();

      shouldThrow = false;
      fireEvent.click(retryButton);

      expect(screen.getByText('Recovered chart content')).toBeTruthy();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Chart skeletons', () => {
    it('renders AnalyticsChartsSkeleton with accessible loading attributes', () => {
      render(<AnalyticsChartsSkeleton />);
      const status = screen.getByRole('status', { name: /loading analytics charts/i });
      expect(status.getAttribute('aria-busy')).toBe('true');
    });

    it('renders RateLimitChartsSkeleton with accessible loading attributes', () => {
      render(<RateLimitChartsSkeleton />);
      const status = screen.getByRole('status', { name: /loading rate limit charts/i });
      expect(status.getAttribute('aria-busy')).toBe('true');
    });

    it('renders PayoutFailureChartsSkeleton with accessible loading attributes', () => {
      render(<PayoutFailureChartsSkeleton />);
      const status = screen.getByRole('status', { name: /loading payout failure charts/i });
      expect(status.getAttribute('aria-busy')).toBe('true');
    });
  });

  describe('Static import boundary guard', () => {
    const frontendRoot = path.resolve(__dirname, '../../..');

    it('keeps recharts out of every dashboard page.tsx initial route chunk', () => {
      const dashboardDirs = [
        path.join(frontendRoot, 'app/dashboard'),
        path.join(frontendRoot, 'app/[locale]/dashboard'),
      ];
      const pages = dashboardDirs.flatMap(collectPageFiles);
      expect(pages.length).toBeGreaterThan(0);

      const offending: string[] = [];
      for (const file of pages) {
        const src = fs.readFileSync(file, 'utf8');
        if (/from\s+['"]recharts['"]/.test(src)) {
          offending.push(path.relative(frontendRoot, file));
        }
      }

      expect(offending).toEqual([]);
    });

    it('keeps recharts out of ChartSkeletons so dynamic loading fallbacks stay lightweight', () => {
      const skeletonsFile = path.join(frontendRoot, 'components/dashboard/ChartSkeletons.tsx');
      const src = fs.readFileSync(skeletonsFile, 'utf8');
      expect(/from\s+['"]recharts['"]/.test(src)).toBe(false);
    });
  });
});
