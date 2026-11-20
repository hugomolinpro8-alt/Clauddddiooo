import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { useUI } from "../ui-state";
import { Button, Card, Grade, Badge, Bar } from "../components/ui";
import { diffDays, formatDay } from "../lib/dates";
import { forecastSubject } from "../lib/forecast";

export function Accueil() {
  const { state, today, loadDemo } = useApp();
  const { go, setSubjectId } = useUI();
  const [loading, setLoading] = useState(false);
  const upcoming = useMemo(() => [...state.subjects].filter((s) => s.examDate >= today).sort((a, b) => a.examDate.localeCompare(b.examDate)), [state.subjects, today]);
  const day = state.plan?.days.find((d) => d.date === today);
  const done = day?.blocks.filter((b) => b.status === "done").length ?? 0;
  const total = day?.blocks.filter((b) => b.type !== "partiel").length ?? 0;

  if (!state.subjects.length) {
    return (
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] items-start py-4 sm:py-10">
        <div className="flex flex-col gap-5">
          <p className="eyebrow">Préparation intensive aux partiels · L1</p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold leading-[1.05]">Un programme jour par jour, des exercices corrigés au barème, et une note prévue honnête.</h1>
          <p className="text-muted max-w-xl">Donne au coach ton cours et tes annales. Il repère ce qui tombe vraiment, te fait travailler chaque jour en exercices plutôt qu'en relecture, et réadapte le plan quand tu prends du retard.</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => go("nouvelle-matiere")}>Ajouter ma première matière</Button>
            <Button variant="secondary" loading={loading} onClick={async () => { setLoading(true); await loadDemo(); setSubjectId("demo-analyse"); setLoading(false); go("aujourdhui"); }}>
              Essayer avec la démo (Analyse 1)
            </Button>
          </div>
        </div>
        <Card className="flex flex-col gap-4">
          <p className="eyebrow">Comment ça marche</p>
          <ol className="flex flex-col gap-3 text-sm">
            {[
              ["Onboarding", "date du partiel, durée, coefficient, heures dispo, ton niveau par chapitre, note visée."],
              ["Analyse", "chapitres → notions → théorèmes, et fréquence de chaque notion dans les annales."],
              ["Programme", "rétroplanning avec répétition espacée, examen blanc à J-3, jour tampon, veille allégée."],
              ["Chaque jour", "exercices type annale avec indices, correction notée vérifiée deux fois, flashcards."],
              ["Suivi", "maîtrise par notion, note prévue avec fourchette, replanification automatique."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3">
                <span className="tnum font-mono text-pen font-semibold w-5 shrink-0">{i + 1}</span>
                <span><strong className="font-semibold">{t}</strong> : {d}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{formatDay(today)}</p>
          <h1 className="font-display text-3xl font-bold">Compte à rebours</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => go("aujourdhui")}>{done ? "Reprendre la journée" : "Commencer la journée"}</Button>
          <Button variant="secondary" onClick={() => go("nouvelle-matiere")}>Ajouter une matière</Button>
        </div>
      </div>

      {total > 0 && (
        <Card className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-medium mb-2">Aujourd'hui : {done}/{total} blocs faits</p>
            <Bar value={done} max={total} tone={done === total ? "ok" : "accent"} />
          </div>
          <Button variant="secondary" size="sm" onClick={() => go("aujourdhui")}>Voir les blocs</Button>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {upcoming.map((s) => {
          const j = diffDays(s.examDate, today);
          const f = s.notions.length ? forecastSubject(s, today) : null;
          return (
            <Card key={s.id} className="flex flex-col gap-3 cursor-pointer hover:border-accent/50" onClick={() => { setSubjectId(s.id); go("matiere"); }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-display text-lg font-semibold truncate" style={{ color: s.color }}>{s.name}</p>
                  <p className="text-sm text-muted">{formatDay(s.examDate)} à {s.examTime} · coef. {s.coef}</p>
                </div>
                <span className="font-mono text-2xl font-semibold tnum shrink-0">{j === 0 ? "Jour J" : `J-${j}`}</span>
              </div>
              {f ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-muted">Note prévue<br /><span className="tnum">entre {f.low.toFixed(1).replace(".", ",")} et {f.high.toFixed(1).replace(".", ",")}</span></div>
                  <Grade value={f.expected} className="text-2xl" />
                </div>
              ) : (
                <Badge tone="warn">Cours pas encore analysé</Badge>
              )}
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>Objectif {s.targetGrade}/20</span>
                {f && (f.expected >= s.targetGrade ? <Badge tone="ok">en bonne voie</Badge> : <Badge tone="pen">{(s.targetGrade - f.expected).toFixed(1).replace(".", ",")} pt à aller chercher</Badge>)}
              </div>
            </Card>
          );
        })}
      </div>
      {state.subjects.some((s) => s.examDate < today) && (
        <p className="text-sm text-muted">Les matières dont le partiel est passé restent consultables dans « Matières ».</p>
      )}
    </div>
  );
}
