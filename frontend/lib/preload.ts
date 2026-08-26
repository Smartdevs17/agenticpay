/**
 * Predictive preload utility for route-based code splitting
 * Implements Intersection Observer and heuristic-based preloading
 */

interface PreloadConfig {
  enabled: boolean;
  maxConcurrent: number;
  dataSaverMode: boolean;
  hoverDelay: number;
}

interface NavigationPattern {
  from: string;
  to: string;
  frequency: number;
}

class RoutePreloader {
  private preloadedRoutes = new Set<string>();
  private activePreloads = new Map<string, AbortController>();
  private config: PreloadConfig;
  private navigationPatterns: Map<string, string[]> = new Map();

  constructor(config?: Partial<PreloadConfig>) {
    this.config = {
      enabled: true,
      maxConcurrent: 3,
      dataSaverMode: this.detectDataSaver(),
      hoverDelay: 50,
      ...config,
    };

    this.loadNavigationPatterns();
  }

  private detectDataSaver(): boolean {
    if (typeof navigator !== "undefined") {
      return (
        // @ts-ignore
        navigator.connection?.saveData ||
        // @ts-ignore
        navigator.connection?.effectiveType === "slow-2g" ||
        // @ts-ignore
        navigator.connection?.effectiveType === "2g"
      );
    }
    return false;
  }

  private loadNavigationPatterns() {
    // Common navigation patterns (heatmap-driven)
    this.navigationPatterns.set("/", ["/dashboard", "/auth/login"]);
    this.navigationPatterns.set("/dashboard", [
      "/dashboard/transactions",
      "/dashboard/analytics",
      "/dashboard/settings",
    ]);
    this.navigationPatterns.set("/auth/login", [
      "/dashboard",
      "/auth/register",
    ]);
  }

  async preloadRoute(
    route: string,
    priority: "high" | "low" = "low",
  ): Promise<void> {
    if (!this.config.enabled || this.config.dataSaverMode) {
      return;
    }

    if (this.preloadedRoutes.has(route)) {
      return;
    }

    if (
      this.activePreloads.size >= this.config.maxConcurrent &&
      priority === "low"
    ) {
      return;
    }

    const abortController = new AbortController();
    this.activePreloads.set(route, abortController);

    try {
      // Preload Next.js route chunk
      const href = route;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = href;
      link.as = "document";

      document.head.appendChild(link);

      this.preloadedRoutes.add(route);
    } catch (error) {
      console.warn(`Failed to preload route: ${route}`, error);
    } finally {
      this.activePreloads.delete(route);
    }
  }

  preloadPredictive(currentRoute: string) {
    const patterns = this.navigationPatterns.get(currentRoute);
    if (patterns) {
      patterns.forEach((route) => this.preloadRoute(route, "low"));
    }
  }

  setupIntersectionObserver(linkSelector = 'a[href^="/"]') {
    if (typeof IntersectionObserver === "undefined") {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const link = entry.target as HTMLAnchorElement;
            const href = link.getAttribute("href");
            if (href && href.startsWith("/")) {
              this.preloadRoute(href, "low");
            }
          }
        });
      },
      {
        rootMargin: "50px",
      },
    );

    // Observe all internal links
    document.querySelectorAll(linkSelector).forEach((link) => {
      observer.observe(link);
    });

    return observer;
  }

  setupHoverPreload() {
    let hoverTimer: NodeJS.Timeout;

    document.addEventListener(
      "mouseover",
      (e) => {
        const target = (e.target as HTMLElement).closest('a[href^="/"]');
        if (target) {
          const href = (target as HTMLAnchorElement).getAttribute("href");
          if (href) {
            hoverTimer = setTimeout(() => {
              this.preloadRoute(href, "high");
            }, this.config.hoverDelay);
          }
        }
      },
      { passive: true },
    );

    document.addEventListener(
      "mouseout",
      (e) => {
        const target = (e.target as HTMLElement).closest('a[href^="/"]');
        if (target && hoverTimer) {
          clearTimeout(hoverTimer);
        }
      },
      { passive: true },
    );

    // Touch start preloading for mobile
    document.addEventListener(
      "touchstart",
      (e) => {
        const target = (e.target as HTMLElement).closest('a[href^="/"]');
        if (target) {
          const href = (target as HTMLAnchorElement).getAttribute("href");
          if (href) {
            this.preloadRoute(href, "high");
          }
        }
      },
      { passive: true },
    );
  }

  cancelAll() {
    this.activePreloads.forEach((controller) => controller.abort());
    this.activePreloads.clear();
  }
}

export const routePreloader = new RoutePreloader();
