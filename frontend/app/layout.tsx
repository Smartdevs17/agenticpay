import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import { Providers } from "@/components/providers";
import PWAWrapper from "@/components/PWAWrapper";
import { LanguageProvider } from "@/components/providers/LanguageProvider";
import { OfflineProvider } from "@/components/offline/OfflineProvider";

// Using system fonts defined in globals.css to avoid network dependencies during build


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
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // The CSP set in middleware.ts uses a fresh nonce per request (#1466). Next.js
  // can only stamp that nonce on its scripts when the page renders per request;
  // a statically prerendered page would ship scripts without it, and the strict
  // policy would block them. This opts every route under the root layout into
  // dynamic rendering.
  await connection();

  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <body
        className="antialiased font-sans"
      >
        <Providers>
          <LanguageProvider>
            <OfflineProvider>{children}</OfflineProvider>
          </LanguageProvider>
          <PWAWrapper />
        </Providers>
      </body>
    </html>
  );
}
