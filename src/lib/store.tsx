import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, Attempt, Availability, BlockStatus, CheckIn, Subject, SubjectConfig, DocMeta, Notion, Chapter } from "./types";
import { initStorage, type Storage } from "./runtime";
import { todayISO } from "./dates";
import { makeDemoSubject } from "./seed";
import { replan, detectReplanReasons } from "./replan";
import { forecastSubject } from "./forecast";
import { reviewSM2, capForExam, qualityToScore } from "./sm2";
import { computeWeights, exerciseTypes, cardsFromNotions, verifyExcerpt } from "./analysis";
import { analyzeCourse, analyzeAnnales } from "./ai/tasks";
import { aiAvailable, onAiCall } from "./ai/client";
import { extractFile } from "./ingest";

export const COLORS = ["#2B59C3", "#C2410C", "#0F766E", "#7C3AED", "#B45309", "#BE185D"];

export function defaultAvailability(): Availability {
  return { weekly: [5, 5, 5, 5, 5, 6, 3].map((h) => ({ start: "09:00", hours: h })), blockedDates: [] };
}

export function emptyState(): AppState {
  return { version: 1, subjects: [], availability: defaultAvailability(), plan: null, planChanges: [], checkins: [], forecasts: [], onboarding: null, aiCalls: 0 };
}

export const uid = (p = "") => p + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

type SaveStatus = "chargement" | "enregistre" | "enregistrement" | "erreur";

interface Ctx {
  state: AppState;
  ready: boolean;
  saveStatus: SaveStatus;
  storageMode: "cloud" | "local";
  aiLive: boolean;
  today: string;
  update: (fn: (s: AppState) => void) => void;
  subject: (id: string) => Subject | undefined;
  updateSubject: (id: string, fn: (s: Subject) => void) => void;
  getDocText: (docId: string) => Promise<string>;
  loadDemo: () => Promise<void>;
  resetAll: () => Promise<void>;
  createSubject: (cfg: SubjectConfig, availability?: Availability) => string;
  addDocuments: (subjectId: string, files: File[], role: DocMeta["role"]) => Promise<void>;
  addPastedDocument: (subjectId: string, name: string, text: string, role: DocMeta["role"]) => Promise<void>;
  removeDocument: (subjectId: string, docId: string) => void;
  analyzeSubject: (subjectId: string, onStep?: (s: string) => void) => Promise<void>;
  regeneratePlan: (reason?: string) => void;
  setBlockStatus: (date: string, blockId: string, status: BlockStatus) => void;
  recordAttempts: (subjectId: string, attempts: Omit<Attempt, "id" | "date">[]) => void;
  reviewCard: (subjectId: string, cardId: string, quality: number) => void;
  saveCheckin: (c: CheckIn) => void;
  docProgress: Record<string, string>;
}

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp hors AppProvider");
  return c;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(emptyState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("chargement");
  const [aiLive, setAiLive] = useState(false);
  const [docProgress, setDocProgress] = useState<Record<string, string>>({});
  const storage = useRef<Storage | null>(null);
  const docCache = useRef(new Map<string, string>());
  const stateRef = useRef(state);
  stateRef.current = state;
  const today = todayISO();

  const update = useCallback((fn: (s: AppState) => void) => {
    setState((prev) => {
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
  }, []);

  // ---------- Chargement ----------
  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await initStorage();
      storage.current = st;
      let loaded: AppState | null = null;
      try { loaded = st.remote ? await st.remote.get<AppState>("state") : null; } catch { /* réseau */ }
      if (!loaded) { try { loaded = await st.local.get<AppState>("state"); } catch { /* vide */ } }
      if (!alive) return;
      if (loaded?.version === 1) setState({ ...emptyState(), ...loaded });
      setReady(true);
      setSaveStatus("enregistre");
      setAiLive(await aiAvailable());
    })();
    const off = onAiCall((e) => { if (!e.mock) setState((s) => ({ ...s, aiCalls: s.aiCalls + 1 })); });
    return () => { alive = false; off(); };
  }, []);

  // ---------- Sauvegarde automatique (anti-rebond) ----------
  const saveTimer = useRef<number | undefined>();
  const saving = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!ready) return;
    setSaveStatus("enregistrement");
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const snapshot = stateRef.current;
      saving.current = saving.current.then(async () => {
        const st = storage.current!;
        try {
          await st.local.set("state", snapshot);
          if (st.remote) await st.remote.set("state", snapshot);
          setSaveStatus("enregistre");
        } catch {
          setSaveStatus("erreur");
        }
      });
    }, 900);
  }, [state, ready]);

  // ---------- Routine quotidienne : replanification + point de prévision ----------
  const dailyDone = useRef(false);
  useEffect(() => {
    if (!ready || dailyDone.current) return;
    dailyDone.current = true;
    const s = stateRef.current;
    if (s.lastOpened === today) return;
    update((d) => {
      if (d.plan) {
        const ctx = detectReplanReasons(d, today);
        if (ctx.reasons.length) {
          const r = replan(d, today, ["Nouvelle journée."]);
          d.plan = r.plan;
          d.planChanges.unshift(r.change);
        }
      }
      pushForecasts(d, today);
      d.lastOpened = today;
    });
  }, [ready, today, update]);

  // ---------- Documents ----------
  const docKey = (id: string) => `doc-${id}`;
  const saveDoc = useCallback(async (id: string, text: string) => {
    docCache.current.set(id, text);
    const st = storage.current!;
    await st.local.set(docKey(id), { text }).catch(() => {});
    if (st.remote) await st.remote.set(docKey(id), { text });
  }, []);
  const getDocText = useCallback(async (id: string) => {
    if (docCache.current.has(id)) return docCache.current.get(id)!;
    const st = storage.current;
    let v: { text: string } | null = null;
    if (st?.remote) { try { v = await st.remote.get(docKey(id)); } catch { /* */ } }
    if (!v && st) { try { v = await st.local.get(docKey(id)); } catch { /* */ } }
    const text = v?.text ?? "";
    docCache.current.set(id, text);
    return text;
  }, []);

  const subject = useCallback((id: string) => state.subjects.find((s) => s.id === id), [state.subjects]);
  const updateSubject = useCallback((id: string, fn: (s: Subject) => void) => {
    update((d) => { const s = d.subjects.find((x) => x.id === id); if (s) fn(s); });
  }, [update]);

  const regeneratePlan = useCallback((reason?: string) => {
    update((d) => {
      const r = replan(d, today, reason ? [reason] : []);
      d.plan = r.plan;
      d.planChanges.unshift(r.change);
      d.planChanges = d.planChanges.slice(0, 40);
      pushForecasts(d, today);
    });
  }, [update, today]);

  const loadDemo = useCallback(async () => {
    const { subject: s, docs } = makeDemoSubject(today);
    for (const [id, text] of Object.entries(docs)) await saveDoc(id, text);
    update((d) => {
      d.subjects = d.subjects.filter((x) => x.id !== s.id);
      d.subjects.push(s);
      const r = replan(d, today, ["Démo chargée."]);
      d.plan = r.plan;
      d.planChanges.unshift(r.change);
      pushForecasts(d, today);
    });
  }, [today, saveDoc, update]);

  const resetAll = useCallback(async () => {
    const st = storage.current!;
    for (const s of stateRef.current.subjects) for (const doc of s.documents) {
      await st.local.remove(docKey(doc.id)).catch(() => {});
      if (st.remote) await st.remote.remove(docKey(doc.id)).catch(() => {});
    }
    docCache.current.clear();
    setState(emptyState());
  }, []);

  const createSubject = useCallback((cfg: SubjectConfig, availability?: Availability) => {
    const id = uid("s-");
    update((d) => {
      const chapters: Chapter[] = cfg.chapters.map((c) => ({ id: uid("c-"), title: c.title, selfLevel: c.selfLevel }));
      d.subjects.push({
        id, name: cfg.name, color: COLORS[d.subjects.length % COLORS.length], examDate: cfg.examDate, examTime: cfg.examTime, durationMin: cfg.durationMin,
        docsAllowed: cfg.docsAllowed, docsAllowedNote: cfg.docsAllowedNote, coef: cfg.coef, targetGrade: cfg.targetGrade, chapters,
        notions: [], examExercises: [], documents: [], analysis: null, cards: [], attempts: [], exercises: [], sessions: [], mockExams: [], createdAt: new Date().toISOString(),
      });
      if (availability) d.availability = availability;
      d.onboarding = null;
      const r = replan(d, today, [`Nouvelle matière : ${cfg.name}.`]);
      d.plan = r.plan;
      d.planChanges.unshift(r.change);
    });
    return id;
  }, [update, today]);

  const addPastedDocument = useCallback(async (subjectId: string, name: string, text: string, role: DocMeta["role"]) => {
    const id = uid("d-");
    await saveDoc(id, text);
    updateSubject(subjectId, (s) => { s.documents.push({ id, name, role, mime: "text/plain", chars: text.length, addedAt: new Date().toISOString(), status: "pret" }); });
  }, [saveDoc, updateSubject]);

  const addDocuments = useCallback(async (subjectId: string, files: File[], role: DocMeta["role"]) => {
    for (const file of files) {
      const id = uid("d-");
      updateSubject(subjectId, (s) => { s.documents.push({ id, name: file.name, role, mime: file.type, chars: 0, addedAt: new Date().toISOString(), status: "extraction" }); });
      try {
        const r = await extractFile(file, role === "annale" ? "annale de partiel" : "cours", (m) => setDocProgress((p) => ({ ...p, [id]: m })));
        await saveDoc(id, r.text);
        updateSubject(subjectId, (s) => {
          const d = s.documents.find((x) => x.id === id);
          if (d) Object.assign(d, { status: "pret", chars: r.text.length, pages: r.pages, error: undefined });
        });
      } catch (e: any) {
        updateSubject(subjectId, (s) => {
          const d = s.documents.find((x) => x.id === id);
          if (d) Object.assign(d, { status: "erreur", error: e?.message ?? String(e) });
        });
      } finally {
        setDocProgress((p) => { const n = { ...p }; delete n[id]; return n; });
      }
    }
  }, [saveDoc, updateSubject]);

  const removeDocument = useCallback((subjectId: string, docId: string) => {
    updateSubject(subjectId, (s) => { s.documents = s.documents.filter((d) => d.id !== docId); });
    const st = storage.current!;
    st.local.remove(docKey(docId)).catch(() => {});
    st.remote?.remove(docKey(docId)).catch(() => {});
    docCache.current.delete(docId);
  }, [updateSubject]);

  const analyzeSubject = useCallback(async (subjectId: string, onStep?: (s: string) => void) => {
    const s = stateRef.current.subjects.find((x) => x.id === subjectId);
    if (!s) return;
    const courseDocs = s.documents.filter((d) => d.status === "pret" && d.role !== "annale");
    const annaleDocs = s.documents.filter((d) => d.status === "pret" && d.role === "annale");
    if (!courseDocs.length) throw new Error("Ajoute au moins un document de cours avant l'analyse.");
    const texts = await Promise.all(courseDocs.map(async (d) => ({ id: d.id, name: d.name, text: await getDocText(d.id) })));
    onStep?.("Analyse du cours par Claude (modèle le plus puissant, 1 à 3 min)…");
    const course = await analyzeCourse(texts, s.chapters.map((c) => c.title));

    // Fusion : on conserve les niveaux ressentis saisis à l'onboarding (correspondance par titre).
    const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, "");
    const chapters: Chapter[] = [];
    const notions: Notion[] = [];
    for (const ch of course.chapters) {
      const old = s.chapters.find((c) => norm(c.title).includes(norm(ch.title)) || norm(ch.title).includes(norm(c.title)));
      const cid = old?.id ?? uid("c-");
      chapters.push({ id: cid, title: ch.title, selfLevel: old?.selfLevel ?? 3 });
      for (const n of ch.notions) {
        const prev = s.notions.find((x) => norm(x.title) === norm(n.title));
        notions.push({
          id: prev?.id ?? uid("n-"), chapterId: cid, title: n.title, estHours: Math.max(0.5, Math.min(8, n.estHours)), weight: 0, frequency: 0, points: 0, sacrificed: prev?.sacrificed,
          items: n.items.map((it) => {
            const doc = texts.find((t) => t.id === it.docId) ?? texts[0];
            return { id: uid("i-"), kind: it.kind, title: it.title, statement: it.statement, source: { docId: doc.id, section: it.section, excerpt: it.excerpt, verified: verifyExcerpt(doc.text, it.excerpt) } };
          }),
        });
      }
    }

    let exercises = s.examExercises;
    let summary = "Aucune annale fournie : les poids des notions sont uniformes. Ajoute des annales pour un planning bien plus précis.";
    let typeDesc: Record<string, string> = {};
    if (annaleDocs.length) {
      onStep?.("Analyse des annales (exercices, barèmes, fréquences)…");
      const annTexts = await Promise.all(annaleDocs.map(async (d) => ({ id: d.id, name: d.name, text: await getDocText(d.id) })));
      const ann = await analyzeAnnales(annTexts, notions);
      exercises = ann.exercises.map((e) => ({ id: uid("a-"), docId: e.docId, title: e.title, statement: e.statement, notionIds: e.notionIds.filter((id) => notions.some((n) => n.id === id)), type: e.type || "Divers", points: e.points, year: e.year }));
      summary = ann.summary;
      typeDesc = Object.fromEntries(ann.typeDescriptions.map((t) => [t.type, t.description]));
    }
    onStep?.("Calcul des poids et génération du programme…");
    const weighted = computeWeights(notions, exercises);
    update((d) => {
      const x = d.subjects.find((y) => y.id === subjectId)!;
      x.chapters = chapters;
      x.notions = weighted;
      x.examExercises = exercises;
      x.analysis = { generatedAt: new Date().toISOString(), summary, exerciseTypes: exerciseTypes(exercises, typeDesc), annalesCount: annaleDocs.length, notes: x.analysis?.notes };
      x.cards = [...x.cards.filter((c) => weighted.some((n) => n.id === c.notionId)), ...cardsFromNotions(weighted, today, x.cards)];
      for (const doc of x.documents) if (doc.status === "pret") doc.analyzed = true;
      const r = replan(d, today, [`Analyse de ${x.name} terminée.`]);
      d.plan = r.plan;
      d.planChanges.unshift(r.change);
      pushForecasts(d, today);
    });
  }, [getDocText, update, today]);

  const setBlockStatus = useCallback((date: string, blockId: string, status: BlockStatus) => {
    update((d) => {
      const b = d.plan?.days.find((x) => x.date === date)?.blocks.find((x) => x.id === blockId);
      if (b) b.status = status;
    });
  }, [update]);

  const recordAttempts = useCallback((subjectId: string, attempts: Omit<Attempt, "id" | "date">[]) => {
    update((d) => {
      const s = d.subjects.find((x) => x.id === subjectId);
      if (!s) return;
      for (const a of attempts) s.attempts.push({ ...a, id: uid("t-"), date: new Date().toISOString() });
      pushForecasts(d, today);
    });
  }, [update, today]);

  const reviewCard = useCallback((subjectId: string, cardId: string, quality: number) => {
    update((d) => {
      const s = d.subjects.find((x) => x.id === subjectId);
      const c = s?.cards.find((x) => x.id === cardId);
      if (!s || !c) return;
      c.sm2 = capForExam(reviewSM2(c.sm2, quality, today), today, s.examDate);
      s.attempts.push({ id: uid("t-"), date: new Date().toISOString(), kind: "flashcard", notionIds: [c.notionId], score: qualityToScore(quality), refId: c.id });
    });
  }, [update, today]);

  const saveCheckin = useCallback((c: CheckIn) => {
    update((d) => {
      d.checkins = [c, ...d.checkins.filter((x) => x.date !== c.date)].slice(0, 120);
    });
  }, [update]);

  const value = useMemo<Ctx>(() => ({
    state, ready, saveStatus, storageMode: storage.current?.mode ?? "local", aiLive, today, update, subject, updateSubject, getDocText, loadDemo, resetAll, createSubject,
    addDocuments, addPastedDocument, removeDocument, analyzeSubject, regeneratePlan, setBlockStatus, recordAttempts, reviewCard, saveCheckin, docProgress,
  }), [state, ready, saveStatus, aiLive, today, update, subject, updateSubject, getDocText, loadDemo, resetAll, createSubject, addDocuments, addPastedDocument, removeDocument, analyzeSubject, regeneratePlan, setBlockStatus, recordAttempts, reviewCard, saveCheckin, docProgress]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

/** Enregistre (ou met à jour) le point de prévision du jour pour chaque matière. */
export function pushForecasts(d: AppState, today: string) {
  for (const s of d.subjects) {
    if (!s.notions.length) continue;
    const f = forecastSubject(s, today);
    d.forecasts = d.forecasts.filter((p) => !(p.date === today && p.subjectId === s.id));
    d.forecasts.push({ date: today, subjectId: s.id, expected: f.expected, low: f.low, high: f.high });
  }
  d.forecasts = d.forecasts.slice(-400);
}
