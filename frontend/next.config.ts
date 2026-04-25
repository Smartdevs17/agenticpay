import type { NextConfig } from "next";
import withBundleAnalyzer from "@next/bundle-analyzer";

const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  experimental: {
    optimizePackageImports: ["lucide-react", "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-select", "@radix-ui/react-popover", "@radix-ui/react-tabs", "@radix-ui/react-avatar", "@radix-ui/react-label"],
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
              const moduleContext = typeof module?.context === "string" ? module.context : "";
              return (
                !moduleContext.match(/[\\/]node_modules[\\/]/) ||
                /lodash/.test(moduleContext) ||
                /moment/.test(moduleContext)
              );
            },
            name(module: any) {
              const moduleContext = typeof module?.context === "string" ? module.context : "";
              const packageName = moduleContext.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)?.[1] || "vendors";
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

export default bundleAnalyzer(nextConfig);
