import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import PWAWrapper from "@/components/PWAWrapper";
import { LanguageProvider } from "@/components/providers/LanguageProvider";
import { OfflineProvider } from "@/components/offline/OfflineProvider";
import { WebVitals } from "@/components/WebVitals";

const APP_DOMAIN = process.env.NEXT_PUBLIC_API_URL || "https://agenticpay.com";
const RPC_DOMAIN = process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.agenticpay.com";
const CDN_DOMAIN = process.env.NEXT_PUBLIC_IMAGE_CDN_DOMAIN || "cdn.agenticpay.com";

export const metadata: Metadata = {
  title: "AgenticPay - Get Paid Instantly for Your Work",
  description: "Secure, fast, and transparent payments for freelancers powered by blockchain technology.",
  manifest: "/manifest.webmanifest",
  keywords: ["freelancer", "payments", "blockchain", "crypto", "web3", "escrow", "milestones"],
  authors: [{ name: "AgenticPay" }],
  openGraph: {
    title: "AgenticPay - Get Paid Instantly for Your Work",
    description: "Secure, fast, and transparent payments for freelancers powered by blockchain technology.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgenticPay - Get Paid Instantly for Your Work",
    description: "Secure, fast, and transparent payments for freelancers powered by blockchain technology.",
  },
  other: {
    "link-critical": "true",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href={APP_DOMAIN} crossOrigin="anonymous" />
        <link rel="preconnect" href={CDN_DOMAIN} crossOrigin="anonymous" />
        <link rel="preconnect" href={RPC_DOMAIN} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={APP_DOMAIN} />
        <link rel="dns-prefetch" href={CDN_DOMAIN} />
        <link rel="dns-prefetch" href={RPC_DOMAIN} />
        <link rel="preload" href="/fonts/inter-var.woff2" as="font" type="font/woff2" crossOrigin="anonymous" fetchPriority="high" />
        <link rel="preload" href="/manifest.webmanifest" as="fetch" crossOrigin="anonymous" />
      </head>
      <body
        className="antialiased font-sans"
      >
        <Providers>
          <LanguageProvider>
            <OfflineProvider>
              {children}
              <WebVitals />
            </OfflineProvider>
          </LanguageProvider>
          <PWAWrapper />
        </Providers>
      </body>
    </html>
  );
}
