import { useMemo, useState } from "react";
import { useApp, uid } from "../lib/store";
import { useUI } from "../ui-state";
import { Badge, Button, Card, Empty, Field, Select, Textarea } from "../components/ui";
import { MathText } from "../components/MathText";
import { initialSM2 } from "../lib/sm2";
import type { Flashcard, Subject } from "../lib/types";

const RATINGS = [
  { q: 1, label: "Raté", hint: "revient demain", tone: "danger" as const },
  { q: 3, label: "Difficile", hint: "su avec effort", tone: "secondary" as const },
  { q: 4, label: "Bien", hint: "su", tone: "secondary" as const },
  { q: 5, label: "Facile", hint: "immédiat", tone: "secondary" as const },
];

export function Flashcards() {
  const { state, today, reviewCard, setBlockStatus } = useApp();
  const { work, go } = useUI();
  const blockCtx = work?.kind === "flashcards" ? work : null;
  const [filter, setFilter] = useState<string>(blockCtx?.subjectId ?? "all");
  const [extra, setExtra] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [adding, setAdding] = useState(false);

  const subjects = state.subjects.filter((s) => s.cards.length);
  const queue = useMemo(() => {
    const out: { s: Subject; c: Flashcard }[] = [];
    for (const s of state.subjects) {
      if (filter !== "all" && s.id !== filter) continue;
      for (const c of s.cards) {
        if (s.notions.find((n) => n.id === c.notionId) == null) continue;
        if (extra || c.sm2.due <= today) out.push({ s, c });
      }
    }
    // Les cartes ratées et les plus en retard d'abord, puis on mélange les matières/notions (interleaving).
    return out.sort((a, b) => (a.c.sm2.due === b.c.sm2.due ? a.c.sm2.ef - b.c.sm2.ef : a.c.sm2.due.localeCompare(b.c.sm2.due)));
  }, [state.subjects, filter, extra, today]);

  const cur = queue[0];
  const dueTotal = state.subjects.reduce((a, s) => a + s.cards.filter((c) => c.sm2.due <= today).length, 0);
  const block = blockCtx?.date && blockCtx.blockId ? state.plan?.days.find((d) => d.date === blockCtx.date)?.blocks.find((b) => b.id === blockCtx.blockId) : undefined;

  if (!state.subjects.some((s) => s.cards.length)) {
    return <Empty title="Pas encore de flashcards"><p className="text-sm text-muted">Elles sont créées automatiquement à partir des définitions et théorèmes de ton cours après l'analyse.</p><Button onClick={() => go("matiere")}>Analyser un cours</Button></Empty>;
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl mx-auto w-full">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Répétition espacée · SM-2</p>
          <h1 className="font-display text-3xl font-bold">Flashcards</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select id="fc-filter" className="w-auto" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Toutes les matières</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
          <Button variant="secondary" size="sm" onClick={() => setAdding((v) => !v)}>Ajouter une carte</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-sm">
        <Badge tone={dueTotal ? "pen" : "ok"}>{dueTotal} carte(s) dues aujourd'hui</Badge>
        <Badge>{reviewed} revue(s) dans cette session</Badge>
        {block && <Badge tone="accent">Bloc du planning · {block.durationMin} min</Badge>}
      </div>

      {adding && <AddCard onDone={() => setAdding(false)} defaultSubject={filter !== "all" ? filter : subjects[0]?.id} />}

      {cur ? (
        <Card className="flex flex-col gap-5 min-h-[320px]">
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="h-2 w-2 rounded-full" style={{ background: cur.s.color }} />
            {cur.s.name} · {cur.s.notions.find((n) => n.id === cur.c.notionId)?.title}
            {cur.c.sm2.lapses > 0 && <Badge tone="pen">{cur.c.sm2.lapses} oubli(s)</Badge>}
            <span className="ml-auto">{queue.length} restante(s)</span>
          </div>
          <div className="text-lg"><MathText text={cur.c.front} /></div>
          {!revealed ? (
            <Button className="self-center mt-auto" onClick={() => setRevealed(true)}>J'ai ma réponse, retourner</Button>
          ) : (
            <>
              <div className="rounded-lg bg-sunken p-4 border-l-2 border-accent"><MathText text={cur.c.back} />{cur.c.sourceSection && <p className="text-xs text-muted mt-2">Source : {cur.c.sourceSection}</p>}</div>
              <div>
                <p className="text-sm text-muted mb-2">Sois honnête : une carte « presque sue » est ratée au partiel.</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {RATINGS.map((r) => (
                    <Button key={r.q} variant={r.tone} className="flex-col !gap-0 py-2" onClick={() => { reviewCard(cur.s.id, cur.c.id, r.q); setRevealed(false); setReviewed((n) => n + 1); }}>
                      <span>{r.label}</span><span className="text-[11px] opacity-70 font-normal">{r.hint}</span>
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </Card>
      ) : (
        <Empty title={extra ? "Plus aucune carte" : "Toutes les cartes dues sont faites"}>
          <p className="text-sm text-muted">La répétition espacée marche parce qu'on ne revoit pas une carte trop tôt. Les prochaines reviendront au bon moment.</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {block && block.status !== "done" && <Button onClick={() => { setBlockStatus(blockCtx!.date!, blockCtx!.blockId!, "done"); go("aujourdhui"); }}>Terminer le bloc</Button>}
            {!extra && <Button variant="secondary" onClick={() => setExtra(true)}>Réviser en avance quand même</Button>}
          </div>
        </Empty>
      )}
    </div>
  );
}

function AddCard({ onDone, defaultSubject }: { onDone: () => void; defaultSubject?: string }) {
  const { state, updateSubject, today } = useApp();
  const [sid, setSid] = useState(defaultSubject ?? state.subjects[0]?.id);
  const s = state.subjects.find((x) => x.id === sid);
  const [nid, setNid] = useState(s?.notions[0]?.id ?? "");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  return (
    <Card className="flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Matière"><Select id="ac-s" value={sid} onChange={(e) => { setSid(e.target.value); setNid(state.subjects.find((x) => x.id === e.target.value)?.notions[0]?.id ?? ""); }}>{state.subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
        <Field label="Notion"><Select id="ac-n" value={nid} onChange={(e) => setNid(e.target.value)}>{s?.notions.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}</Select></Field>
      </div>
      <Field label="Recto (question)"><Textarea id="ac-front" rows={2} value={front} onChange={(e) => setFront(e.target.value)} placeholder="Ex. : Élasticité-prix de la demande ?" /></Field>
      <Field label="Verso (réponse, LaTeX accepté)"><Textarea id="ac-back" rows={3} value={back} onChange={(e) => setBack(e.target.value)} placeholder="$e = \frac{p}{q}\frac{dq}{dp}$" /></Field>
      <div className="flex gap-2">
        <Button disabled={!front.trim() || !back.trim() || !nid} onClick={() => { updateSubject(sid!, (x) => { x.cards.push({ id: uid("card-"), notionId: nid, front, back, sm2: initialSM2(today) }); }); setFront(""); setBack(""); onDone(); }}>Ajouter</Button>
        <Button variant="ghost" onClick={onDone}>Annuler</Button>
      </div>
    </Card>
  );
}
