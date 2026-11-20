import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { useUI } from "../ui-state";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Segmented, Textarea } from "../components/ui";
import { MathText } from "../components/MathText";
import { blockLabel, describeDay } from "../lib/planner";
import { diffDays, formatDay } from "../lib/dates";
import { coachMessage } from "../lib/ai/tasks";
import { errorMessage } from "../lib/ai/client";
import { forecastSubject, riskyNotions } from "../lib/forecast";
import { subjectMastery } from "../lib/mastery";
import type { AppState, PlanBlock, CheckIn } from "../lib/types";

function coachContext(state: AppState, today: string, extra: string) {
  const day = state.plan?.days.find((d) => d.date === today);
  const lines = state.subjects.filter((s) => s.examDate >= today).map((s) => {
    const m = subjectMastery(s, today);
    const f = s.notions.length ? forecastSubject(s, today, m) : null;
    const risk = riskyNotions(s, m).slice(0, 3).map((n) => n.title);
    return `- ${s.name} : partiel ${formatDay(s.examDate)} (J-${diffDays(s.examDate, today)}), coef ${s.coef}, objectif ${s.targetGrade}/20${f ? `, note prévue ${f.expected} [${f.low}-${f.high}]` : ""}${risk.length ? `, notions à risque : ${risk.join(", ")}` : ""}`;
  });
  return [`Date : ${formatDay(today)}`, "Matières :", ...lines, day ? "Plan du jour :\n" + describeDay(day, state.subjects) : "Aucun bloc prévu aujourd'hui.", extra].join("\n");
}

export function Aujourdhui() {
  const { state, today } = useApp();
  const { go } = useUI();
  const day = state.plan?.days.find((d) => d.date === today);
  const checkin = state.checkins.find((c) => c.date === today);

  if (!state.subjects.length) return <Empty title="Rien à faire pour l'instant"><Button onClick={() => go("nouvelle-matiere")}>Ajouter une matière</Button></Empty>;

  const blocks = day?.blocks ?? [];
  const work = blocks.filter((b) => b.type !== "partiel");
  const doneMin = work.filter((b) => b.status === "done").reduce((a, b) => a + b.durationMin, 0) + work.filter((b) => b.status === "partial").reduce((a, b) => a + b.durationMin / 2, 0);
  const totalMin = work.reduce((a, b) => a + b.durationMin, 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow capitalize">{formatDay(today)}</p>
          <h1 className="font-display text-3xl font-bold">Aujourd'hui</h1>
        </div>
        {totalMin > 0 && <p className="text-sm text-muted tnum">{Math.round(doneMin / 6) / 10} h faites sur {Math.round(totalMin / 6) / 10} h prévues</p>}
      </div>

      <CheckInCard checkin={checkin} plannedMin={day?.capacityMin ?? 0} />

      {!day || blocks.length === 0 ? (
        <Empty title="Aucun bloc aujourd'hui">
          <p className="text-sm text-muted">{day?.capacityMin === 0 ? "Jour off prévu. Si tu as quand même du temps : 20 min de flashcards." : "Le plan n'a rien prévu aujourd'hui."}</p>
          <Button variant="secondary" onClick={() => go("flashcards")}>Faire mes flashcards</Button>
        </Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {blocks.map((b) => <BlockCard key={b.id} b={b} date={today} />)}
        </div>
      )}

      <BilanCard checkin={checkin} />
    </div>
  );
}

function CheckInCard({ checkin, plannedMin }: { checkin?: CheckIn; plannedMin: number }) {
  const { state, today, saveCheckin, regeneratePlan } = useApp();
  const [energy, setEnergy] = useState(3);
  const [hours, setHours] = useState(Math.round(plannedMin / 30) / 2);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (checkin && !open) {
    return (
      <Card className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium">Check-in du matin</p>
          <Badge>énergie {checkin.energy}/5</Badge>
          <Badge>{checkin.availableHours} h dispo</Badge>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setEnergy(checkin.energy); setHours(checkin.availableHours); setNote(checkin.note ?? ""); setOpen(true); }}>Modifier</Button>
        </div>
        {checkin.coachMessage && <div className="border-l-2 border-accent pl-3 text-[15px]"><MathText text={checkin.coachMessage} /></div>}
      </Card>
    );
  }

  async function submit() {
    setBusy(true); setError(null); setMsg("");
    const c: CheckIn = { date: today, energy, availableHours: hours, note: note || undefined, bilan: checkin?.bilan };
    saveCheckin(c); // enregistré avant l'appel IA
    if (Math.abs(hours * 60 - plannedMin) >= 30) regeneratePlan(`Check-in : ${hours} h disponibles aujourd'hui.`);
    try {
      const text = await coachMessage("checkin", coachContext(state, today, `Check-in de l'étudiant : énergie ${energy}/5, ${hours} h réellement disponibles aujourd'hui (${Math.round(plannedMin / 6) / 10} h prévues).${note ? ` Il ajoute : « ${note} »` : ""}`), { onText: setMsg });
      saveCheckin({ ...c, coachMessage: text });
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div>
        <p className="font-display text-lg font-semibold">Check-in</p>
        <p className="text-sm text-muted">Deux réponses honnêtes et le coach ajuste la journée.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Énergie (1 = épuisé, 5 = en pleine forme)">
          <Segmented id="ci-energy" value={energy} onChange={setEnergy} options={[1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
        </Field>
        <Field label="Temps réellement disponible aujourd'hui (h)" hint={`Prévu : ${Math.round(plannedMin / 6) / 10} h`}>
          <Input id="ci-hours" type="number" min={0} max={14} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </Field>
      </div>
      <Field label="Quelque chose à signaler ? (facultatif)">
        <Textarea id="ci-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="TD à rendre, rendez-vous, notion qui t'inquiète…" />
      </Field>
      {msg && <div className="border-l-2 border-accent pl-3"><MathText text={msg} /></div>}
      <ErrorBox error={error} onRetry={submit} />
      <Button className="self-start" loading={busy} onClick={submit}>Valider le check-in</Button>
    </Card>
  );
}

function BlockCard({ b, date }: { b: PlanBlock; date: string }) {
  const { state, setBlockStatus } = useApp();
  const { startWork } = useUI();
  const [showFiche, setShowFiche] = useState(false);
  const s = state.subjects.find((x) => x.id === b.subjectId);
  const notions = b.notionIds.map((id) => s?.notions.find((n) => n.id === id)).filter(Boolean);
  const done = b.status === "done";

  const start = () => {
    if (!s) return;
    if (b.type === "exercices" || b.type === "annale" || b.type === "mini-cours") startWork({ kind: "exercice", subjectId: s.id, notionIds: b.notionIds, mode: b.type, blockId: b.id, date });
    else if (b.type === "flashcards") startWork({ kind: "flashcards", subjectId: s.id, blockId: b.id, date });
    else if (b.type === "examen-blanc" || b.type === "correction-examen") startWork({ kind: "examen", subjectId: s.id, blockId: b.id, date });
    else setShowFiche((v) => !v);
  };

  return (
    <Card data-block={b.type} className={`flex flex-col gap-3 ${done ? "opacity-60" : ""} ${b.type === "partiel" ? "border-pen" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="font-mono tnum text-muted pt-0.5 w-12 shrink-0">{b.start}</div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: s?.color }} aria-hidden />
            <span className="font-display font-semibold">{blockLabel(b.type)}</span>
            <span className="text-sm text-muted">{s?.name} · {b.durationMin} min</span>
            {b.review && <Badge tone="accent">rappel espacé</Badge>}
            {done && <Badge tone="ok">fait</Badge>}
            {b.status === "skipped" && <Badge>sauté</Badge>}
            {b.status === "partial" && <Badge tone="warn">en partie</Badge>}
          </div>
          {notions.length > 0 && <p className="text-sm font-medium">{notions.map((n) => n!.title).join(" + ")}</p>}
          <p className="text-sm text-muted">{b.objective}</p>
        </div>
      </div>
      {b.type !== "partiel" && (
        <div className="flex flex-wrap gap-2 sm:pl-[3.75rem]">
          {!done && <Button size="sm" onClick={start}>{b.type === "fiches" || b.type === "tampon" ? (showFiche ? "Masquer" : "Ouvrir") : b.status === "todo" ? "Commencer" : "Reprendre"}</Button>}
          {!done && <Button size="sm" variant="secondary" onClick={() => setBlockStatus(date, b.id, "done")}>Marquer fait</Button>}
          {b.status === "todo" && <Button size="sm" variant="ghost" onClick={() => setBlockStatus(date, b.id, "skipped")}>Sauter</Button>}
          {b.status !== "todo" && <Button size="sm" variant="ghost" onClick={() => setBlockStatus(date, b.id, "todo")}>Annuler</Button>}
        </div>
      )}
      {showFiche && s && (
        <div className="rounded-lg bg-sunken p-3 flex flex-col gap-3 sm:ml-[3.75rem]">
          {b.type === "tampon" ? (
            <p className="text-sm">Commence par les blocs sautés ou non finis des jours précédents (onglet Planning, cases « Afficher les jours passés »). Sinon : une annale complète en temps limité, depuis l'écran Examen blanc.</p>
          ) : (
            <>
              <p className="text-sm font-medium">Fiche de veille : relis, puis cache et redis chaque énoncé à voix haute.</p>
              {s.notions.filter((n) => !n.sacrificed).map((n) => (
                <div key={n.id}>
                  <p className="text-sm font-semibold">{n.title}</p>
                  <ul className="text-sm flex flex-col gap-1 mt-1">{n.items.map((it) => <li key={it.id}><MathText text={`**${it.title}** : ${it.statement}`} /></li>)}</ul>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Card>
  );
}

function BilanCard({ checkin }: { checkin?: CheckIn }) {
  const { state, today, saveCheckin } = useApp();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stats = useMemo(() => {
    const day = state.plan?.days.find((d) => d.date === today);
    const work = day?.blocks.filter((b) => b.type !== "partiel") ?? [];
    const attempts = state.subjects.flatMap((s) => s.attempts.filter((a) => a.date.slice(0, 10) === today).map((a) => ({ ...a, subject: s.name })));
    const ex = attempts.filter((a) => a.kind !== "flashcard");
    const fc = attempts.filter((a) => a.kind === "flashcard");
    return {
      done: work.filter((b) => b.status === "done").length, total: work.length,
      text: `Blocs faits : ${work.filter((b) => b.status === "done").length}/${work.length} (sautés : ${work.filter((b) => b.status === "skipped").length}).
Exercices corrigés aujourd'hui : ${ex.length}${ex.length ? `, score moyen ${Math.round((ex.reduce((s, a) => s + a.score, 0) / ex.length) * 100)} %` : ""}. Erreurs : ${ex.flatMap((a) => a.errors ?? []).map((e) => e.type).join(", ") || "aucune notée"}.
Flashcards revues : ${fc.length}${fc.length ? `, réussite ${Math.round((fc.filter((a) => a.score >= 0.6).length / fc.length) * 100)} %` : ""}.`,
    };
  }, [state, today]);

  async function run() {
    setBusy(true); setError(null); setMsg("");
    try {
      const text = await coachMessage("bilan", coachContext(state, today, "Bilan chiffré de la journée :\n" + stats.text), { onText: setMsg });
      saveCheckin({ ...(checkin ?? { date: today, energy: 3, availableHours: 0 }), bilan: { message: text, createdAt: new Date().toISOString() } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-lg font-semibold">Bilan de fin de journée</p>
        <span className="text-sm text-muted tnum">{stats.done}/{stats.total} blocs</span>
      </div>
      {checkin?.bilan && !msg ? (
        <div className="border-l-2 border-pen pl-3"><MathText text={checkin.bilan.message} /></div>
      ) : msg ? (
        <div className="border-l-2 border-pen pl-3"><MathText text={msg} /></div>
      ) : (
        <p className="text-sm text-muted">À faire le soir : le coach compare le prévu et le réalisé, et te dit ce qui change demain. Le plan se réadapte automatiquement à la prochaine ouverture.</p>
      )}
      <ErrorBox error={error} onRetry={run} />
      <Button variant="secondary" className="self-start" loading={busy} onClick={run}>{checkin?.bilan ? "Refaire le bilan" : "Faire le bilan"}</Button>
    </Card>
  );
}
