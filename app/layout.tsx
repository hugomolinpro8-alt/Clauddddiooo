import type { Metadata, Viewport } from "next";
import "./globals.css";
import { anton, fraunces, inter } from "@/lib/fonts";
import { SITE } from "@/lib/config";
import { getProduits } from "@/lib/commerce";
import { Providers } from "@/lib/store";
import { SmoothScroll } from "@/components/layout/SmoothScroll";
import { Header } from "@/components/layout/Header";
import { Menu } from "@/components/layout/Menu";
import { CookieBanner } from "@/components/layout/CookieBanner";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { Annonceur } from "@/components/layout/Annonceur";
import { RideauNavigation } from "@/components/layout/RideauNavigation";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: "GOGGLES — Masques de ski authentiques", template: "%s — GOGGLES" },
  description: SITE.description,
  applicationName: SITE.nom,
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/brand/goggles-icone.svg", type: "image/svg+xml" },
      { url: "/brand/goggles-icone-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/brand/goggles-icone-180.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: SITE.nom,
    locale: "fr_FR",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "GOGGLES" }],
  },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: "#0E1A2B",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const produits = await getProduits();
  return (
    <html lang="fr" className={`${anton.variable} ${inter.variable} ${fraunces.variable}`}>
      <body>
        <a href="#contenu" className="sr-only-focusable fixed left-4 top-4 z-[100] rounded-full bg-orange px-5 py-3 text-sm font-semibold text-white">
          Aller au contenu
        </a>
        <Providers produits={produits}>
          <SmoothScroll>
            <Header />
            <Menu />
            <CartDrawer />
            <main id="contenu">{children}</main>
            <RideauNavigation />
            <CookieBanner />
            <Annonceur />
          </SmoothScroll>
        </Providers>
      </body>
    </html>
  );
}
