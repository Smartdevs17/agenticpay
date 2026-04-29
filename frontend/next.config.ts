import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";
import { withSentryConfig } from "@sentry/nextjs";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-select", "@radix-ui/react-popover", "@radix-ui/react-tabs", "@radix-ui/react-avatar", "@radix-ui/react-label"],
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

    config.optimization = {
      ...config.optimization,
      splitChunks: {
        chunks: "all",
        minSize: 20000,
        maxSize: 244000,
        cacheGroups: {
          default: false,
          vendors: false,
          framework: {
            name: "framework",
            chunks: "all",
            test: /[\\/]node_modules[\\/](react|react-dom|scheduler|prop-types|use-subscription)[\\/]/,
            priority: 40,
            enforce: true,
          },
          lib: {
            test(module: any) {
              return (
                !module.context.match(/[\\/]node_modules[\\/]/) ||
                /lodash/.test(module.context) ||
                /moment/.test(module.context)
              );
            },
            name(module: any) {
              const packageName = module.context.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)?.[1] || "vendors";
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
    ];
  },
};

export default withSentryConfig(bundleAnalyzer(nextConfig), {
  silent: true,
  org: process.env.SENTRY_ORG || "agenticpay",
  project: process.env.SENTRY_PROJECT || "agenticpay-frontend",
});
