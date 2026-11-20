import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { useUI } from "../ui-state";
import { Badge, Bar, Button, Card, Empty, Grade, Select, masteryTone } from "../components/ui";
import { subjectMastery, PRIOR_BY_LEVEL, KIND_WEIGHT, HALF_LIFE_DAYS } from "../lib/mastery";
import { forecastSubject, riskyNotions, Z80 } from "../lib/forecast";
import { formatDay, diffDays } from "../lib/dates";
import type { ForecastPoint, Subject } from "../lib/types";

export function Suivi() {
  const { state, today } = useApp();
  const { subjectId, setSubjectId, go } = useUI();
  const withNotions = state.subjects.filter((s) => s.notions.length);
  const s = withNotions.find((x) => x.id === subjectId) ?? withNotions[0];
  if (!s) return <Empty title="Rien à suivre pour l'instant"><p className="text-sm text-muted">Le suivi démarre après l'analyse d'un cours.</p><Button onClick={() => go("matiere")}>Aller aux matières</Button></Empty>;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Partiel {formatDay(s.examDate)} · J-{Math.max(0, diffDays(s.examDate, today))}</p>
          <h1 className="font-display text-3xl font-bold">Suivi : {s.name}</h1>
        </div>
        {withNotions.length > 1 && (
          <Select id="suivi-subject" className="w-auto" value={s.id} onChange={(e) => setSubjectId(e.target.value)}>
            {withNotions.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        )}
      </div>
      <SubjectDashboard s={s} />
    </div>
  );
}

function SubjectDashboard({ s }: { s: Subject }) {
  const { state, today } = useApp();
  const mastery = useMemo(() => subjectMastery(s, today), [s, today]);
  const f = useMemo(() => forecastSubject(s, today, mastery), [s, today, mastery]);
  const risky = useMemo(() => riskyNotions(s, mastery), [s, mastery]);
  const history = state.forecasts.filter((p) => p.subjectId === s.id).sort((a, b) => a.date.localeCompare(b.date));

  const hours = useMemo(() => {
    let planned = 0, done = 0, futur = 0;
    for (const d of state.plan?.days ?? []) {
      for (const b of d.blocks) {
        if (b.subjectId !== s.id || b.type === "partiel") continue;
        if (d.date <= today) {
          planned += b.durationMin;
          if (b.status === "done") done += b.durationMin;
          if (b.status === "partial") done += b.durationMin / 2;
        } else futur += b.durationMin;
      }
    }
    return { planned: planned / 60, done: done / 60, futur: futur / 60 };
  }, [state.plan, s.id, today]);

  const errors = useMemo(() => {
    const c: Record<string, number> = { calcul: 0, methode: 0, redaction: 0, cours: 0 };
    for (const a of s.attempts) for (const e of a.errors ?? []) c[e.type] = (c[e.type] ?? 0) + 1;
    return c;
  }, [s.attempts]);
  const errTotal = Object.values(errors).reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col gap-2">
          <p className="eyebrow">Note prévue</p>
          <div className="flex items-end gap-4">
            <Grade value={f.expected} className="text-4xl" />
            <p className="text-sm text-muted tnum pb-1">80 % de chances<br />entre {fmt(f.low)} et {fmt(f.high)}</p>
          </div>
          <p className="text-sm">{f.expected >= s.targetGrade ? <Badge tone="ok">objectif {s.targetGrade} en vue</Badge> : <Badge tone="pen">{fmt(s.targetGrade - f.expected)} pt sous l'objectif</Badge>}</p>
          {f.mockGrade != null && <p className="text-xs text-muted">Inclut ton dernier examen blanc ({fmt(f.mockGrade)}/20).</p>}
        </Card>
        <Card className="flex flex-col gap-2">
          <p className="eyebrow">Heures de travail</p>
          <p className="font-mono text-3xl tnum">{fmt(hours.done)} <span className="text-base text-muted">/ {fmt(hours.planned)} h prévues à ce jour</span></p>
          <Bar value={hours.done} max={Math.max(hours.planned, 0.01)} tone={hours.done >= hours.planned * 0.85 ? "ok" : hours.done >= hours.planned * 0.6 ? "warn" : "bad"} />
          <p className="text-xs text-muted">Encore {fmt(hours.futur)} h au programme d'ici le partiel.</p>
        </Card>
        <Card className="flex flex-col gap-2">
          <p className="eyebrow">Notions à risque</p>
          {risky.length === 0 ? <p className="text-sm text-ok">Aucune notion importante sous 50 de maîtrise.</p> : (
            <ul className="flex flex-col gap-1.5 text-sm">
              {risky.slice(0, 4).map((n) => (
                <li key={n.id} className="flex items-center gap-2"><Badge tone="bad">{Math.round(mastery[n.id].mastery)}</Badge><span className="flex-1 min-w-0 truncate">{n.title}</span><span className="text-xs text-muted tnum">{Math.round(n.weight * 100)} %</span></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-lg font-semibold">Évolution de la note prévue</p>
          <p className="text-xs text-muted">Ligne : note prévue · zone : fourchette 80 % · pointillés : objectif {s.targetGrade}</p>
        </div>
        <ForecastChart points={history} target={s.targetGrade} />
      </Card>

      <Card className="flex flex-col gap-3">
        <p className="font-display text-lg font-semibold">Maîtrise par notion</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1 font-medium">Notion</th><th className="py-1 font-medium w-40">Maîtrise</th><th className="py-1 font-medium w-20">Essais</th><th className="py-1 font-medium w-24">Dernier essai</th><th className="py-1 font-medium w-28">Points au partiel</th></tr></thead>
            <tbody>
              {f.contributions.map((c) => {
                const n = s.notions.find((x) => x.id === c.notionId)!;
                const m = mastery[n.id];
                return (
                  <tr key={n.id} className="border-t border-line">
                    <td className="py-2 pr-2">{n.title}{n.sacrificed && <span className="ml-2"><Badge>sacrifiée</Badge></span>}</td>
                    <td className="py-2"><div className="flex items-center gap-2"><Bar value={m.mastery} tone={masteryTone(m.mastery)} /><span className="tnum w-8 text-right">{Math.round(m.mastery)}</span></div></td>
                    <td className="py-2 tnum text-muted">{m.attempts}</td>
                    <td className="py-2 tnum text-muted">{m.lastPractice ? formatDay(m.lastPractice, false) : "jamais"}</td>
                    <td className="py-2 tnum">{fmt(c.points)} <span className="text-muted">/ {fmt(c.maxPoints)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {errTotal > 0 && (
        <Card className="flex flex-col gap-3">
          <p className="font-display text-lg font-semibold">Où tu perds des points</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([["calcul", "Calcul"], ["methode", "Méthode"], ["redaction", "Rédaction"], ["cours", "Cours pas su"]] as const).map(([k, l]) => (
              <div key={k} className="rounded-lg bg-sunken p-3">
                <p className="text-xs text-muted">{l}</p>
                <p className="font-mono text-2xl tnum">{errors[k]}</p>
                <Bar value={errors[k]} max={errTotal} tone="bad" className="mt-1" />
              </div>
            ))}
          </div>
          <p className="text-sm text-muted">{advice(errors)}</p>
        </Card>
      )}

      <Card className="flex flex-col gap-3" id="methode">
        <p className="font-display text-lg font-semibold">Comment la note est calculée</p>
        <div className="grid gap-5 md:grid-cols-2 text-sm">
          <div className="flex flex-col gap-2">
            <p className="font-medium">1. Maîtrise d'une notion (0 à 100)</p>
            <ul className="list-disc ml-5 flex flex-col gap-1 text-muted">
              <li>Départ : ton niveau ressenti sur le chapitre (1→{PRIOR_BY_LEVEL[0]}, 2→{PRIOR_BY_LEVEL[1]}, 3→{PRIOR_BY_LEVEL[2]}, 4→{PRIOR_BY_LEVEL[3]}, 5→{PRIOR_BY_LEVEL[4]}), compté comme 2 essais.</li>
              <li>Chaque essai ajoute son score avec un poids : flashcard {KIND_WEIGHT.flashcard}, exercice {KIND_WEIGHT.exercice}, annale {KIND_WEIGHT.annale}, examen blanc {KIND_WEIGHT["examen-blanc"]}.</li>
              <li>Les essais anciens comptent moins : leur poids est divisé par 2 tous les {HALF_LIFE_DAYS} jours.</li>
              <li>Oubli : sans révision, la maîtrise baisse (jusqu'à −25 %), d'autant moins vite que tu as réussi la notion souvent.</li>
            </ul>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium">2. Note prévue</p>
            <p className="font-mono text-xs bg-sunken rounded p-2 overflow-x-auto">note = 20 × Σ (poids de la notion × maîtrise / 100)</p>
            <ul className="list-disc ml-5 flex flex-col gap-1 text-muted">
              <li>Le poids d'une notion vient des annales : 70 % la part des points, 30 % la fréquence d'apparition (modifiable dans le rapport d'analyse).</li>
              <li>Fourchette : plus tu as d'essais sur une notion, plus elle se resserre. Elle vaut ± {Z80} écart-type (≈ 80 % de chances), avec 1 point d'erreur de modèle incompressible.</li>
              <li>Un examen blanc de moins de 14 jours compte pour 40 % de la note prévue.</li>
              <li>Ce n'est pas une promesse : le modèle ne voit ni le stress, ni un sujet atypique.</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

function advice(e: Record<string, number>): string {
  const top = Object.entries(e).sort((a, b) => b[1] - a[1])[0][0];
  return {
    calcul: "Surtout des fautes de calcul : vérifie chaque ligne (signe, facteur oublié), et contrôle le résultat par une valeur test.",
    methode: "Surtout des erreurs de méthode : avant de calculer, écris en une phrase la méthode que tu vas suivre. Fais plus d'exercices mélangés.",
    redaction: "Surtout de la rédaction : cite les hypothèses du théorème avant de l'appliquer, et conclus chaque question par une phrase.",
    cours: "Surtout du cours pas su : priorité aux flashcards, tous les jours, avant les exercices.",
  }[top]!;
}

function fmt(x: number) {
  return (Math.round(x * 10) / 10).toFixed(1).replace(".", ",");
}

function ForecastChart({ points, target }: { points: ForecastPoint[]; target: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) {
    return <p className="text-sm text-muted">La courbe apparaît à partir du deuxième jour de suivi (un point est enregistré chaque jour et après chaque exercice).</p>;
  }
  const W = 640, H = 220, L = 34, R = 12, T = 12, B = 26;
  const x = (i: number) => L + (i / (points.length - 1)) * (W - L - R);
  const y = (v: number) => T + (1 - v / 20) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.expected)}`).join("");
  const band = points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.high)}`).join("") + [...points].reverse().map((p, k) => `L${x(points.length - 1 - k)},${y(p.low)}`).join("") + "Z";
  const ticks = [0, 5, 10, 15, 20];
  const step = Math.max(1, Math.ceil(points.length / 6));
  const h = hover != null ? points[hover] : null;
  return (
    <div className="relative overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[420px]" role="img" aria-label="Évolution de la note prévue"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1)))));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="tnum">{t}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} stroke="var(--pen)" strokeWidth={1.5} strokeDasharray="4 4" />
        <path d={band} fill="var(--accent)" fillOpacity={0.14} stroke="none" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
        <circle cx={x(points.length - 1)} cy={y(points[points.length - 1].expected)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
        {points.map((p, i) => i % step === 0 || i === points.length - 1 ? (
          <text key={p.date} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--muted)">{formatDay(p.date, false)}</text>
        ) : null)}
        {h && hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--muted)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(h.expected)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover != null && (
        <div className="pointer-events-none absolute top-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-sm tnum" style={{ left: `min(calc(${(x(hover) / W) * 100}% + 8px), calc(100% - 150px))` }}>
          <p className="font-medium">{formatDay(h.date)}</p>
          <p>Prévue : {fmt(h.expected)}/20</p>
          <p className="text-muted">Fourchette : {fmt(h.low)} – {fmt(h.high)}</p>
        </div>
      )}
    </div>
  );
}
