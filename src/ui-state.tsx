import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Route = "accueil" | "aujourdhui" | "planning" | "matiere" | "nouvelle-matiere" | "exercice" | "flashcards" | "examen" | "suivi";
const ROUTES: Route[] = ["accueil", "aujourdhui", "planning", "matiere", "nouvelle-matiere", "exercice", "flashcards", "examen", "suivi"];

export type WorkTarget =
  | { kind: "exercice"; subjectId: string; notionIds: string[]; mode: "exercices" | "annale" | "mini-cours"; blockId?: string; date?: string; exerciseId?: string }
  | { kind: "flashcards"; subjectId?: string; blockId?: string; date?: string }
  | { kind: "examen"; subjectId: string; blockId?: string; date?: string; mockId?: string };

interface UI {
  route: Route;
  go: (r: Route) => void;
  subjectId: string | null;
  setSubjectId: (id: string | null) => void;
  work: WorkTarget | null;
  startWork: (w: WorkTarget) => void;
}
const Ctx = createContext<UI | null>(null);
export const useUI = () => useContext(Ctx)!;

function read<T>(k: string, d: T): T {
  try { const s = localStorage.getItem(k); return s ? (JSON.parse(s) as T) : d; } catch { return d; }
}
function write(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage bloqué */ }
}

function routeFromHash(): Route {
  const h = location.hash.replace(/^#/, "") as Route;
  return ROUTES.includes(h) ? h : "accueil";
}

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [subjectId, setSid] = useState<string | null>(() => read("ui:subject", null));
  const [work, setWork] = useState<WorkTarget | null>(() => read("ui:work", null));
  useEffect(() => {
    const on = () => { setRoute(routeFromHash()); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = useCallback((r: Route) => {
    if (location.hash !== "#" + r) location.hash = r; else setRoute(r);
  }, []);
  const setSubjectId = useCallback((id: string | null) => { setSid(id); write("ui:subject", id); }, []);
  const startWork = useCallback((w: WorkTarget) => {
    setWork(w); write("ui:work", w);
    go(w.kind === "exercice" ? "exercice" : w.kind === "flashcards" ? "flashcards" : "examen");
  }, [go]);
  return <Ctx.Provider value={{ route, go, subjectId, setSubjectId, work, startWork }}>{children}</Ctx.Provider>;
}
