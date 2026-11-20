import { useEffect, useMemo, useRef, useState } from "react";
import { useApp, uid } from "../lib/store";
import { useUI } from "../ui-state";
import { Badge, Button, Card, Empty, ErrorBox, Grade, Segmented, Spinner, Textarea, Input } from "../components/ui";
import { MathText } from "../components/MathText";
import { generateExercise, correctAnswer, miniCours } from "../lib/ai/tasks";
import { errorMessage } from "../lib/ai/client";
import { getImageLimits } from "../lib/runtime";
import { shrinkImage } from "../lib/ingest";
import { blockLabel } from "../lib/planner";
import type { Correction, Exercise, ExerciseSession, Notion, Subject } from "../lib/types";

const pts = (x: number) => String(Math.round(x * 100) / 100).replace(".", ",");
const ERR_LABEL: Record<string, string> = { calcul: "Calcul", methode: "Méthode", redaction: "Rédaction", cours: "Cours pas su" };

export function ExercicePage() {
  const { state } = useApp();
  const { work, go } = useUI();
  if (!work || work.kind !== "exercice") return <Empty title="Aucun exercice en cours"><Button onClick={() => go("aujourdhui")}>Aller à la session du jour</Button></Empty>;
  const s = state.subjects.find((x) => x.id === work.subjectId);
  if (!s) return <Empty title="Matière introuvable" />;
  return <Workspace s={s} notionIds={work.notionIds} mode={work.mode} blockId={work.blockId} date={work.date} />;
}

function Workspace({ s, notionIds, mode, blockId, date }: { s: Subject; notionIds: string[]; mode: "exercices" | "annale" | "mini-cours"; blockId?: string; date?: string }) {
  const { updateSubject, setBlockStatus, state } = useApp();
  const { go } = useUI();
  const notions = notionIds.map((id) => s.notions.find((n) => n.id === id)).filter(Boolean) as Notion[];
  const block = date && blockId ? state.plan?.days.find((d) => d.date === date)?.blocks.find((b) => b.id === blockId) : undefined;

  // Exercices disponibles sur ces notions, non encore corrigés
  const pending = useMemo(() => s.exercises.filter((e) => e.notionIds.some((id) => notionIds.includes(id)) && !s.sessions.some((x) => x.exerciseId === e.id && x.status === "corrige")), [s, notionIds]);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    const open = s.sessions.find((x) => x.status !== "corrige" && s.exercises.some((e) => e.id === x.exerciseId && e.notionIds.some((id) => notionIds.includes(id))));
    return open?.exerciseId ?? null;
  });
  const current = s.exercises.find((e) => e.id === currentId) ?? null;
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(mode === "annale" ? 3 : 2);
  const [gen, setGen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCours, setShowCours] = useState(mode === "mini-cours");
  const doneCount = s.sessions.filter((x) => x.blockId === blockId && blockId && x.status === "corrige").length;

  async function newExercise() {
    setGen(true); setError(null);
    try {
      const ex = await generateExercise(s, notionIds, difficulty);
      updateSubject(s.id, (x) => { x.exercises.push(ex); });
      setCurrentId(ex.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setGen(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{s.name}{block ? ` · ${blockLabel(block.type)} · ${block.durationMin} min` : ""}</p>
          <h1 className="font-display text-2xl sm:text-3xl font-bold">{notions.map((n) => n.title).join(" + ") || "Exercice"}</h1>
          {block && <p className="text-sm text-muted mt-1">{block.objective}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowCours((v) => !v)}>{showCours ? "Masquer le mini-cours" : "Je bloque : mini-cours"}</Button>
          {block && block.status !== "done" && (
            <Button size="sm" onClick={() => { setBlockStatus(date!, blockId!, "done"); go("aujourdhui"); }}>Terminer le bloc{doneCount ? ` (${doneCount} exo)` : ""}</Button>
          )}
        </div>
      </div>

      {showCours && notions[0] && <MiniCours s={s} notion={notions[0]} />}

      {!current ? (
        <Card className="flex flex-col gap-4">
          <p className="font-display text-lg font-semibold">Choisir un exercice</p>
          {pending.length > 0 && (
            <ul className="flex flex-col gap-2">
              {pending.slice(0, 4).map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-sunken p-3">
                  <span className="flex-1 min-w-0 text-sm font-medium">{e.title}</span>
                  <Badge>difficulté {e.difficulty}/3</Badge>
                  <Button size="sm" onClick={() => setCurrentId(e.id)}>Faire celui-ci</Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Nouvel exercice généré, difficulté</span>
            <Segmented id="ex-diff" value={difficulty} onChange={setDifficulty} options={[{ value: 1, label: "1 · bases" }, { value: 2, label: "2 · partiel" }, { value: 3, label: "3 · difficile" }]} />
          </div>
          <ErrorBox error={error} onRetry={newExercise} />
          <Button className="self-start" loading={gen} onClick={newExercise}>{gen ? "Rédaction et vérification du corrigé…" : "Générer un exercice type annale"}</Button>
          {gen && <p className="text-xs text-muted">Deux appels : Claude rédige l'exercice, puis un second passage et un calcul automatique vérifient le corrigé.</p>}
        </Card>
      ) : (
        <ExerciseRunner key={current.id} s={s} ex={current} blockId={blockId} date={date} onNext={() => setCurrentId(null)} />
      )}
    </div>
  );
}

function ExerciseRunner({ s, ex, blockId, date, onNext }: { s: Subject; ex: Exercise; blockId?: string; date?: string; onNext: () => void }) {
  const { updateSubject, recordAttempts, setBlockStatus, state } = useApp();
  const existing = s.sessions.find((x) => x.exerciseId === ex.id && x.status !== "corrige") ?? s.sessions.filter((x) => x.exerciseId === ex.id).pop();
  const [sessionId] = useState(() => existing?.id ?? uid("ses-"));
  const session = s.sessions.find((x) => x.id === sessionId);
  const [answer, setAnswer] = useState(existing?.answer ?? "");
  const [hints, setHints] = useState(existing?.hintsShown ?? 0);
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [canPhoto, setCanPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(session?.status === "erreur" ? session.error ?? null : null);
  const [showSol, setShowSol] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const outOf = ex.bareme.reduce((a, b) => a + b.points, 0);

  useEffect(() => { getImageLimits().then((l) => setCanPhoto(!!l)); }, []);

  const persist = (patch: Partial<ExerciseSession>) => {
    updateSubject(s.id, (x) => {
      let ses = x.sessions.find((y) => y.id === sessionId);
      if (!ses) {
        ses = { id: sessionId, exerciseId: ex.id, blockId, hintsShown: 0, answer: "", hadPhoto: false, status: "en-cours", updatedAt: new Date().toISOString() };
        x.sessions.push(ses);
      }
      Object.assign(ses, patch, { updatedAt: new Date().toISOString() });
      x.sessions = x.sessions.slice(-300);
    });
  };

  // Brouillon enregistré automatiquement (rien n'est perdu si la page se ferme).
  useEffect(() => {
    if (answer === (session?.answer ?? "")) return;
    const t = setTimeout(() => persist({ answer }), 1200);
    return () => clearTimeout(t);
  }, [answer]);

  async function submit() {
    setBusy(true); setError(null);
    persist({ answer, hintsShown: hints, hadPhoto: photos.length > 0, status: "correction", error: undefined });
    try {
      const c = await correctAnswer(s, ex, answer, photos, hints);
      persist({ correction: c, status: "corrige" });
      recordAttempts(s.id, [{ kind: ex.fromAnnale ? "annale" : "exercice", notionIds: ex.notionIds, score: c.outOf ? c.score / c.outOf : 0, errors: c.errors, refId: ex.id }]);
      if (date && blockId) {
        const b = state.plan?.days.find((d) => d.date === date)?.blocks.find((x) => x.id === blockId);
        if (b && b.status === "todo") setBlockStatus(date, blockId, "partial");
      }
    } catch (e) {
      const m = errorMessage(e);
      setError(m);
      persist({ status: "erreur", error: m });
    } finally {
      setBusy(false);
    }
  }

  const correction = session?.status === "corrige" ? session.correction : undefined;

  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr] items-start">
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-display text-lg font-semibold flex-1 min-w-0">{ex.title}</p>
          <Badge>difficulté {ex.difficulty}/3</Badge>
          <Badge tone="pen">{pts(outOf)} pts</Badge>
          <VerifBadge v={ex.verification} />
        </div>
        <MathText text={ex.statement} />
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <p className="text-sm font-medium">Indices <span className="text-muted font-normal">(cherche au moins 5 min avant d'en ouvrir un)</span></p>
          {ex.hints.slice(0, hints).map((h, i) => (
            <div key={i} className="rounded-lg bg-sunken px-3 py-2 text-sm flex gap-2 items-baseline"><span className="font-mono text-pen shrink-0">{i + 1}</span><MathText text={h} className="flex-1 min-w-0 [&>p]:my-0" /></div>
          ))}
          {hints < ex.hints.length && !correction && (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => { setHints(hints + 1); persist({ hintsShown: hints + 1 }); }}>
              {["Indice 1 : par où commencer", "Indice 2 : la méthode", "Indice 3 : le résultat intermédiaire"][hints]}
            </Button>
          )}
        </div>
      </Card>

      <div className="flex flex-col gap-4 min-w-0">
        {!correction ? (
          <Card className="flex flex-col gap-3">
            <p className="font-display text-lg font-semibold">Ta réponse</p>
            <Textarea id="ex-answer" rows={12} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy}
              placeholder={"Rédige comme au partiel. Tu peux écrire les maths en LaTeX ($f'(x) = ...$) ou en texte simple (f'(x) = (1-x)e^(-x))."} />
            {answer.includes("$") && <div className="rounded-lg bg-sunken p-3 text-sm"><p className="eyebrow mb-1">Aperçu</p><MathText text={answer} /></div>}
            {canPhoto && (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>Ajouter une photo de ma copie</Button>
                <input ref={fileRef} id="ex-photo" type="file" accept="image/*" capture="environment" hidden multiple
                  onChange={async (e) => { const fs = [...(e.target.files ?? [])]; const imgs = await Promise.all(fs.map((f) => shrinkImage(f))); setPhotos((p) => [...p, ...imgs].slice(0, 4)); e.target.value = ""; }} />
                {photos.length > 0 && <span className="text-sm text-muted">{photos.length} photo(s) <button className="underline" onClick={() => setPhotos([])}>retirer</button></span>}
              </div>
            )}
            {photos.length > 0 && <p className="text-xs text-muted">Les photos sont envoyées pour la correction mais ne sont pas conservées : seul ton texte est enregistré.</p>}
            <ErrorBox error={error} onRetry={submit} />
            <Button loading={busy} disabled={!answer.trim() && !photos.length} onClick={submit}>{busy ? "Correction puis contre-correction…" : "Rendre ma copie"}</Button>
          </Card>
        ) : (
          <CorrectionView c={correction} answer={session!.answer} />
        )}

        {correction && (
          <Card className="flex flex-col gap-2">
            <button className="text-left font-medium text-sm" onClick={() => setShowSol((v) => !v)}>{showSol ? "Masquer" : "Voir"} le corrigé de référence</button>
            {showSol && <MathText text={ex.solution} />}
            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={onNext}>Exercice suivant</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function VerifBadge({ v }: { v?: Exercise["verification"] }) {
  if (!v) return null;
  const map = { ok: ["ok", "corrigé vérifié"], corrige: ["warn", "corrigé rectifié par la vérification"], doute: ["bad", "corrigé à vérifier"], "non-verifie": ["neutral", "non vérifié"] } as const;
  const [tone, label] = map[v.status];
  return <span title={v.notes}><Badge tone={tone}>{label}</Badge></span>;
}

export function CorrectionView({ c, answer }: { c: Correction; answer: string }) {
  const pct = c.outOf ? c.score / c.outOf : 0;
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <Grade value={c.score} outOf={c.outOf} className="text-3xl" />
        <div className="flex-1 min-w-0">
          <p className="font-display text-lg font-semibold">{pct >= 0.85 ? "Solide." : pct >= 0.6 ? "Correct, mais des points perdus." : pct >= 0.35 ? "Insuffisant pour un partiel." : "Pas acquis."}</p>
          <VerifLine v={c.verification} />
        </div>
      </div>
      <MathText text={c.feedback} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <tbody>
            {c.steps.map((st, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="py-2 pr-3"><p className="font-medium"><MathText text={st.label} className="inline" /></p><div className="text-muted"><MathText text={st.comment} /></div></td>
                <td className={`py-2 font-mono tnum whitespace-nowrap text-right ${st.awarded < st.max ? "text-pen" : "text-ok"}`}>{pts(st.awarded)}/{pts(st.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.errors.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm font-medium">Erreurs relevées</p>
          {c.errors.map((e, i) => (
            <div key={i} className="flex gap-2 text-sm items-baseline"><Badge tone="pen">{ERR_LABEL[e.type]}</Badge><MathText text={e.detail} className="flex-1 min-w-0" /></div>
          ))}
        </div>
      )}
      {c.correctedSolution && c.correctedSolution.trim() !== "RAS" && (
        <details className="text-sm" open={pct < 0.6}>
          <summary className="cursor-pointer font-medium">Ta copie, corrigée</summary>
          <div className="mt-2 rounded-lg bg-sunken p-3"><MathText text={c.correctedSolution} /></div>
        </details>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted">Ce que tu as rendu</summary>
        <div className="mt-2 rounded-lg bg-sunken p-3"><MathText text={answer || "(photo seulement)"} /></div>
      </details>
    </Card>
  );
}

function VerifLine({ v }: { v: Correction["verification"] }) {
  const t = { ok: "Note confirmée par une contre-correction.", corrige: "La contre-correction a modifié la note.", doute: "Désaccord entre les vérifications : regarde le corrigé de référence.", "non-verifie": "Contre-correction indisponible : note provisoire." }[v.status];
  return <p className={`text-sm ${v.status === "ok" ? "text-ok" : v.status === "corrige" ? "text-warn" : "text-muted"}`} title={v.notes}>{t}</p>;
}

function MiniCours({ s, notion }: { s: Subject; notion: Notion }) {
  const { getDocText } = useApp();
  const key = `mc:${s.id}:${notion.id}`;
  const [text, setText] = useState<string>(() => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } });
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctl = useRef<AbortController | null>(null);

  async function run() {
    setBusy(true); setError(null); setText("");
    ctl.current = new AbortController();
    try {
      // Extraits du cours autour des passages cités (pour citer la section source).
      const excerpts: string[] = [];
      for (const it of notion.items) {
        if (!it.source) continue;
        const doc = await getDocText(it.source.docId);
        const idx = doc.toLowerCase().indexOf(it.source.excerpt.slice(0, 40).toLowerCase());
        if (idx >= 0) excerpts.push(`[${it.source.section}]\n${doc.slice(Math.max(0, idx - 800), idx + 1500)}`);
      }
      const r = await miniCours(s, notion, excerpts.join("\n\n---\n\n").slice(0, 60_000), q, { onText: setText, signal: ctl.current.signal, noCache: !!q });
      setText(r);
      try { localStorage.setItem(key, r); } catch { /* */ }
    } catch (e: any) {
      if (e?.code !== "cancelled") setError(errorMessage(e));
      if (e?.partial) setText(e.partial);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 border-accent/40">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-display text-lg font-semibold flex-1 min-w-0">Mini-cours : {notion.title}</p>
        {busy && <Button size="sm" variant="ghost" onClick={() => ctl.current?.abort()}>Arrêter</Button>}
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <Input id="mc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ce qui te bloque précisément (facultatif)" />
        <Button onClick={run} loading={busy} className="shrink-0">{text ? "Refaire" : "Expliquer"}</Button>
      </div>
      <ErrorBox error={error} onRetry={run} />
      {busy && !text && <p className="text-sm text-muted flex items-center gap-2"><Spinner /> Le coach prépare l'explication à partir de ton cours…</p>}
      {text && <MathText text={text} />}
      {!text && !busy && (
        <div className="text-sm text-muted">
          <p className="mb-1">Ce que dit ton cours :</p>
          <ul className="flex flex-col gap-1">{notion.items.map((it) => <li key={it.id}><MathText text={`**${it.title}** : ${it.statement} _[${it.source?.section ?? "?"}]_`} /></li>)}</ul>
        </div>
      )}
    </Card>
  );
}
