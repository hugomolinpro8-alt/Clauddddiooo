import { useApp } from "./lib/store";
import { useUI, type Route } from "./ui-state";
import { Spinner } from "./components/ui";
import { Accueil } from "./pages/Accueil";
import { Aujourdhui } from "./pages/Aujourdhui";
import { Planning } from "./pages/Planning";
import { Matiere } from "./pages/Matiere";
import { NouvelleMatiere } from "./pages/NouvelleMatiere";
import { ExercicePage } from "./pages/Exercice";
import { Flashcards } from "./pages/Flashcards";
import { ExamenBlanc } from "./pages/ExamenBlanc";
import { Suivi } from "./pages/Suivi";

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: "aujourdhui", label: "Aujourd'hui", icon: "M4 12h16M12 4v16" },
  { route: "planning", label: "Planning", icon: "M4 6h16M4 12h16M4 18h10" },
  { route: "matiere", label: "Matières", icon: "M5 4h10l4 4v12H5z" },
  { route: "flashcards", label: "Cartes", icon: "M4 7h12v12H4zM8 3h12v12" },
  { route: "suivi", label: "Suivi", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

function SaveIndicator() {
  const { saveStatus, storageMode, aiLive } = useApp();
  const label = { chargement: "Chargement…", enregistre: storageMode === "cloud" ? "Enregistré" : "Enregistré sur cet appareil", enregistrement: "Enregistrement…", erreur: "Échec de sauvegarde, nouvel essai à la prochaine modification" }[saveStatus];
  return (
    <div className="flex items-center gap-3 text-xs text-muted min-w-0">
      <span className={`inline-flex items-center gap-1.5 ${saveStatus === "erreur" ? "text-bad" : ""}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${saveStatus === "enregistre" ? "bg-ok" : saveStatus === "erreur" ? "bg-bad" : "bg-warn"}`} />
        <span className="truncate">{label}</span>
      </span>
      {!aiLive && <span className="hidden sm:inline rounded bg-warn/15 text-warn px-1.5 py-0.5">IA simulée</span>}
    </div>
  );
}

export default function App() {
  const { ready, aiLive } = useApp();
  const { route, go } = useUI();

  const page = (() => {
    switch (route) {
      case "aujourdhui": return <Aujourdhui />;
      case "planning": return <Planning />;
      case "matiere": return <Matiere />;
      case "nouvelle-matiere": return <NouvelleMatiere />;
      case "exercice": return <ExercicePage />;
      case "flashcards": return <Flashcards />;
      case "examen": return <ExamenBlanc />;
      case "suivi": return <Suivi />;
      default: return <Accueil />;
    }
  })();

  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky z-20 border-b border-line bg-bg/90 backdrop-blur" style={{ top: "env(safe-area-inset-top, 0px)" }}>
        <div className="mx-auto max-w-6xl flex items-center gap-4 py-3" style={{ paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}>
          <button onClick={() => go("accueil")} className="flex items-center gap-2 shrink-0" aria-label="Accueil">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink font-display font-bold">20</span>
            <span className="font-display text-lg font-bold hidden sm:inline">Coach Partiels</span>
          </button>
          <nav className="hidden md:flex items-center gap-1 ml-4">
            {NAV.map((n) => (
              <button key={n.route} onClick={() => go(n.route)} className={`px-3 py-1.5 rounded-lg text-sm ${route === n.route ? "bg-surface border border-line font-medium" : "text-muted hover:text-ink"}`}>{n.label}</button>
            ))}
          </nav>
          <div className="ml-auto min-w-0"><SaveIndicator /></div>
        </div>
      </header>

      {!aiLive && ready && (
        <div className="bg-warn/10 border-b border-warn/30 text-sm text-warn">
          <div className="mx-auto max-w-6xl py-2" style={{ paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}>
            Le coach IA fonctionne quand l'app est ouverte sur claude.ai. Ici, ses réponses sont simulées pour que tu puisses tester l'interface.
          </div>
        </div>
      )}

      <main className="flex-1 mx-auto w-full max-w-6xl pt-5 pb-28 md:pb-12" style={{ paddingLeft: "max(16px, env(safe-area-inset-left, 0px))", paddingRight: "max(16px, env(safe-area-inset-right, 0px))" }}>
        {ready ? page : <div className="py-20 grid place-items-center text-muted"><Spinner /></div>}
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-20 border-t border-line bg-surface" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)", paddingLeft: "env(safe-area-inset-left, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}>
        <div className="grid grid-cols-5">
          {NAV.map((n) => (
            <button key={n.route} onClick={() => go(n.route)} className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${route === n.route ? "text-accent font-semibold" : "text-muted"}`}>
              <Icon d={n.icon} />
              {n.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
