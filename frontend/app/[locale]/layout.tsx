import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { routing, rtlLocales, type AppLocale } from '@/i18n/routing';
import { Providers } from '@/components/providers';
import PWAWrapper from '@/components/PWAWrapper';
import { OfflineProvider } from '@/components/offline/OfflineProvider';
import { WebVitals } from '@/components/WebVitals';

const APP_DOMAIN = process.env.NEXT_PUBLIC_API_URL || 'https://agenticpay.com';
const CDN_DOMAIN = process.env.NEXT_PUBLIC_IMAGE_CDN_DOMAIN || 'cdn.agenticpay.com';
const RPC_DOMAIN = process.env.NEXT_PUBLIC_RPC_URL || 'https://rpc.agenticpay.com';

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'metadata' });

  const languages: Record<string, string> = {};
  for (const loc of routing.locales) {
    languages[loc] = loc === routing.defaultLocale ? '/' : `/${loc}`;
  }

  return {
    title: t('title'),
    description: t('description'),
    alternates: { languages },
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
      locale,
    },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as AppLocale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();
  const dir = rtlLocales.includes(locale as AppLocale) ? 'rtl' : 'ltr';

  return (
    <html lang={locale} dir={dir} className="scroll-smooth" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href={APP_DOMAIN} crossOrigin="anonymous" />
        <link rel="preconnect" href={CDN_DOMAIN} crossOrigin="anonymous" />
        <link rel="preconnect" href={RPC_DOMAIN} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={APP_DOMAIN} />
        <link rel="dns-prefetch" href={CDN_DOMAIN} />
        <link rel="dns-prefetch" href={RPC_DOMAIN} />
        <link
          rel="preload"
          href="/fonts/inter-var.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
          fetchPriority="high"
        />
        <link rel="preload" href="/manifest.webmanifest" as="fetch" crossOrigin="anonymous" />
      </head>
      <body className="antialiased font-sans">
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <OfflineProvider>
              {children}
              <WebVitals />
            </OfflineProvider>
            <PWAWrapper />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
