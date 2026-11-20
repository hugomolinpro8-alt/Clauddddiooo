import { Fragment, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { useUI } from "../ui-state";
import { Badge, Bar, Button, Card, Empty, ErrorBox, Field, Input, Segmented, Select, Spinner, Textarea, masteryTone } from "../components/ui";
import { MathText, MathInline } from "../components/MathText";
import { errorMessage } from "../lib/ai/client";
import { subjectMastery } from "../lib/mastery";
import { highYield, computeWeights } from "../lib/analysis";
import { diffDays, formatDay } from "../lib/dates";
import type { DocMeta, Subject } from "../lib/types";

export function Matiere() {
  const { state, today } = useApp();
  const { subjectId, setSubjectId, go } = useUI();
  const s = state.subjects.find((x) => x.id === subjectId) ?? state.subjects[0];
  const [tab, setTab] = useState<"docs" | "analyse" | "infos">(s && s.notions.length ? "analyse" : "docs");

  if (!s) {
    return <Empty title="Aucune matière pour l'instant"><Button onClick={() => go("nouvelle-matiere")}>Ajouter une matière</Button></Empty>;
  }
  const j = diffDays(s.examDate, today);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{formatDay(s.examDate)} · {s.durationMin} min · coef. {s.coef} · {j >= 0 ? `J-${j}` : "passé"}</p>
          <h1 className="font-display text-3xl font-bold truncate" style={{ color: s.color }}>{s.name}</h1>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {state.subjects.length > 1 && (
            <Select id="subject-pick" value={s.id} onChange={(e) => setSubjectId(e.target.value)} className="w-auto">
              {state.subjects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
          <Button variant="secondary" size="sm" onClick={() => go("nouvelle-matiere")}>Nouvelle matière</Button>
        </div>
      </div>
      <Segmented id="subject-tab" value={tab} onChange={setTab} options={[{ value: "docs", label: `Documents (${s.documents.length})` }, { value: "analyse", label: "Rapport d'analyse" }, { value: "infos", label: "Partiel" }]} />
      {tab === "docs" && <Documents s={s} onAnalyzed={() => setTab("analyse")} />}
      {tab === "analyse" && <Rapport s={s} />}
      {tab === "infos" && <Infos s={s} />}
    </div>
  );
}

function Documents({ s, onAnalyzed }: { s: Subject; onAnalyzed: () => void }) {
  const { addDocuments, addPastedDocument, removeDocument, analyzeSubject, docProgress, aiLive } = useApp();
  const [role, setRole] = useState<DocMeta["role"]>("cours");
  const [paste, setPaste] = useState(false);
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const ready = s.documents.filter((d) => d.status === "pret");
  const hasCourse = ready.some((d) => d.role !== "annale");

  async function analyze() {
    setError(null);
    try {
      await analyzeSubject(s.id, setStep);
      onAnalyzed();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setStep(null);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4 min-w-0">
        <Card
          className={`flex flex-col gap-3 border-dashed ${drag ? "border-accent bg-accent/5" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addDocuments(s.id, [...e.dataTransfer.files], role); }}
        >
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <p className="font-medium">Ajouter des documents</p>
            <Segmented id="doc-role" value={role} onChange={setRole} options={[{ value: "cours", label: "Cours" }, { value: "annale", label: "Annale" }, { value: "notes", label: "Mes notes" }]} />
          </div>
          <p className="text-sm text-muted">PDF (texte ou scanné), photos de tes notes, fichiers .txt / .md. Glisse-les ici ou choisis-les. Les PDF scannés et les photos sont lus par Claude.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => fileRef.current?.click()}>Choisir des fichiers</Button>
            <Button variant="secondary" onClick={() => setPaste((p) => !p)}>Coller du texte</Button>
          </div>
          <input ref={fileRef} id="doc-files" type="file" multiple hidden accept=".pdf,.txt,.md,.markdown,.tex,image/*"
            onChange={(e) => { if (e.target.files?.length) addDocuments(s.id, [...e.target.files], role); e.target.value = ""; }} />
          {paste && (
            <div className="flex flex-col gap-2">
              <Input id="paste-name" placeholder="Nom (ex. Chapitre 3 — Dérivation)" value={pasteName} onChange={(e) => setPasteName(e.target.value)} />
              <Textarea id="paste-text" rows={8} placeholder="Colle ici le texte du cours ou de l'annale" value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
              <Button className="self-start" disabled={!pasteText.trim()} onClick={async () => { await addPastedDocument(s.id, pasteName.trim() || `Texte collé (${role})`, pasteText, role); setPasteText(""); setPasteName(""); setPaste(false); }}>Ajouter</Button>
            </div>
          )}
        </Card>

        {s.documents.length === 0 ? (
          <Empty title="Aucun document">
            <p className="text-sm text-muted max-w-md">Commence par ton cours (au moins les chapitres au programme), puis les annales des années précédentes : ce sont elles qui disent ce qui rapporte des points.</p>
          </Empty>
        ) : (
          <Card className="p-0 sm:p-0 overflow-hidden">
            <ul className="divide-y divide-line">
              {s.documents.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <Badge tone={d.role === "annale" ? "pen" : d.role === "cours" ? "accent" : "neutral"}>{d.role}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-sm">{d.name}</p>
                    <p className="text-xs text-muted">
                      {d.status === "extraction" && (docProgress[d.id] ?? "Extraction…")}
                      {d.status === "pret" && `${d.chars.toLocaleString("fr-FR")} caractères${d.pages ? ` · ${d.pages} pages` : ""}${d.analyzed ? " · analysé" : " · pas encore analysé"}`}
                      {d.status === "erreur" && <span className="text-bad">{d.error}</span>}
                    </p>
                  </div>
                  {d.status === "extraction" ? <Spinner className="text-muted" /> : <Button variant="ghost" size="sm" onClick={() => removeDocument(s.id, d.id)} aria-label={`Supprimer ${d.name}`}>Retirer</Button>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card className="flex flex-col gap-3 self-start">
        <p className="font-display text-lg font-semibold">Analyse</p>
        <p className="text-sm text-muted">Le coach découpe le cours en chapitres, notions et théorèmes (avec la source de chaque élément), rattache chaque exercice d'annale aux notions et calcule leur poids dans le partiel. Puis il régénère ton programme.</p>
        <ul className="text-sm flex flex-col gap-1">
          <li>{ready.filter((d) => d.role !== "annale").length} document(s) de cours prêts</li>
          <li>{ready.filter((d) => d.role === "annale").length} annale(s) prêtes {ready.some((d) => d.role === "annale") ? "" : <span className="text-warn">(sans annale, tous les chapitres pèsent pareil)</span>}</li>
        </ul>
        {!aiLive && <p className="text-xs text-warn">Hors claude.ai, l'analyse est simulée par mots-clés.</p>}
        <ErrorBox error={error} onRetry={analyze} />
        {step && <p className="text-sm text-accent flex items-center gap-2"><Spinner /> {step}</p>}
        <Button disabled={!hasCourse || !!step} loading={!!step} onClick={analyze}>{s.notions.length ? "Relancer l'analyse" : "Analyser cours et annales"}</Button>
      </Card>
    </div>
  );
}

function Rapport({ s }: { s: Subject }) {
  const { updateSubject, regeneratePlan, today } = useApp();
  const mastery = useMemo(() => subjectMastery(s, today), [s, today]);
  const yieldList = useMemo(() => highYield(s, mastery), [s, mastery]);
  const [dirty, setDirty] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  if (!s.notions.length) {
    return <Empty title="Pas encore d'analyse"><p className="text-sm text-muted">Ajoute ton cours (et tes annales) dans l'onglet Documents, puis lance l'analyse.</p></Empty>;
  }
  const edit = (fn: (x: Subject) => void) => { updateSubject(s.id, fn); setDirty(true); };
  const totalW = s.notions.reduce((a, n) => a + n.weight, 0) || 1;

  return (
    <div className="flex flex-col gap-5">
      {dirty && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 flex flex-wrap items-center gap-3 text-sm">
          <span className="flex-1 min-w-0">Tu as modifié le rapport. Le programme n'en tient compte qu'après régénération.</span>
          <Button size="sm" onClick={() => { regeneratePlan(`Rapport d'analyse de ${s.name} modifié.`); setDirty(false); }}>Régénérer le programme</Button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card className="flex flex-col gap-2">
          <p className="eyebrow">Synthèse des annales · {s.analysis?.annalesCount ?? 0} sujet(s)</p>
          <MathText text={s.analysis?.summary ?? ""} />
          <Field label="Tes remarques (prises en compte par le coach)">
            <Textarea id="analysis-notes" rows={2} value={s.analysis?.notes ?? ""} placeholder="Ex. : le prof a dit que le chapitre 4 ne tombera pas"
              onChange={(e) => updateSubject(s.id, (x) => { if (x.analysis) x.analysis.notes = e.target.value; })} />
          </Field>
        </Card>
        <Card className="flex flex-col gap-3">
          <p className="eyebrow">À fort rendement maintenant</p>
          <p className="text-xs text-muted">Poids dans les annales × ce qu'il te reste à apprendre.</p>
          <ol className="flex flex-col gap-2">
            {yieldList.map((y, i) => (
              <li key={y.notion.id} className="flex items-center gap-3 text-sm">
                <span className="font-mono text-pen w-4">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate">{y.notion.title}</span>
                <span className="tnum text-muted text-xs">{Math.round(y.notion.weight * 100)} % · maîtrise {Math.round(mastery[y.notion.id].mastery)}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {!!s.analysis?.exerciseTypes.length && (
        <Card className="flex flex-col gap-3">
          <p className="eyebrow">Exercices types qui reviennent</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {s.analysis.exerciseTypes.map((t) => (
              <div key={t.type} className="rounded-lg bg-sunken p-3 flex flex-col gap-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-sm">{t.type}</p>
                  <Badge tone={t.count >= 2 ? "pen" : "neutral"}>{t.count}× dans les annales</Badge>
                </div>
                {t.description && <p className="text-sm text-muted">{t.description}</p>}
                <p className="text-xs text-muted">Notions : {t.notionIds.map((id) => s.notions.find((n) => n.id === id)?.title).filter(Boolean).join(", ")}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-4">
        {s.chapters.map((c) => {
          const ns = s.notions.filter((n) => n.chapterId === c.id);
          if (!ns.length) return null;
          return (
            <Card key={c.id} className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-display text-lg font-semibold">{c.title}</p>
                <label className="flex items-center gap-2 text-sm text-muted">
                  Niveau ressenti
                  <Select id={`lvl-${c.id}`} className="w-16" value={c.selfLevel} onChange={(e) => edit((x) => { x.chapters.find((y) => y.id === c.id)!.selfLevel = Number(e.target.value); })}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </Select>
                </label>
              </div>
              <div className="overflow-x-auto -mx-4 sm:-mx-5 px-4 sm:px-5">
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1 font-medium">Notion</th>
                      <th className="py-1 font-medium w-20">Annales</th>
                      <th className="py-1 font-medium w-24">Poids</th>
                      <th className="py-1 font-medium w-20">Heures</th>
                      <th className="py-1 font-medium w-32">Maîtrise</th>
                      <th className="py-1 font-medium w-24">Sacrifier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ns.map((n) => {
                      const m = mastery[n.id];
                      return (
                        <Fragment key={n.id}>
                          <tr className={`border-t border-line ${n.sacrificed ? "opacity-55" : ""}`}>
                            <td className="py-2 pr-2">
                              <button className="text-left hover:text-accent" onClick={() => setOpen(open === n.id ? null : n.id)}>{n.title} <span className="text-muted text-xs">({n.items.length})</span></button>
                            </td>
                            <td className="py-2 tnum text-muted">{n.frequency}× · {n.points} pt</td>
                            <td className="py-2">
                              <Input id={`w-${n.id}`} type="number" min={0} max={100} step={1} className="w-[4.5rem] py-1 tnum" value={Math.round((n.weight / totalW) * 100)}
                                onChange={(e) => edit((x) => { x.notions.find((y) => y.id === n.id)!.weight = Math.max(0, Number(e.target.value)) / 100; })} />
                            </td>
                            <td className="py-2">
                              <Input id={`h-${n.id}`} type="number" min={0.5} max={10} step={0.5} className="w-16 py-1 tnum" value={n.estHours}
                                onChange={(e) => edit((x) => { x.notions.find((y) => y.id === n.id)!.estHours = Math.max(0.5, Number(e.target.value)); })} />
                            </td>
                            <td className="py-2"><div className="flex items-center gap-2"><Bar value={m.mastery} tone={masteryTone(m.mastery)} /><span className="tnum text-xs w-7">{Math.round(m.mastery)}</span></div></td>
                            <td className="py-2"><input id={`sac-${n.id}`} type="checkbox" checked={!!n.sacrificed} onChange={(e) => edit((x) => { x.notions.find((y) => y.id === n.id)!.sacrificed = e.target.checked; })} aria-label={`Sacrifier ${n.title}`} /></td>
                          </tr>
                          {open === n.id && (
                            <tr>
                              <td colSpan={6} className="pb-3">
                                <ul className="flex flex-col gap-2 rounded-lg bg-sunken p-3">
                                  {n.items.map((it) => (
                                    <li key={it.id} className="text-sm">
                                      <p className="font-medium">{it.title} <span className="text-xs text-muted">· {it.kind}</span></p>
                                      <MathText text={it.statement} />
                                      {it.source && (
                                        <p className="text-xs text-muted">Source : {it.source.section} {it.source.verified ? <Badge tone="ok">citation retrouvée</Badge> : <Badge tone="warn">citation non retrouvée dans le document</Badge>}</p>
                                      )}
                                    </li>
                                  ))}
                                  {!n.items.length && <li className="text-sm text-muted">Aucun élément extrait.</li>}
                                </ul>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => edit((x) => { x.notions = computeWeights(x.notions, x.examExercises); })}>Recalculer les poids depuis les annales</Button>
      </div>

      {!!s.examExercises.length && (
        <Card className="flex flex-col gap-3">
          <p className="eyebrow">Exercices extraits des annales</p>
          <ul className="flex flex-col divide-y divide-line">
            {s.examExercises.map((e) => (
              <li key={e.id} className="py-2 flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{e.year ?? ""} · {e.title}</span>
                  <Badge>{e.type}</Badge>
                  {e.points != null && <Badge tone="pen">{e.points} pts</Badge>}
                </div>
                <div className="text-sm text-muted"><MathInline text={e.statement} /></div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Infos({ s }: { s: Subject }) {
  const { updateSubject, regeneratePlan, update } = useApp();
  const { go } = useUI();
  const [confirm, setConfirm] = useState(false);
  const set = (fn: (x: Subject) => void) => updateSubject(s.id, fn);
  return (
    <Card className="flex flex-col gap-4 max-w-2xl">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Nom"><Input id="i-name" value={s.name} onChange={(e) => set((x) => { x.name = e.target.value; })} /></Field>
        <Field label="Date du partiel"><Input id="i-date" type="date" value={s.examDate} onChange={(e) => set((x) => { x.examDate = e.target.value; })} /></Field>
        <Field label="Heure"><Input id="i-time" type="time" value={s.examTime} onChange={(e) => set((x) => { x.examTime = e.target.value; })} /></Field>
        <Field label="Durée (min)"><Input id="i-dur" type="number" value={s.durationMin} onChange={(e) => set((x) => { x.durationMin = Number(e.target.value) || 60; })} /></Field>
        <Field label="Coefficient"><Input id="i-coef" type="number" step={0.5} value={s.coef} onChange={(e) => set((x) => { x.coef = Number(e.target.value) || 1; })} /></Field>
        <Field label="Note visée"><Input id="i-target" type="number" step={0.5} value={s.targetGrade} onChange={(e) => set((x) => { x.targetGrade = Number(e.target.value) || 10; })} /></Field>
        <Field label="Documents"><Select id="i-docs" value={s.docsAllowed ? "oui" : "non"} onChange={(e) => set((x) => { x.docsAllowed = e.target.value === "oui"; })}><option value="non">Interdits</option><option value="oui">Autorisés</option></Select></Field>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { regeneratePlan(`Paramètres de ${s.name} modifiés.`); go("planning"); }}>Appliquer et replanifier</Button>
        {!confirm ? (
          <Button variant="danger" onClick={() => setConfirm(true)}>Supprimer la matière</Button>
        ) : (
          <span className="flex items-center gap-2 text-sm">
            Supprimer « {s.name} » et sa progression ?
            <Button variant="danger" size="sm" onClick={() => { update((d) => { d.subjects = d.subjects.filter((x) => x.id !== s.id); }); regeneratePlan(`Matière ${s.name} supprimée.`); go("accueil"); }}>Oui, supprimer</Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Annuler</Button>
          </span>
        )}
      </div>
    </Card>
  );
}
