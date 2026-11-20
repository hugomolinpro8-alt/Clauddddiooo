import { useState } from "react";
import { useApp } from "../lib/store";
import { useUI } from "../ui-state";
import { Badge, Button, Card, Empty, Field, Input } from "../components/ui";
import { blockLabel } from "../lib/planner";
import { diffDays, formatDay, weekdayName } from "../lib/dates";
import type { PlanBlock, PlanDay, Subject } from "../lib/types";

const KIND_LABEL: Record<string, { label: string; tone: "accent" | "pen" | "warn" | "ok" | "neutral" }> = {
  "examen-blanc": { label: "Examen blanc", tone: "pen" },
  tampon: { label: "Jour tampon", tone: "warn" },
  veille: { label: "Veille allégée", tone: "ok" },
  partiel: { label: "Partiel", tone: "pen" },
  off: { label: "Repos", tone: "neutral" },
};

export function Planning() {
  const { state, today, regeneratePlan } = useApp();
  const { go } = useUI();
  const [showPast, setShowPast] = useState(false);
  const [editAvail, setEditAvail] = useState(false);
  const plan = state.plan;
  const subjects = state.subjects;

  if (!subjects.length) return <Empty title="Pas encore de planning"><Button onClick={() => go("nouvelle-matiere")}>Ajouter une matière</Button></Empty>;
  if (!plan) return <Empty title="Aucun planning généré"><Button onClick={() => regeneratePlan()}>Générer le programme</Button></Empty>;

  const days = plan.days.filter((d) => showPast || d.date >= today);
  const lastChange = state.planChanges[0];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Rétroplanning · généré le {formatDay(plan.generatedAt.slice(0, 10), false)}</p>
          <h1 className="font-display text-3xl font-bold">Programme jusqu'au partiel</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditAvail((v) => !v)}>Mes disponibilités</Button>
          <Button size="sm" onClick={() => regeneratePlan("Replanification manuelle.")}>Replanifier</Button>
        </div>
      </div>

      {editAvail && <AvailabilityEditor onDone={() => setEditAvail(false)} />}

      {plan.warnings.length > 0 && (
        <Card className="border-warn/40 bg-warn/5 flex flex-col gap-1.5">
          <p className="font-medium text-warn">Ce que le coach doit te dire franchement</p>
          <ul className="text-sm flex flex-col gap-1 list-disc ml-5">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </Card>
      )}

      {plan.triage.filter((t) => !t.sufficient || t.sacrificed.length).map((t) => {
        const s = subjects.find((x) => x.id === t.subjectId);
        if (!s) return null;
        return (
          <Card key={t.subjectId} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-display text-lg font-semibold">Plan triage : {s.name}</p>
              <Badge tone="pen">{t.needHours} h nécessaires · {t.availableHours} h disponibles</Badge>
            </div>
            <p className="text-sm text-muted">On ne peut pas tout couvrir sérieusement. On garde ce qui rapporte le plus de points par heure de travail. Les notions sacrifiées restent en flashcards : tu sauras au moins énoncer les résultats.</p>
            <ul className="text-sm flex flex-col gap-1.5">
              {t.sacrificed.map((x) => (
                <li key={x.notionId}><strong className="font-medium">{s.notions.find((n) => n.id === x.notionId)?.title}</strong> : <span className="text-muted">{x.reason}</span></li>
              ))}
            </ul>
            <p className="text-xs text-muted">Tu n'es pas d'accord ? Change les poids ou décoche « Sacrifier » dans le rapport d'analyse, puis replanifie.</p>
          </Card>
        );
      })}

      {lastChange && (
        <Card className="flex flex-col gap-2">
          <p className="eyebrow">Dernière mise à jour du plan · {new Date(lastChange.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</p>
          <div className="grid gap-3 sm:grid-cols-2 text-sm">
            <div><p className="font-medium mb-1">Pourquoi</p><ul className="list-disc ml-5 text-muted">{lastChange.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
            <div><p className="font-medium mb-1">Ce qui a changé</p><ul className="list-disc ml-5 text-muted">{lastChange.changes.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
          </div>
          {state.planChanges.length > 1 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">Historique ({state.planChanges.length - 1} mise(s) à jour précédente(s))</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {state.planChanges.slice(1, 15).map((c) => (
                  <li key={c.id + c.date} className="text-muted"><span className="tnum">{new Date(c.date).toLocaleDateString("fr-FR")}</span> : {c.reasons.join(" ")} → {c.changes.join(" ")}</li>
                ))}
              </ul>
            </details>
          )}
        </Card>
      )}

      <div className="flex items-center gap-3">
        <label className="text-sm flex items-center gap-2"><input id="show-past" type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Afficher les jours passés</label>
      </div>

      <div className="flex flex-col gap-3">
        {days.map((d) => <DayCard key={d.date} d={d} subjects={subjects} today={today} />)}
      </div>
    </div>
  );
}

function DayCard({ d, subjects, today }: { d: PlanDay; subjects: Subject[]; today: string }) {
  const { go } = useUI();
  const isToday = d.date === today;
  const min = d.blocks.filter((b) => b.type !== "partiel").reduce((a, b) => a + b.durationMin, 0);
  const done = d.blocks.filter((b) => b.status === "done").length;
  return (
    <Card className={`flex flex-col gap-3 ${isToday ? "border-accent" : ""} ${d.date < today ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display font-semibold capitalize">{isToday ? "Aujourd'hui · " : ""}{formatDay(d.date)}</p>
        {d.kinds.filter((k) => KIND_LABEL[k]).map((k) => <Badge key={k} tone={KIND_LABEL[k].tone}>{KIND_LABEL[k].label}</Badge>)}
        <span className="ml-auto text-xs text-muted tnum">{Math.round(min / 6) / 10} h prévues{d.date <= today && d.blocks.length ? ` · ${done}/${d.blocks.length} faits` : ""}</span>
      </div>
      {d.blocks.length === 0 ? (
        <p className="text-sm text-muted">{d.capacityMin === 0 ? "Jour off (bloqué ou sans heure disponible)." : "Rien de prévu."}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {d.blocks.map((b) => <BlockRow key={b.id} b={b} subjects={subjects} />)}
        </ul>
      )}
      {d.note && <p className="text-xs text-muted">{d.note}</p>}
      {isToday && <Button size="sm" className="self-start" onClick={() => go("aujourdhui")}>Ouvrir la session du jour</Button>}
    </Card>
  );
}

export function BlockRow({ b, subjects }: { b: PlanBlock; subjects: Subject[] }) {
  const s = subjects.find((x) => x.id === b.subjectId);
  const notions = b.notionIds.map((id) => s?.notions.find((n) => n.id === id)?.title).filter(Boolean);
  const status = { done: "✓", partial: "½", skipped: "—", todo: "" }[b.status];
  return (
    <li className="grid grid-cols-[3.25rem_1fr] gap-3 text-sm items-baseline">
      <span className="font-mono tnum text-muted">{b.start}</span>
      <div className="min-w-0 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="inline-block h-2 w-2 rounded-full shrink-0 self-center" style={{ background: s?.color }} aria-hidden />
        <span className={`font-medium ${b.status === "done" ? "line-through text-muted" : ""}`}>{blockLabel(b.type)}</span>
        {b.review && <Badge tone="accent">rappel espacé</Badge>}
        <span className="text-muted">{b.durationMin} min{notions.length ? ` · ${notions.join(" + ")}` : ""}</span>
        {status && <span className="text-ok font-semibold">{status}</span>}
      </div>
    </li>
  );
}

function AvailabilityEditor({ onDone }: { onDone: () => void }) {
  const { state, update, regeneratePlan, today } = useApp();
  const a = state.availability;
  const [blocked, setBlocked] = useState(a.blockedDates.join(", "));
  return (
    <Card className="flex flex-col gap-4">
      <p className="font-display text-lg font-semibold">Disponibilités</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {a.weekly.map((w, i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-lg bg-sunken p-2.5">
            <p className="text-sm font-medium capitalize">{weekdayName(i)}</p>
            <label className="text-xs text-muted flex items-center gap-1.5">Heures
              <Input id={`av-h${i}`} type="number" min={0} max={14} step={0.5} className="py-1 px-2 tnum" value={w.hours} onChange={(e) => update((s) => { s.availability.weekly[i].hours = Number(e.target.value) || 0; })} />
            </label>
            <label className="text-xs text-muted flex items-center gap-1.5">Début
              <Input id={`av-s${i}`} type="time" className="py-1 px-2" value={w.start} onChange={(e) => update((s) => { s.availability.weekly[i].start = e.target.value; })} />
            </label>
          </div>
        ))}
      </div>
      <Field label="Jours bloqués (AAAA-MM-JJ, séparés par des virgules)" hint={`Ex. : ${today}`}>
        <Input id="av-blocked" value={blocked} onChange={(e) => setBlocked(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button onClick={() => {
          update((s) => { s.availability.blockedDates = blocked.split(/[,\s]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort(); });
          setTimeout(() => regeneratePlan("Disponibilités modifiées."), 0);
          onDone();
        }}>Enregistrer et replanifier</Button>
        <Button variant="ghost" onClick={onDone}>Fermer</Button>
      </div>
      <p className="text-xs text-muted">Il reste {state.subjects.filter((s) => s.examDate >= today).map((s) => `${diffDays(s.examDate, today)} jours avant ${s.name}`).join(", ")}.</p>
    </Card>
  );
}
