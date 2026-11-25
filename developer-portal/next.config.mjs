/** @type {import('next').NextConfig} */
const nextConfig = {
  // The portal renders only server components and never serves a public
  // client bundle beyond the WebAuthn ceremony helpers, so keep the output
  // self-contained for deployment behind the internal ingress.
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  headers: async () => [
    {
      source: '/admin/:path*',
      headers: [
        { key: 'Cache-Control', value: 'no-store' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
      ],
    },
  ],
};

export default nextConfig;
