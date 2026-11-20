"use client";

import { useEffect, useId, useRef, useState } from "react";
import { MoveHorizontal } from "lucide-react";
import { mod } from "@/lib/utils";

type Props = { dossier: string; images: number; extension: string; alt: string };

/**
 * Rotation 360° à partir d'une séquence de photos :
 * glisser (doigt / souris), flèches du clavier ou curseur accessible.
 * Fichiers attendus : {dossier}/01.{ext} … {dossier}/NN.{ext}
 */
export function Viewer360({ dossier, images, extension, alt }: Props) {
  const id = useId();
  const [i, setI] = useState(0);
  const [charge, setCharge] = useState(0);
  const drag = useRef<{ x: number; i: number } | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const urls = Array.from({ length: images }, (_, k) => `${dossier}/${String(k + 1).padStart(2, "0")}.${extension}`);

  // Précharge toute la séquence, puis petit tour d'introduction
  useEffect(() => {
    let annule = false;
    let n = 0;
    urls.forEach((u) => {
      const im = new Image();
      im.onload = im.onerror = () => {
        n++;
        if (!annule) setCharge(n);
      };
      im.src = u;
    });
    return () => {
      annule = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dossier, images, extension]);

  useEffect(() => {
    if (charge < images || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let k = 0;
    const t = setInterval(() => {
      k++;
      setI(mod(k, images));
      if (k >= images) clearInterval(t);
    }, 45);
    return () => clearInterval(t);
  }, [charge, images]);

  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, i };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !zone.current) return;
    const pas = zone.current.clientWidth / (images * 1.2); // ~1,2 tour sur la largeur
    setI(mod(drag.current.i - Math.round((e.clientX - drag.current.x) / pas), images));
  };
  const onUp = () => (drag.current = null);

  return (
    <div className="relative h-full w-full">
      <div
        ref={zone}
        className="relative h-full w-full cursor-ew-resize touch-pan-y select-none"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        data-lenis-prevent
      >
        {urls.map((u, k) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={u}
            src={u}
            alt={k === i ? `${alt} — vue 360°, angle ${Math.round((k * 360) / images)}°` : ""}
            aria-hidden={k !== i}
            draggable={false}
            loading={k === 0 ? "eager" : "lazy"}
            className="pointer-events-none absolute inset-0 m-auto h-full w-full object-contain p-[6%]"
            style={{ opacity: k === i ? 1 : 0 }}
          />
        ))}
        {charge < images && (
          <div className="absolute inset-x-0 bottom-4 mx-auto h-1 w-40 overflow-hidden rounded-full bg-nuit/10">
            <div className="h-full bg-nuit transition-[width]" style={{ width: `${(charge / images) * 100}%` }} />
          </div>
        )}
      </div>
      <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-3 px-6">
        <MoveHorizontal size={16} className="text-ardoise" aria-hidden="true" />
        <label htmlFor={`${id}-r`} className="sr-only">
          Angle de vue
        </label>
        <input
          id={`${id}-r`}
          type="range"
          min={0}
          max={images - 1}
          value={i}
          onChange={(e) => setI(Number(e.target.value))}
          aria-valuetext={`${Math.round((i * 360) / images)} degrés`}
          className="w-44 accent-[#0E1A2B]"
        />
      </div>
    </div>
  );
}
