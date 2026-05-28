import type { NextConfig } from "next";
import bundleAnalyzer from "@next/bundle-analyzer";

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Transpile heavy Web3 packages so they tree-shake correctly under Next.js
  transpilePackages: [
    "@web3auth/modal",
    "@web3auth/base",
    "@web3auth/ethereum-provider",
    "@walletconnect/ethereum-provider",
  ],

  webpack(config, { isServer }) {
    // Suppress critical-dependency warnings from Web3Auth / WalletConnect
    config.ignoreWarnings = [
      { module: /node_modules\/@walletconnect/ },
      { module: /node_modules\/@web3auth/ },
    ];

    // Provide empty shims for Node.js built-ins used by crypto libs in the browser
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };
    }

    return config;
  },

  // Compress responses
  compress: true,

  // Strict mode for better tree-shaking hints
  reactStrictMode: true,

  // Optimise images
  images: {
    formats: ["image/avif", "image/webp"],
  },

  // Experimental: optimise package imports so only used icons/components are bundled
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-avatar",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-label",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-slot",
      "@radix-ui/react-tabs",
    ],
  },
};

export default withBundleAnalyzer(nextConfig);
