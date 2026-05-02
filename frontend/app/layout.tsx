import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import PWAWrapper from "@/components/PWAWrapper";
import { LanguageProvider } from "@/components/providers/LanguageProvider";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <body
        className="antialiased font-sans"
      >
        <Providers>
          <LanguageProvider>
            {children}
          </LanguageProvider>
          <PWAWrapper />
        </Providers>
      </body>
    </html>
  );
}
