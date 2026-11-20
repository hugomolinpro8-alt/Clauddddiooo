import type { Metadata } from "next";
import { TechnologieVue } from "@/components/tech/TechnologieVue";
import { Footer } from "@/components/layout/Footer";

export const metadata: Metadata = {
  title: "Technologie",
  description: "Écran, verre, anti-buée, ventilation, confort, sangle : tout ce qui fait un bon masque de ski.",
  alternates: { canonical: "/technologie" },
};

export default function Page() {
  return (
    <>
      <TechnologieVue />
      <Footer />
    </>
  );
}
