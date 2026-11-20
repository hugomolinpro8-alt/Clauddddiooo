import { useEffect, useRef, useState } from "react";
import { useApp, uid } from "../lib/store";
import { useUI } from "../ui-state";
import { Badge, Button, Card, Empty, ErrorBox, Grade, Select, Textarea } from "../components/ui";
import { MathText } from "../components/MathText";
import { generateMockExam, correctAnswer } from "../lib/ai/tasks";
import { errorMessage } from "../lib/ai/client";
import { CorrectionView } from "./Exercice";
import type { MockExam, Subject } from "../lib/types";

export function ExamenBlanc() {
  const { state } = useApp();
  const { work, subjectId, setSubjectId } = useUI();
  const ctx = work?.kind === "examen" ? work : null;
  const sid = ctx?.subjectId ?? subjectId ?? state.subjects[0]?.id;
  const s = state.subjects.find((x) => x.id === sid);
  if (!s) return <Empty title="Aucune matière" />;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{s.durationMin} min · {s.docsAllowed ? "documents autorisés" : "sans documents"} · noté sur 20</p>
          <h1 className="font-display text-3xl font-bold">Examen blanc : {s.name}</h1>
        </div>
        {state.subjects.length > 1 && (
          <Select id="mock-subject" className="w-auto" value={s.id} onChange={(e) => setSubjectId(e.target.value)}>
            {state.subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </Select>
        )}
      </div>
      <MockHome s={s} blockId={ctx?.blockId} date={ctx?.date} />
    </div>
  );
}

function MockHome({ s, blockId, date }: { s: Subject; blockId?: string; date?: string }) {
  const { updateSubject } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = [...s.mockExams].reverse().find((m) => m.status !== "corrige");
  const [viewId, setViewId] = useState<string | null>(active?.id ?? null);
  const view = s.mockExams.find((m) => m.id === viewId);

  async function create() {
    setBusy(true); setError(null);
    try {
      const exercises = await generateMockExam(s);
      const m: MockExam = { id: uid("mock-"), subjectId: s.id, createdAt: new Date().toISOString(), durationMin: s.durationMin, exercises, answers: {}, corrections: {}, status: "pret" };
      updateSubject(s.id, (x) => { x.mockExams.push(m); });
      setViewId(m.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (view) return <MockRunner s={s} m={view} blockId={blockId} date={date} onBack={() => setViewId(null)} />;

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr] items-start">
      <Card className="flex flex-col gap-3">
        <p className="font-display text-lg font-semibold">Nouveau sujet</p>
        <ul className="text-sm list-disc ml-5 flex flex-col gap-1 text-muted">
          <li>Sujet inédit construit sur le modèle de tes annales, total 20 points.</li>
          <li>Chronomètre de {s.durationMin} min, non stoppable : copie ramassée automatiquement à la fin.</li>
          <li>Pas d'indice pendant l'épreuve. Téléphone dans une autre pièce.</li>
          <li>Correction complète au barème, exercice par exercice, puis note sur 20.</li>
        </ul>
        {!s.notions.length && <p className="text-sm text-warn">Analyse d'abord ton cours et tes annales pour un sujet fidèle.</p>}
        <ErrorBox error={error} onRetry={create} />
        <Button className="self-start" loading={busy} onClick={create}>{busy ? "Rédaction du sujet (1 à 3 min)…" : "Générer le sujet"}</Button>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="font-display text-lg font-semibold">Historique</p>
        {s.mockExams.length === 0 ? <p className="text-sm text-muted">Aucun examen blanc pour l'instant. L'idéal : un à J-4/J-3, dans les conditions réelles.</p> : (
          <ul className="flex flex-col divide-y divide-line">
            {[...s.mockExams].reverse().map((m) => (
              <li key={m.id} className="py-2 flex items-center gap-3">
                <span className="text-sm flex-1 min-w-0">{new Date(m.createdAt).toLocaleDateString("fr-FR")} · {m.exercises.length} exercices</span>
                {m.grade != null ? <Grade value={m.grade} /> : <Badge>{m.status}</Badge>}
                <Button size="sm" variant="secondary" onClick={() => setViewId(m.id)}>Ouvrir</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function MockRunner({ s, m, blockId, date, onBack }: { s: Subject; m: MockExam; blockId?: string; date?: string; onBack: () => void }) {
  const { updateSubject, recordAttempts, setBlockStatus } = useApp();
  const now = useNow(m.status === "en-cours");
  const endsAt = m.startedAt ? Date.parse(m.startedAt) + m.durationMin * 60_000 : 0;
  const remaining = Math.max(0, endsAt - now);
  const [answers, setAnswers] = useState<Record<string, string>>(m.answers);
  const [correcting, setCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const submitted = useRef(false);

  const setM = (fn: (x: MockExam) => void) => updateSubject(s.id, (x) => { const y = x.mockExams.find((k) => k.id === m.id); if (y) fn(y); });

  // Sauvegarde des réponses pendant l'épreuve
  useEffect(() => {
    if (m.status !== "en-cours") return;
    const t = setTimeout(() => setM((x) => { x.answers = answers; }), 1500);
    return () => clearTimeout(t);
  }, [answers]);

  // Ramassage automatique
  useEffect(() => {
    if (m.status === "en-cours" && m.startedAt && remaining === 0 && !submitted.current) {
      submitted.current = true;
      submit();
    }
  }, [remaining, m.status]);

  function submit() {
    setM((x) => { x.answers = answers; x.submittedAt = new Date().toISOString(); x.status = "a-corriger"; });
    if (date && blockId) setBlockStatus(date, blockId, "done");
    setTimeout(() => correctAll(), 50);
  }

  async function correctAll() {
    setCorrecting(true); setError(null);
    try {
      const corrections = { ...m.corrections };
      for (const ex of m.exercises) {
        if (corrections[ex.id]) continue; // reprise après une erreur : on ne recorrige pas
        const c = await correctAnswer(s, ex, answers[ex.id] ?? "", [], 0);
        corrections[ex.id] = c;
        setM((x) => { x.corrections[ex.id] = c; });
      }
      const total = m.exercises.reduce((a, e) => a + (corrections[e.id]?.score ?? 0), 0);
      const outOf = m.exercises.reduce((a, e) => a + (corrections[e.id]?.outOf ?? 0), 0) || 20;
      const grade = Math.round((total / outOf) * 20 * 4) / 4;
      setM((x) => { x.grade = grade; x.status = "corrige"; });
      recordAttempts(s.id, m.exercises.map((e) => ({ kind: "examen-blanc" as const, notionIds: e.notionIds, score: corrections[e.id].outOf ? corrections[e.id].score / corrections[e.id].outOf : 0, errors: corrections[e.id].errors, refId: m.id })));
    } catch (e) {
      setError(errorMessage(e) + " Les exercices déjà corrigés sont conservés.");
    } finally {
      setCorrecting(false);
    }
  }

  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);

  if (m.status === "pret") {
    return (
      <Card className="flex flex-col gap-4 max-w-xl">
        <p className="font-display text-lg font-semibold">Sujet prêt : {m.exercises.length} exercices, {m.durationMin} min</p>
        <p className="text-sm text-muted">Une fois lancé, le chrono ne s'arrête pas, même si tu fermes la page. Prépare brouillon, stylo{s.docsAllowed ? " et documents" : ""}, et coupe les notifications.</p>
        <div className="flex gap-2">
          <Button onClick={() => setM((x) => { x.status = "en-cours"; x.startedAt = new Date().toISOString(); })}>Lancer le chrono</Button>
          <Button variant="ghost" onClick={onBack}>Retour</Button>
        </div>
      </Card>
    );
  }

  if (m.status === "en-cours") {
    return (
      <div className="flex flex-col gap-4">
        <div className="sticky z-10 rounded-xl border border-line bg-surface px-4 py-3 flex flex-wrap items-center gap-3" style={{ top: "calc(env(safe-area-inset-top, 0px) + 64px)" }}>
          <span className={`font-mono text-2xl font-semibold tnum ${remaining < 10 * 60_000 ? "text-pen" : ""}`}>{String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}</span>
          <span className="text-sm text-muted">restantes</span>
          <div className="ml-auto flex gap-2">
            {!confirmStop ? <Button size="sm" variant="secondary" onClick={() => setConfirmStop(true)}>Rendre ma copie</Button> : (
              <>
                <span className="text-sm self-center">Rendre maintenant ?</span>
                <Button size="sm" onClick={() => { submitted.current = true; submit(); }}>Oui</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)}>Non</Button>
              </>
            )}
          </div>
        </div>
        {m.exercises.map((ex) => (
          <Card key={ex.id} className="flex flex-col gap-3">
            <div className="flex items-center gap-2"><p className="font-display text-lg font-semibold flex-1">{ex.title}</p><Badge tone="pen">{ex.bareme.reduce((a, b) => a + b.points, 0)} pts</Badge></div>
            <MathText text={ex.statement} />
            <Textarea id={`mock-${ex.id}`} rows={8} value={answers[ex.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [ex.id]: e.target.value }))} placeholder="Ta rédaction…" />
          </Card>
        ))}
      </div>
    );
  }

  // a-corriger ou corrige
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-wrap items-center gap-4">
        {m.grade != null ? <Grade value={m.grade} className="text-4xl" /> : <span className="text-muted">Correction en cours…</span>}
        <div className="flex-1 min-w-0">
          <p className="font-display text-lg font-semibold">{m.grade == null ? "Copie ramassée" : m.grade >= s.targetGrade ? `Objectif ${s.targetGrade}/20 atteint en conditions réelles.` : `${(s.targetGrade - m.grade).toFixed(1).replace(".", ",")} point(s) sous ton objectif.`}</p>
          <p className="text-sm text-muted">La note entre dans la prévision (40 % pendant 14 jours) et la maîtrise des notions concernées est mise à jour.</p>
        </div>
        <Button variant="ghost" onClick={onBack}>Retour</Button>
      </Card>
      <ErrorBox error={error} onRetry={correctAll} />
      {m.status === "a-corriger" && !correcting && !error && <Button className="self-start" onClick={correctAll}>Lancer la correction</Button>}
      {correcting && <p className="text-sm text-accent">Correction exercice par exercice, avec contre-correction…</p>}
      {m.exercises.map((ex) => (
        <div key={ex.id} className="grid gap-4 lg:grid-cols-2 items-start">
          <Card className="flex flex-col gap-2">
            <p className="font-display font-semibold">{ex.title}</p>
            <MathText text={ex.statement} />
            <details className="text-sm"><summary className="cursor-pointer text-muted">Corrigé de référence</summary><div className="mt-2"><MathText text={ex.solution} /></div></details>
          </Card>
          {m.corrections[ex.id] ? <CorrectionView c={m.corrections[ex.id]} answer={m.answers[ex.id] ?? ""} /> : <Card className="text-sm text-muted">En attente de correction.</Card>}
        </div>
      ))}
    </div>
  );
}
