"use client";

import dynamic from "next/dynamic";

/**
 * Calques non nécessaires au premier affichage : chargés après l'hydratation
 * (allège le JavaScript initial → meilleur LCP / TBT sur mobile).
 */
const Menu = dynamic(() => import("./Menu").then((m) => m.Menu), { ssr: false });
const CartDrawer = dynamic(() => import("@/components/cart/CartDrawer").then((m) => m.CartDrawer), { ssr: false });
const CookieBanner = dynamic(() => import("./CookieBanner").then((m) => m.CookieBanner), { ssr: false });
const RideauNavigation = dynamic(() => import("./RideauNavigation").then((m) => m.RideauNavigation), { ssr: false });

export function CalquesDifferes() {
  return (
    <>
      <Menu />
      <CartDrawer />
      <RideauNavigation />
      <CookieBanner />
    </>
  );
}
