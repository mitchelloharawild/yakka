import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import { AppHeader } from "@/components/app-header";
import { Providers } from "@/components/providers";
import { OfflineQueueIndicator } from "@/components/pwa/offline-queue-indicator";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Yakka", template: "%s · Yakka" },
  description: "Share the yakka: account-less household chores, ticked off with a tap.",
  applicationName: "Yakka",
  // PWA (Agent D): iOS home-screen app; the manifest link comes from app/manifest.ts.
  appleWebApp: { capable: true, title: "Yakka", statusBarStyle: "default" },
  icons: { icon: "/icons/icon.svg", apple: "/apple-touch-icon.png" },
  other: { "apple-mobile-web-app-capable": "yes" }, // iOS < 16.4 ignores the manifest
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>
          <Providers>
            <AppHeader />
            <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-6">{children}</main>
            <ServiceWorkerRegistration />
            <OfflineQueueIndicator variant="floating" announce />
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
