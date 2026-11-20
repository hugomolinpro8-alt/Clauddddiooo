"use client";
import { Logo } from "@/components/brand/Logo";
import { useTonEntete } from "@/lib/store";

export default function Accueil() {
  useTonEntete("fonce");
  return (
    <section className="grid min-h-svh place-items-center bg-nuit px-6">
      <Logo variant="fonce" animate className="w-[min(80vw,520px)]" />
    </section>
  );
}
