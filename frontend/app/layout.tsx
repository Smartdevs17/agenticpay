import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import PWAWrapper from "@/components/PWAWrapper";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgenticPay - Get Paid Instantly for Your Work",
  description: "Secure, fast, and transparent payments for freelancers powered by blockchain technology.",
  // manifest: "/manifest.webmanifest",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Providers>
          {children}
          <PWAWrapper />
        </Providers>
      </body>
    </html>
  );
}
