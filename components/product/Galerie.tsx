"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { Box, Images, Rotate3d } from "lucide-react";
import type { Produit } from "@/lib/commerce/types";
import { cn } from "@/lib/utils";
import { Viewer360 } from "./Viewer360";

// Three.js n'est chargé que si l'utilisateur ouvre la vue 3D
const Viewer3D = dynamic(() => import("./Viewer3D"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-sm text-ardoise">Chargement de la vue 3D…</div>,
});

type Vue = "photos" | "360" | "3d";

export function Galerie({ produit }: { produit: Produit }) {
  const [vue, setVue] = useState<Vue>("photos");
  const [photo, setPhoto] = useState(0);
  const onglets: { id: Vue; label: string; icone: typeof Images; dispo: boolean }[] = [
    { id: "photos", label: "Photos", icone: Images, dispo: produit.photos.length > 0 },
    { id: "360", label: "360°", icone: Rotate3d, dispo: !!produit.sequence360 },
    { id: "3d", label: "3D", icone: Box, dispo: true },
  ];

  return (
    <div className="lg:sticky lg:top-24">
      <div className="relative aspect-square w-full overflow-hidden rounded-[32px] bg-[#E9EEF3]">
        <AnimatePresence mode="wait" initial={false}>
          <m.div
            key={vue + (vue === "photos" ? photo : "")}
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute inset-0"
          >
            {vue === "photos" && (
              <Image src={produit.photos[photo]} alt={`${produit.nom} — photo ${photo + 1}`} fill preload sizes="(max-width: 1024px) 100vw, 55vw" className="object-cover" />
            )}
            {vue === "360" && produit.sequence360 && <Viewer360 {...produit.sequence360} alt={produit.nom} />}
            {vue === "3d" && <Viewer3D glb={produit.modele3d} teinte={produit.teinteVerre} />}
          </m.div>
        </AnimatePresence>

        <div role="tablist" aria-label="Type de vue" className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 gap-1 rounded-full bg-white/80 p-1 backdrop-blur">
          {onglets
            .filter((o) => o.dispo)
            .map((o) => (
              <button
                key={o.id}
                role="tab"
                type="button"
                aria-selected={vue === o.id}
                onClick={() => setVue(o.id)}
                className={cn("label flex h-9 items-center gap-1.5 rounded-full px-4 text-[10px] transition-colors", vue === o.id ? "bg-nuit text-white" : "text-nuit hover:bg-nuit/5")}
              >
                <o.icone size={14} aria-hidden="true" /> {o.label}
              </button>
            ))}
        </div>
        {vue === "3d" && <p className="label pointer-events-none absolute bottom-4 left-0 right-0 text-center text-[10px] text-ardoise">Glissez pour tourner · pincez pour zoomer</p>}
      </div>

      {vue === "photos" && produit.photos.length > 1 && (
        <ul className="mt-3 grid grid-cols-4 gap-3" aria-label="Choisir une photo">
          {produit.photos.map((src, i) => (
            <li key={src}>
              <button
                type="button"
                onClick={() => setPhoto(i)}
                aria-label={`Photo ${i + 1}`}
                aria-current={i === photo ? "true" : undefined}
                className={cn("relative block aspect-square w-full overflow-hidden rounded-2xl ring-2 transition", i === photo ? "ring-nuit" : "ring-transparent opacity-70 hover:opacity-100")}
                style={{ borderRadius: 16 }}
              >
                <Image src={src} alt="" fill sizes="120px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
