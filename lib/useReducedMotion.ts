"use client";
import { useSyncExternalStore } from "react";

const q = "(prefers-reduced-motion: reduce)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(q);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
export const useMouvementReduit = () =>
  useSyncExternalStore(subscribe, () => window.matchMedia(q).matches, () => false);
