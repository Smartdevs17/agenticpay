/**
 * Frontend Performance Monitoring
 * Tracks Core Web Vitals and sends data to Sentry for RUM
 */

import * as Sentry from "@sentry/nextjs";

export interface CoreWebVitals {
  lcp?: number; // Largest Contentful Paint (ms)
  fid?: number; // First Input Delay (ms)
  cls?: number; // Cumulative Layout Shift (0-1)
  ttfb?: number; // Time to First Byte (ms)
  fcp?: number; // First Contentful Paint (ms)
}

export interface PerformanceMetrics {
  webVitals: CoreWebVitals;
  navigation: {
    domContentLoaded: number;
    loadComplete: number;
    timeToFirstByte: number;
  };
  resources: {
    totalSize: number;
    jsSize: number;
    cssSize: number;
    imageSize: number;
  };
  pageLoad: {
    startTime: number;
    endTime: number;
    duration: number;
  };
  timestamp: string;
}

class PerformanceMonitor {
  private vitals: CoreWebVitals = {};
  private startTime = performance.now();
  private reportedMetrics = false;

  /**
   * Initialize Core Web Vitals tracking
   */
  initialize(): void {
    if (typeof window === "undefined") return;

    // Track LCP (Largest Contentful Paint)
    this.trackLCP();

    // Track FID (First Input Delay) / INP (Interaction to Next Paint)
    this.trackInteractivity();

    // Track CLS (Cumulative Layout Shift)
    this.trackCLS();

    // Track TTFB (Time to First Byte)
    this.trackTTFB();

    // Track FCP (First Contentful Paint)
    this.trackFCP();

    // Report metrics on page hide/unload
    if ("visibilitychange" in document) {
      document.addEventListener(
        "visibilitychange",
        () => {
          if (document.visibilityState === "hidden") {
            this.reportMetrics();
          }
        },
        true,
      );
    }

    // Fallback: report on unload
    window.addEventListener("unload", () => this.reportMetrics());

    // Also report on page navigation
    if ("PerformanceObserver" in window) {
      try {
        const navObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.name === "navigation" && entry.entryType === "paint") {
              this.reportMetrics();
            }
          }
        });
        navObserver.observe({ entryTypes: ["paint"] });
      } catch {}
    }
  }

  /**
   * Track Largest Contentful Paint
   */
  private trackLCP(): void {
    if ("PerformanceObserver" in window && "LargestContentfulPaint" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            const lastEntry = entries[entries.length - 1];
            this.vitals.lcp = lastEntry.renderTime || lastEntry.loadTime;
            this.sendToSentry("lcp", this.vitals.lcp);
          }
        });
        observer.observe({ entryTypes: ["largest-contentful-paint"] });

        // Disconnect after 10 seconds
        setTimeout(() => {
          observer.disconnect();
        }, 10000);
      } catch {}
    }
  }

  /**
   * Track First Input Delay (FID) / Interaction to Next Paint (INP)
   */
  private trackInteractivity(): void {
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const delay =
              "firstInputDelay" in entry ? entry.firstInputDelay : entry.duration;
            if (delay > 0) {
              this.vitals.fid = delay;
              this.sendToSentry("fid", this.vitals.fid);
            }
          }
        });
        // Try INP first (newer), fall back to FID
        try {
          observer.observe({ entryTypes: ["first-input", "interaction"] });
        } catch {
          observer.observe({ entryTypes: ["first-input"] });
        }
      } catch {}
    }
  }

  /**
   * Track Cumulative Layout Shift
   */
  private trackCLS(): void {
    if ("PerformanceObserver" in window) {
      try {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (!("hadRecentInput" in entry) || !entry.hadRecentInput) {
              clsValue += entry.value;
              this.vitals.cls = clsValue;
              this.sendToSentry("cls", this.vitals.cls);
            }
          }
        });
        observer.observe({ entryTypes: ["layout-shift"] });

        // Disconnect after page hide
        document.addEventListener(
          "visibilitychange",
          () => {
            if (document.visibilityState === "hidden") {
              observer.disconnect();
            }
          },
          true,
        );
      } catch {}
    }
  }

  /**
   * Track Time to First Byte
   */
  private trackTTFB(): void {
    if ("performance" in window && performance.getEntriesByType) {
      const navigationTiming = performance.getEntriesByType(
        "navigation",
      )[0] as PerformanceNavigationTiming | undefined;
      if (navigationTiming) {
        this.vitals.ttfb = navigationTiming.responseStart - navigationTiming.fetchStart;
        this.sendToSentry("ttfb", this.vitals.ttfb);
      }
    }
  }

  /**
   * Track First Contentful Paint
   */
  private trackFCP(): void {
    if ("PerformanceObserver" in window) {
      try {
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          if (entries.length > 0) {
            const fcpEntry = entries[entries.length - 1];
            this.vitals.fcp = fcpEntry.startTime;
            this.sendToSentry("fcp", this.vitals.fcp);
          }
        });
        observer.observe({ entryTypes: ["paint"] });

        setTimeout(() => {
          observer.disconnect();
        }, 5000);
      } catch {}
    }
  }

  /**
   * Send metric to Sentry
   */
  private sendToSentry(metric: string, value: number): void {
    if (typeof window !== "undefined" && Sentry.captureMessage) {
      Sentry.captureMessage(`Core Web Vital: ${metric}=${value.toFixed(2)}`, "info");
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): PerformanceMetrics {
    const navTiming = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;

    return {
      webVitals: { ...this.vitals },
      navigation: {
        domContentLoaded: navTiming?.domContentLoadedEventEnd ?? 0,
        loadComplete: navTiming?.loadEventEnd ?? 0,
        timeToFirstByte: navTiming?.responseStart ?? 0,
      },
      resources: this.getResourceMetrics(),
      pageLoad: {
        startTime: this.startTime,
        endTime: performance.now(),
        duration: performance.now() - this.startTime,
      },
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get resource metrics (bundle sizes, etc.)
   */
  private getResourceMetrics(): PerformanceMetrics["resources"] {
    let jsSize = 0,
      cssSize = 0,
      imageSize = 0;

    if (performance.getEntriesByType) {
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      for (const resource of resources) {
        const size = resource.transferSize || 0;
        if (resource.name.endsWith(".js")) jsSize += size;
        else if (resource.name.endsWith(".css")) cssSize += size;
        else if (/\.(png|jpg|jpeg|webp|svg|gif|avif)$/i.test(resource.name)) imageSize += size;
      }
    }

    return {
      totalSize: jsSize + cssSize + imageSize,
      jsSize,
      cssSize,
      imageSize,
    };
  }

  /**
   * Report metrics to analytics backend
   */
  private async reportMetrics(): Promise<void> {
    if (this.reportedMetrics) return;
    this.reportedMetrics = true;

    const metrics = this.getMetrics();

    // Send to Sentry
    Sentry.captureMessage("Performance Report", "info", {
      extra: {
        webVitals: metrics.webVitals,
        navigation: metrics.navigation,
        resources: metrics.resources,
        pageLoad: metrics.pageLoad,
      },
    });

    // Send to analytics API (optional)
    try {
      await fetch("/api/analytics/performance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          metrics,
          url: typeof window !== "undefined" ? window.location.href : "",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
        }),
      }).catch(() => {}); // Silent fail
    } catch {}
  }

  /**
   * Track route transition performance
   */
  trackRouteTransition(fromRoute: string, toRoute: string): void {
    const navigationStart = performance.now();

    return new Proxy(new Object(), {
      get: () => {
        const duration = performance.now() - navigationStart;
        Sentry.captureMessage(`Route transition: ${fromRoute} → ${toRoute} (${duration.toFixed(0)}ms)`, "info");
      },
    });
  }
}

export const performanceMonitor = new PerformanceMonitor();

// Auto-initialize on module load
if (typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      performanceMonitor.initialize();
    });
  } else {
    performanceMonitor.initialize();
  }
}
