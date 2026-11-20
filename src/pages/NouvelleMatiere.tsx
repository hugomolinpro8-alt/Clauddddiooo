import { useEffect, useRef, useState } from "react";
import { useApp } from "../lib/store";
import { useUI } from "../ui-state";
import { Button, Card, Field, Input, Select, Textarea, ErrorBox, Segmented } from "../components/ui";
import { MathText } from "../components/MathText";
import { onboardingTurn, type OnboardingFields } from "../lib/ai/tasks";
import { errorMessage } from "../lib/ai/client";
import { addDays, weekdayName } from "../lib/dates";
import type { Availability, ChatMessage, SubjectConfig } from "../lib/types";

const FIRST: ChatMessage = {
  role: "assistant",
  content: "On prépare quelle matière ? Donne-moi le nom, la date du partiel et sa durée. Si tu as déjà tout en tête, écris-le d'un bloc : « Stats, partiel le 8 janvier à 9h, 2h, sans documents, coef 4, je vise 16 ».",
};

export function NouvelleMatiere() {
  const { state, update, createSubject, today } = useApp();
  const { go, setSubjectId } = useUI();
  const draft = state.onboarding ?? { messages: [FIRST], fields: {} };
  const fields = draft.fields as OnboardingFields;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"chat" | "form">("chat");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [draft.messages.length]);

  const setDraft = (fn: (d: typeof draft) => void) => update((s) => { const d = s.onboarding ?? { messages: [FIRST], fields: {} }; fn(d); s.onboarding = d; });

  async function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg && text === undefined) return;
    setError(null);
    const messages: ChatMessage[] = msg ? [...draft.messages, { role: "user", content: msg }] : draft.messages;
    if (msg) setDraft((d) => { d.messages = messages; }); // la réponse de l'étudiant est sauvegardée avant l'appel
    setInput("");
    setBusy(true);
    try {
      const r = await onboardingTurn(messages, fields);
      setDraft((d) => {
        d.messages.push({ role: "assistant", content: r.reply });
        const clean = Object.fromEntries(Object.entries(r.fields).filter(([, v]) => v !== undefined));
        d.fields = { ...(d.fields as object), ...clean };
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  // ---------- Récapitulatif éditable ----------
  const weekly = fields.weeklyHours ?? state.availability.weekly.map((w) => w.hours);
  const setField = (patch: Partial<OnboardingFields>) => setDraft((d) => { d.fields = { ...(d.fields as object), ...patch }; });
  const chapters = fields.chapters ?? [];
  const missing: string[] = [];
  if (!fields.name) missing.push("nom");
  if (!fields.examDate) missing.push("date du partiel");
  if (!fields.durationMin) missing.push("durée");
  if (!fields.coef) missing.push("coefficient");
  if (!fields.targetGrade) missing.push("note visée");

  function validate() {
    const cfg: SubjectConfig = {
      name: fields.name!, examDate: fields.examDate!, examTime: fields.examTime ?? "08:30", durationMin: fields.durationMin!, docsAllowed: !!fields.docsAllowed,
      docsAllowedNote: fields.docsAllowedNote, coef: fields.coef!, targetGrade: fields.targetGrade!, chapters: chapters.filter((c) => c.title.trim()),
    };
    const start = fields.startTime ?? state.availability.weekly[0]?.start ?? "09:00";
    const availability: Availability = {
      weekly: weekly.map((h, i) => ({ start: state.availability.weekly[i]?.start && !fields.startTime ? state.availability.weekly[i].start : start, hours: Number(h) || 0 })),
      blockedDates: Array.from(new Set([...state.availability.blockedDates, ...(fields.blockedDates ?? [])])).sort(),
    };
    const id = createSubject(cfg, availability);
    setSubjectId(id);
    go("matiere");
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Nouvelle matière</p>
          <h1 className="font-display text-3xl font-bold">Onboarding</h1>
        </div>
        <Segmented id="onb-mode" value={mode} onChange={setMode} options={[{ value: "chat", label: "Avec le coach" }, { value: "form", label: "Formulaire seul" }]} />
      </div>

      <div className={`grid gap-5 ${mode === "chat" ? "lg:grid-cols-[1fr_420px]" : ""}`}>
        {mode === "chat" && (
          <Card className="flex flex-col gap-3 min-h-[420px]">
            <div className="flex flex-col gap-3 flex-1 overflow-y-auto max-h-[60vh] pr-1">
              {draft.messages.map((m, i) => (
                <div key={i} className={`max-w-[88%] rounded-xl px-3.5 py-2.5 text-[15px] ${m.role === "user" ? "self-end bg-accent text-accent-ink" : "self-start bg-sunken"}`}>
                  <MathText text={m.content} />
                </div>
              ))}
              {busy && <div className="self-start rounded-xl bg-sunken px-3.5 py-2.5 text-muted text-sm">Le coach réfléchit…</div>}
              <div ref={endRef} />
            </div>
            <ErrorBox error={error} onRetry={() => send("")} />
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!busy) send(); }}>
              <Input id="onb-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ta réponse…" disabled={busy} autoComplete="off" />
              <Button type="submit" loading={busy} disabled={!input.trim()}>Envoyer</Button>
            </form>
          </Card>
        )}

        <Card className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-lg font-semibold">Récapitulatif</p>
            <span className="text-xs text-muted">Tout est modifiable</span>
          </div>
          <Field label="Matière"><Input id="f-name" value={fields.name ?? ""} onChange={(e) => setField({ name: e.target.value })} placeholder="Statistiques 1" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date du partiel"><Input id="f-date" type="date" min={today} value={fields.examDate ?? ""} onChange={(e) => setField({ examDate: e.target.value })} /></Field>
            <Field label="Heure"><Input id="f-time" type="time" value={fields.examTime ?? "08:30"} onChange={(e) => setField({ examTime: e.target.value })} /></Field>
            <Field label="Durée (min)"><Input id="f-dur" type="number" min={15} step={15} value={fields.durationMin ?? ""} onChange={(e) => setField({ durationMin: Number(e.target.value) || undefined })} /></Field>
            <Field label="Coefficient"><Input id="f-coef" type="number" min={0.5} step={0.5} value={fields.coef ?? ""} onChange={(e) => setField({ coef: Number(e.target.value) || undefined })} /></Field>
            <Field label="Note visée (/20)"><Input id="f-target" type="number" min={8} max={20} step={0.5} value={fields.targetGrade ?? ""} onChange={(e) => setField({ targetGrade: Number(e.target.value) || undefined })} /></Field>
            <Field label="Documents"><Select id="f-docs" value={fields.docsAllowed ? "oui" : "non"} onChange={(e) => setField({ docsAllowed: e.target.value === "oui" })}><option value="non">Interdits</option><option value="oui">Autorisés</option></Select></Field>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Heures disponibles par jour</p>
            <div className="grid grid-cols-7 gap-1.5">
              {weekly.map((h, i) => (
                <label key={i} className="flex flex-col items-center gap-1 text-xs text-muted">
                  {weekdayName(i).slice(0, 3)}
                  <Input id={`f-h${i}`} type="number" min={0} max={14} step={0.5} className="text-center px-1" value={h}
                    onChange={(e) => { const w = [...weekly]; w[i] = Number(e.target.value); setField({ weeklyHours: w }); }} />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Début habituel"><Input id="f-start" type="time" value={fields.startTime ?? state.availability.weekly[0]?.start ?? "09:00"} onChange={(e) => setField({ startTime: e.target.value })} /></Field>
              <Field label="Jours bloqués" hint="Dates séparées par des virgules">
                <Input id="f-blocked" value={(fields.blockedDates ?? []).join(", ")} placeholder={addDays(today, 3)}
                  onChange={(e) => setField({ blockedDates: e.target.value.split(/[,\s]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)) })} />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Chapitres et niveau ressenti <span className="text-muted font-normal">(1 = rien compris, 5 = maîtrisé)</span></p>
            {chapters.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <Input id={`f-ch${i}`} value={c.title} onChange={(e) => { const cs = [...chapters]; cs[i] = { ...c, title: e.target.value }; setField({ chapters: cs }); }} />
                <Select id={`f-lv${i}`} className="w-20 shrink-0" value={c.selfLevel} onChange={(e) => { const cs = [...chapters]; cs[i] = { ...c, selfLevel: Number(e.target.value) }; setField({ chapters: cs }); }}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </Select>
                <Button variant="ghost" size="sm" aria-label="Retirer" onClick={() => setField({ chapters: chapters.filter((_, k) => k !== i) })}>×</Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setField({ chapters: [...chapters, { title: "", selfLevel: 3 }] })}>Ajouter un chapitre</Button>
            <p className="text-xs text-muted">Facultatif : l'analyse du cours détectera les chapitres. Les niveaux saisis ici seront conservés.</p>
          </div>

          <Field label="Remarque sur les documents autorisés" hint="Ex. : calculatrice non programmable, une feuille A4 recto">
            <Textarea id="f-docnote" rows={2} value={fields.docsAllowedNote ?? ""} onChange={(e) => setField({ docsAllowedNote: e.target.value })} />
          </Field>

          {missing.length > 0 && <p className="text-sm text-warn">Il manque : {missing.join(", ")}.</p>}
          <Button disabled={missing.length > 0} onClick={validate}>Valider et créer la matière</Button>
        </Card>
      </div>
    </div>
  );
}
