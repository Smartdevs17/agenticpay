import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-select",
      "@radix-ui/react-popover",
      "@radix-ui/react-tabs",
      "@radix-ui/react-avatar",
      "@radix-ui/react-label",
    ],
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config, { isServer, defaultLoaders, nextRuntime }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }

    // Enhanced route-based code splitting with named chunks
    config.optimization = {
      ...config.optimization,
      splitChunks: {
        chunks: "all",
        minSize: 20000,
        maxSize: 50000, // Target <50KB per chunk
        cacheGroups: {
          default: false,
          vendors: false,
          // Route-specific chunks
          dashboard: {
            name: "route-dashboard",
            chunks: "async",
            test: /[\\/]app[\\/]dashboard[\\/]/,
            priority: 60,
            enforce: true,
          },
          auth: {
            name: "route-auth",
            chunks: "async",
            test: /[\\/]app[\\/]auth[\\/]/,
            priority: 60,
            enforce: true,
          },
          forms: {
            name: "route-forms",
            chunks: "async",
            test: /[\\/]app[\\/]forms[\\/]/,
            priority: 60,
            enforce: true,
          },
          abi: {
            name: "abi",
            chunks: "async",
            test: /[\\/]lib[\\/]abi[\\/]/,
            priority: 50,
            enforce: true,
          },
          framework: {
            name: "framework",
            chunks: "all",
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types|use-subscription)[\\/]/,
            priority: 40,
            enforce: true,
          },
          lib: {
            test(module: any) {
              const context =
                typeof module?.context === "string" ? module.context : "";
              return (
                !context.match(/[\\/]node_modules[\\/]/) ||
                /lodash/.test(context) ||
                /moment/.test(context)
              );
            },
            name(module: any) {
              const context =
                typeof module?.context === "string" ? module.context : "";
              const packageName =
                context.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)?.[1] ||
                "vendors";
              return `npm.${packageName.replace("@", "")}`;
            },
            priority: 30,
            minChunks: 1,
            reuseExistingChunk: true,
          },
          commons: {
            name: "commons",
            minChunks: 2,
            priority: 10,
          },
          shared: {
            name: "shared",
            priority: 20,
            minChunks: 2,
            reuseExistingChunk: true,
          },
        },
      },
    };

    if (!isServer && nextRuntime === "edge") {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        perf_hooks: false,
      };
    }

    return config;
  },
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 7,
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: process.env.NEXT_PUBLIC_IMAGE_CDN_DOMAIN
      ? [
          {
            protocol: "https",
            hostname: process.env.NEXT_PUBLIC_IMAGE_CDN_DOMAIN,
            pathname: "/**",
          },
        ]
      : [],
  },
  compress: true,
  poweredByHeader: false,
  headers: async () => {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Link",
            value: [
              '</fonts/inter-var.woff2>; rel=preload; as=font; type="font/woff2"; crossorigin=anonymous; fetchpriority=high',
              "</_next/static/css/app/layout.css>; rel=preload; as=style",
            ].join(", "),
          },
          {
            key: "Critical-CH",
            value: "sec-ch-prefers-color-scheme, sec-ch-viewport-width",
          },
        ],
      },
      {
        source: "/fonts/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
        ],
      },
      {
        source: "/:path*.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.css",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.webp",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.avif",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.jpg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/:path*.svg",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400",
          },
        ],
      },
    ];
  },
};

export default withSentryConfig(bundleAnalyzer(withNextIntl(nextConfig)), {
  silent: true,
  org: process.env.SENTRY_ORG || "agenticpay",
  project: process.env.SENTRY_PROJECT || "agenticpay-frontend",
});
