import { vi } from 'vitest';

export const mockPerformanceEntries = {
  navigation: [
    {
      entryType: 'navigation',
      name: 'navigation',
      startTime: 0,
      duration: 800,
      fetchStart: 50,
      domainLookupStart: 50,
      domainLookupEnd: 100,
      connectStart: 100,
      connectEnd: 150,
      secureConnectionStart: 120,
      requestStart: 150,
      responseStart: 200,
      responseEnd: 300,
      domLoading: 300,
      domInteractive: 400,
      domContentLoadedEventStart: 450,
      domContentLoadedEventEnd: 500,
      domComplete: 700,
      loadEventStart: 700,
      loadEventEnd: 800,
      redirectStart: 0,
      redirectEnd: 0,
      unloadEventStart: 0,
      unloadEventEnd: 0,
    },
  ],
  paint: [
    { name: 'first-paint', entryType: 'paint', startTime: 100, duration: 0 },
    { name: 'first-contentful-paint', entryType: 'paint', startTime: 150, duration: 0 },
  ],
  'largest-contentful-paint': [
    { name: 'largest-contentful-paint', entryType: 'largest-contentful-paint', startTime: 0, duration: 0, renderTime: 2500, loadTime: 2500, size: 50000, id: '', url: '' },
  ],
  'first-input': [
    { name: 'first-input', entryType: 'first-input', startTime: 300, duration: 50, processingStart: 320, processingEnd: 350, firstInputDelay: 20, cancelable: true },
  ],
  'layout-shift': [
    { name: 'layout-shift', entryType: 'layout-shift', startTime: 400, duration: 0, value: 0.1, hadRecentInput: false, lastInputTime: 0 },
    { name: 'layout-shift', entryType: 'layout-shift', startTime: 500, duration: 0, value: 0.05, hadRecentInput: false, lastInputTime: 0 },
  ],
  resource: [
    { name: 'https://example.com/app.js', entryType: 'resource', startTime: 100, duration: 100, transferSize: 50000, encodedBodySize: 50000, decodedBodySize: 150000 },
    { name: 'https://example.com/style.css', entryType: 'resource', startTime: 150, duration: 50, transferSize: 10000, encodedBodySize: 10000, decodedBodySize: 30000 },
    { name: 'https://example.com/image.png', entryType: 'resource', startTime: 200, duration: 200, transferSize: 100000, encodedBodySize: 100000, decodedBodySize: 100000 },
  ],
};

export const mockCoreWebVitals = {
  lcp: 2500,
  fid: 20,
  cls: 0.15,
  ttfb: 150,
  fcp: 150,
};

export const createMockPerformanceObserver = () => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  takeRecords: vi.fn(() => []),
});

export const mockWindow = {
  location: { href: 'http://localhost:3000' },
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
  PerformanceObserver: vi.fn().mockImplementation(() => createMockPerformanceObserver()),
  performance: {
    now: vi.fn(() => Date.now()),
    getEntriesByType: vi.fn((type: string) => mockPerformanceEntries[type as keyof typeof mockPerformanceEntries] || []),
    mark: vi.fn(),
    measure: vi.fn(),
  },
};

export const mockDocument = {
  visibilityState: 'visible',
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
};

export const mockNavigator = {
  userAgent: 'Mozilla/5.0 (Test Agent)',
  onLine: true,
};