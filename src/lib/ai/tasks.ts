import { z } from "zod";
import { aiJSON, aiText, type AiOptions } from "./client";
import type {
  ChatMessage, Correction, ErrorType, Exercise, Item, Notion, Subject, SubjectConfig,
} from "../types";
import { runCheck, type MathCheck, type CheckOutcome } from "../mathcheck";
import { todayISO, formatDay, addDays } from "../dates";

export const COACH_RULES = `Tu es le coach de préparation aux partiels d'un étudiant de L1 Économie-Mathématiques à TSE (Toulouse School of Economics) qui vise le haut du classement.
Style : exigeant mais bienveillant, direct, concis, sans flatterie, sans emoji. Tu félicites seulement les vrais progrès, tu signales les vrais risques, tu ne valides JAMAIS une réponse fausse ou approximative.
Tout en français. Les mathématiques s'écrivent en LaTeX entre $...$ (en ligne) ou $$...$$ (bloc). Sois rigoureux comme un correcteur de partiel.`;

const JSON_ONLY = "Réponds UNIQUEMENT par un objet JSON valide, sans texte autour, sans bloc ```.";

// ---------- utilitaires de schéma tolérants ----------
const str = z.string().catch("");
const optStr = z.string().nullish().transform((v) => v ?? undefined);
const num = (d: number) => z.coerce.number().catch(d);
const ERR_TYPES = ["calcul", "methode", "redaction", "cours"] as const;
const errType = z.string().transform((v): ErrorType => {
  const s = v.toLowerCase();
  if (s.startsWith("calc")) return "calcul";
  if (s.startsWith("méth") || s.startsWith("meth")) return "methode";
  if (s.startsWith("réd") || s.startsWith("red")) return "redaction";
  return "cours";
});
const ITEM_KINDS = ["definition", "theoreme", "methode", "formule", "mecanisme", "propriete"] as const;
const itemKind = z.string().transform((v) => {
  const s = v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return (ITEM_KINDS.find((k) => s.startsWith(k.slice(0, 5))) ?? "propriete") as Item["kind"];
});

const mathCheck = z.any().transform((v): MathCheck | null => {
  if (!v || typeof v !== "object") return null;
  const t = v.type;
  if (t === "derivative" && v.f && v.result) return { type: t, f: String(v.f), result: String(v.result), variable: v.variable };
  if (t === "equal" && v.a && v.b) return { type: t, a: String(v.a), b: String(v.b), variable: v.variable };
  if (t === "limit" && v.f && v.at != null && v.result != null) return { type: t, f: String(v.f), at: String(v.at), result: String(v.result), variable: v.variable };
  if (t === "value" && v.expr && v.result != null) return { type: t, expr: String(v.expr), result: String(v.result) };
  return null;
});
const checksSchema = z.array(mathCheck).catch([]).transform((xs) => xs.filter((x): x is MathCheck => !!x));

const CHECKS_DOC = `"checks": liste de vérifications calculables par ordinateur (syntaxe mathjs : x^2, exp(x), log(x) pour ln, sqrt(x)), parmi :
  {"type":"derivative","f":"x*exp(-x)","result":"(1-x)*exp(-x)"} | {"type":"limit","f":"(3x^2-x)/(2x^2+5)","at":"Infinity","result":"3/2"} | {"type":"equal","a":"...","b":"..."} | {"type":"value","expr":"...","result":"..."}
  Mets-en une pour chaque résultat intermédiaire calculable (dérivée, limite, valeur). Liste vide si rien n'est calculable.`;

// =====================================================================
// 1. Onboarding conversationnel
// =====================================================================
export const onboardingSchema = z.object({
  reply: str,
  fields: z.object({
    name: optStr,
    examDate: optStr,
    examTime: optStr,
    durationMin: z.coerce.number().nullish().transform((v) => v ?? undefined),
    docsAllowed: z.boolean().nullish().transform((v) => v ?? undefined),
    docsAllowedNote: optStr,
    coef: z.coerce.number().nullish().transform((v) => v ?? undefined),
    targetGrade: z.coerce.number().nullish().transform((v) => v ?? undefined),
    chapters: z.array(z.object({ title: str, selfLevel: num(3) })).nullish().transform((v) => v ?? undefined),
    weeklyHours: z.array(num(0)).nullish().transform((v) => (v && v.length === 7 ? v : undefined)),
    startTime: optStr,
    blockedDates: z.array(z.string()).nullish().transform((v) => v ?? undefined),
  }).catch({} as any),
  done: z.boolean().catch(false),
});
export type OnboardingTurn = z.infer<typeof onboardingSchema>;
export type OnboardingFields = OnboardingTurn["fields"];

export function onboardingTurn(messages: ChatMessage[], fields: OnboardingFields, opts: AiOptions = {}) {
  const today = todayISO();
  const prompt = `${COACH_RULES}

Tu fais l'onboarding d'une nouvelle matière. Aujourd'hui : ${today} (${formatDay(today)}).
Informations à obtenir, en posant 1 ou 2 questions à la fois, courtes :
- nom de la matière ; date (YYYY-MM-DD) et heure (HH:MM) du partiel ; durée de l'épreuve en minutes ; documents autorisés ou non ;
- coefficient ; note visée sur 20 ;
- la liste des chapitres et, pour chacun, le niveau ressenti de 1 (rien compris) à 5 (maîtrisé) ;
- heures disponibles par jour de la semaine (lundi→dimanche), heure de début habituelle, jours bloqués (dates).
Si l'étudiant a déjà des cours importés, il peut dire « les chapitres sont dans le cours » : accepte.
Interprète les dates relatives (« le 14 », « mardi prochain ») par rapport à aujourd'hui. Si une note visée paraît irréaliste vu le temps, dis-le franchement mais garde son choix.
Quand tout est rempli (au minimum nom, date, durée, coefficient, note visée, heures par jour), mets "done": true et résume en une phrase.

Déjà connu : ${JSON.stringify(fields)}

Conversation :
${messages.map((m) => `${m.role === "user" ? "ÉTUDIANT" : "COACH"} : ${m.content}`).join("\n")}

${JSON_ONLY}
Format : {"reply": "ton message à l'étudiant", "fields": {seulement les champs nouveaux ou corrigés : "name","examDate","examTime","durationMin","docsAllowed","docsAllowedNote","coef","targetGrade","chapters":[{"title","selfLevel"}],"weeklyHours":[7 nombres, lundi→dimanche],"startTime","blockedDates":["YYYY-MM-DD"]}, "done": false}`;
  return aiJSON("onboarding", prompt, onboardingSchema, { tier: "main", noCache: true, ...opts }, () => mockOnboarding(messages, fields));
}

function mockOnboarding(messages: ChatMessage[], fields: OnboardingFields): OnboardingTurn {
  const last = messages.filter((m) => m.role === "user").pop()?.content ?? "";
  const f: OnboardingFields = {};
  const date = last.match(/(\d{4}-\d{2}-\d{2})/);
  if (!fields.name && last && !date) f.name = last.slice(0, 60);
  if (date) f.examDate = date[1];
  const n = last.match(/(\d+(?:[.,]\d+)?)/);
  const merged = { ...fields, ...f };
  if (!merged.name) return { reply: "Quelle matière prépare-t-on ? (mode démo : les réponses du coach sont simulées)", fields: f, done: false };
  if (!merged.examDate) return { reply: `Date du partiel de ${merged.name} ? Format AAAA-MM-JJ, par exemple ${addDays(todayISO(), 14)}.`, fields: f, done: false };
  if (!merged.durationMin) { if (n && !date) f.durationMin = Number(n[1]); else return { reply: "Durée de l'épreuve en minutes ?", fields: f, done: false }; }
  else if (!merged.coef) { if (n) f.coef = Number(n[1]); else return { reply: "Coefficient ?", fields: f, done: false }; }
  else if (!merged.targetGrade) { if (n) f.targetGrade = Number(n[1].replace(",", ".")); else return { reply: "Note visée sur 20 ?", fields: f, done: false }; }
  else if (!merged.weeklyHours) { if (n) f.weeklyHours = Array(7).fill(Number(n[1])); else return { reply: "Combien d'heures par jour peux-tu travailler ?", fields: f, done: false }; }
  const m2 = { ...fields, ...f };
  const q = !m2.coef ? "Coefficient de la matière ?" : !m2.targetGrade ? "Note visée sur 20 ?" : !m2.weeklyHours ? "Combien d'heures par jour peux-tu y consacrer, en moyenne ?" : null;
  if (q) return { reply: q, fields: f, done: false };
  return { reply: "C'est noté. Vérifie le récapitulatif à droite, corrige si besoin, puis valide.", fields: { docsAllowed: false, examTime: "08:30", startTime: "09:00", ...f }, done: true };
}

// =====================================================================
// 2. Transcription d'images (photos de notes, PDF scannés, copies)
// =====================================================================
const transcriptionSchema = z.object({ markdown: str });
export function transcribeImages(images: Blob[], context: string, opts: AiOptions = {}) {
  const prompt = `Transcris fidèlement le contenu de ces ${images.length} image(s) (${context}) en Markdown.
Les formules en LaTeX ($...$ ou $$...$$). Garde la structure (titres, numéros de sections, exercices, barèmes).
Si un passage est illisible, écris [illisible]. N'invente rien, ne corrige rien.
${JSON_ONLY} Format : {"markdown": "..."}`;
  return aiJSON("transcription", prompt, transcriptionSchema, { tier: "main", images, ...opts }, () => ({ markdown: `_(mode démo : transcription simulée de ${images.length} image(s))_` }));
}

// =====================================================================
// 3. Analyse du cours
// =====================================================================
export const courseSchema = z.object({
  chapters: z.array(z.object({
    title: str,
    notions: z.array(z.object({
      title: str,
      estHours: num(3),
      items: z.array(z.object({ kind: itemKind, title: str, statement: str, docId: str, section: str, excerpt: str })).catch([]),
    })).catch([]),
  })),
});
export type CourseAnalysis = z.infer<typeof courseSchema>;

export function analyzeCourse(docs: { id: string; name: string; text: string }[], chapterHints: string[], opts: AiOptions = {}) {
  const prompt = `${COACH_RULES}

Analyse ce cours de L1 et découpe-le en chapitres > notions > éléments (définitions, théorèmes, propriétés, méthodes, formules, mécanismes économiques).
Règles :
- Une notion = une compétence évaluable en partiel (ex. « étudier une suite récurrente »), 3 à 6 notions par chapitre.
- Chaque élément cite sa source : "docId", "section" (titre/numéro de section tel qu'écrit dans le document) et "excerpt" : une citation EXACTE et courte (10-25 mots) copiée du document.
- "statement" : l'énoncé complet et rigoureux (hypothèses comprises), en LaTeX. N'ajoute rien qui n'est pas dans le cours.
- "estHours" : heures de travail actif pour passer de zéro à une maîtrise solide de la notion (1 à 6).
${chapterHints.length ? `Chapitres annoncés par l'étudiant (garde ces titres si possible) : ${chapterHints.join(" ; ")}` : ""}

${docs.map((d) => `=== DOCUMENT docId=${d.id} nom="${d.name}" ===\n${d.text}`).join("\n\n")}

${JSON_ONLY}
Format : {"chapters":[{"title":"...","notions":[{"title":"...","estHours":3,"items":[{"kind":"definition|theoreme|propriete|methode|formule|mecanisme","title":"...","statement":"...","docId":"...","section":"...","excerpt":"..."}]}]}]}`;
  return aiJSON("analyse-cours", prompt, courseSchema, { tier: "heavy", ...opts }, () => mockCourse(docs));
}

function mockCourse(docs: { id: string; name: string; text: string }[]): CourseAnalysis {
  const chapters: CourseAnalysis["chapters"] = [];
  for (const d of docs) {
    const parts = d.text.split(/^##\s+/m).slice(1);
    for (const p of parts.length ? parts : [d.text]) {
      const [title, ...rest] = p.split("\n");
      const body = rest.join("\n");
      const secs = body.split(/^###\s+/m).slice(1);
      chapters.push({
        title: title.replace(/^Chapitre\s*\d+\s*[—-]\s*/i, "").trim() || d.name,
        notions: (secs.length ? secs : [body]).map((s) => {
          const [st, ...sb] = s.split("\n");
          const lines = sb.join("\n").split(/(?<=\.)\s+(?=[A-ZÉ])/).filter((l) => l.trim().length > 20);
          return {
            title: st.replace(/^§[\d.]+\s*/, "").trim().slice(0, 80) || "Notion",
            estHours: 2.5,
            items: lines.slice(0, 3).map((l) => ({ kind: (/^Théorème/.test(l) ? "theoreme" : /^Méthode/.test(l) ? "methode" : /^Définition/.test(l) ? "definition" : "propriete") as Item["kind"], title: l.split(/[.:]/)[0].slice(0, 60), statement: l.trim(), docId: d.id, section: st.trim(), excerpt: l.trim().slice(0, 60) })),
          };
        }),
      });
    }
  }
  return { chapters };
}

// =====================================================================
// 4. Analyse des annales
// =====================================================================
export const annalesSchema = z.object({
  summary: str,
  exercises: z.array(z.object({
    docId: str, title: str, statement: str,
    notionIds: z.array(z.string()).catch([]),
    type: str,
    points: z.coerce.number().nullish().transform((v) => v ?? undefined),
    year: optStr,
  })),
  typeDescriptions: z.array(z.object({ type: str, description: str })).catch([]),
});
export type AnnalesAnalysis = z.infer<typeof annalesSchema>;

export function analyzeAnnales(annales: { id: string; name: string; text: string }[], notions: Notion[], opts: AiOptions = {}) {
  const prompt = `${COACH_RULES}

Analyse ces annales de partiel. Pour CHAQUE exercice : docId, titre (« Exercice 2 »), énoncé résumé fidèlement (LaTeX), notions mobilisées (ids de la liste ci-dessous uniquement), type d'exercice générique et réutilisable entre annales (ex. « Étude de suite récurrente », « Optimisation sous contrainte », « Calcul de limites »), points du barème s'il est indiqué (sinon null), année si visible.
Puis : "typeDescriptions" décrit chaque type d'exercice récurrent (méthode attendue en 1-2 phrases), et "summary" donne en 3-4 phrases ce qui rapporte le plus de points et les pièges récurrents.

Notions du cours (id : titre) :
${notions.map((n) => `${n.id} : ${n.title}`).join("\n")}

${annales.map((d) => `=== ANNALE docId=${d.id} nom="${d.name}" ===\n${d.text}`).join("\n\n")}

${JSON_ONLY}
Format : {"summary":"...","exercises":[{"docId":"...","title":"...","statement":"...","notionIds":["..."],"type":"...","points":5,"year":"2025"}],"typeDescriptions":[{"type":"...","description":"..."}]}`;
  return aiJSON("analyse-annales", prompt, annalesSchema, { tier: "heavy", ...opts }, () => mockAnnales(annales, notions));
}

function mockAnnales(annales: { id: string; name: string; text: string }[], notions: Notion[]): AnnalesAnalysis {
  const exercises: AnnalesAnalysis["exercises"] = [];
  for (const a of annales) {
    const parts = a.text.split(/(?=Exercice\s+\d+)/i).filter((p) => /^Exercice/i.test(p));
    for (const p of parts) {
      const words = p.toLowerCase();
      const ids = notions.filter((n) => n.title.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => words.includes(w))).map((n) => n.id).slice(0, 3);
      const pts = p.match(/\((\d+)\s*points?\)/i);
      exercises.push({ docId: a.id, title: p.split(/[.(]/)[0].trim(), statement: p.slice(0, 300), notionIds: ids.length ? ids : notions.slice(0, 1).map((n) => n.id), type: ids.length ? notions.find((n) => n.id === ids[0])!.title : "Divers", points: pts ? Number(pts[1]) : undefined, year: a.name.match(/20\d\d/)?.[0] });
    }
  }
  return { summary: "(mode démo) Analyse simulée par mots-clés. Ouvre l'app sur claude.ai pour une vraie analyse.", exercises, typeDescriptions: [] };
}

// =====================================================================
// 5. Génération d'exercice + vérification
// =====================================================================
const baremeSchema = z.array(z.object({ step: str, points: num(1) })).catch([]);
export const genExerciseSchema = z.object({
  title: str,
  statement: str,
  difficulty: z.coerce.number().catch(2).transform((v) => Math.max(1, Math.min(3, Math.round(v))) as 1 | 2 | 3),
  hints: z.array(z.string()).catch([]),
  solution: str,
  bareme: baremeSchema,
  finalAnswer: z.string().nullish().transform((v) => v ?? undefined),
  checks: checksSchema,
});
type GenExercise = z.infer<typeof genExerciseSchema>;

const verifySchema = z.object({
  status: z.string().transform((v) => (v.toLowerCase().startsWith("ok") ? "ok" : "corrige") as "ok" | "corrige"),
  notes: str,
  solution: z.string().nullish(),
  bareme: z.array(z.object({ step: str, points: num(1) })).nullish(),
  finalAnswer: z.string().nullish(),
});

function notionContext(subject: Subject, notionIds: string[]): string {
  return subject.notions
    .filter((n) => notionIds.includes(n.id))
    .map((n) => `### ${n.title}\n${n.items.map((i) => `- (${i.kind}) ${i.title} : ${i.statement}${i.source ? ` [source : ${i.source.section}]` : ""}`).join("\n")}`)
    .join("\n\n");
}

function annalesContext(subject: Subject, notionIds: string[], max = 3): string {
  const ex = subject.examExercises.filter((e) => e.notionIds.some((id) => notionIds.includes(id))).slice(0, max);
  return ex.length ? ex.map((e) => `- [${e.year ?? "?"}, ${e.points ?? "?"} pts, type « ${e.type} »] ${e.statement}`).join("\n") : "(pas d'annale sur ces notions)";
}

export async function generateExercise(subject: Subject, notionIds: string[], difficulty: 1 | 2 | 3, opts: AiOptions = {}): Promise<Exercise> {
  const prompt = `${COACH_RULES}

Crée UN exercice de partiel de ${subject.name} dans le style exact des annales ci-dessous, difficulté ${difficulty}/3, faisable en ${difficulty === 1 ? 15 : difficulty === 2 ? 25 : 40} minutes.
Il doit porter sur ces notions et n'utiliser QUE ce qui est dans le cours :
${notionContext(subject, notionIds)}

Exercices d'annales similaires :
${annalesContext(subject, notionIds)}

Fournis :
- "statement" : énoncé en questions numérotées (LaTeX).
- "hints" : EXACTEMENT 3 indices progressifs, méthode socratique : (1) une question qui oriente vers la bonne méthode sans la nommer, (2) la méthode et le premier pas, (3) le résultat intermédiaire clé. Aucun ne donne la réponse finale.
- "solution" : corrigé complet, rédigé comme attendu au partiel, étape par étape.
- "bareme" : étapes notées dont la somme fait ${difficulty === 1 ? 4 : difficulty === 2 ? 6 : 8} points.
- "finalAnswer" : le résultat final principal (expression ou valeur), ou null.
${CHECKS_DOC}
Vérifie tes calculs deux fois avant de répondre.

${JSON_ONLY}
Format : {"title":"...","statement":"...","difficulty":${difficulty},"hints":["...","...","..."],"solution":"...","bareme":[{"step":"...","points":1.5}],"finalAnswer":"...","checks":[]}`;
  const gen = await aiJSON("generation-exercice", prompt, genExerciseSchema, { tier: "main", noCache: true, ...opts }, () => mockExercise(subject, notionIds, difficulty));
  return verifyExercise(subject, notionIds, gen, opts);
}

/** Second appel indépendant + calcul symbolique pour vérifier le corrigé généré. */
async function verifyExercise(subject: Subject, notionIds: string[], gen: GenExercise, opts: AiOptions): Promise<Exercise> {
  const outcomes = gen.checks.map(runCheck);
  const failed = outcomes.filter((o) => o.ok === false);
  const prompt = `Tu es un correcteur de mathématiques/économie très rigoureux. Vérifie ce corrigé d'exercice de L1, ligne par ligne : calculs, justifications, cohérence du barème.
Énoncé :
${gen.statement}

Corrigé proposé :
${gen.solution}

Barème : ${JSON.stringify(gen.bareme)}
Résultat final annoncé : ${gen.finalAnswer ?? "(aucun)"}
${failed.length ? `ATTENTION, le calcul automatique contredit : ${failed.map((f) => `${JSON.stringify(f.check)} → ${f.detail}`).join(" ; ")}` : ""}

Si tout est juste : {"status":"ok","notes":"..."}. Sinon : {"status":"corrige","notes":"ce qui était faux","solution":"corrigé entièrement corrigé","bareme":[...],"finalAnswer":"..."}.
${JSON_ONLY}`;
  let verification: Exercise["verification"];
  let solution = gen.solution, bareme = gen.bareme, finalAnswer = gen.finalAnswer;
  try {
    const v = await aiJSON("verification-exercice", prompt, verifySchema, { tier: "main", ...opts }, () => ({ status: "ok" as const, notes: "Vérification simulée (mode démo).", solution: null, bareme: null, finalAnswer: null }));
    if (v.status === "corrige") {
      solution = v.solution || solution;
      bareme = v.bareme?.length ? v.bareme : bareme;
      finalAnswer = v.finalAnswer ?? finalAnswer;
    }
    const auto = describeChecks(outcomes);
    verification = { status: (v.status === "ok" && failed.length ? "doute" : v.status) as NonNullable<Exercise["verification"]>["status"], notes: [v.notes, auto].filter(Boolean).join(" ") };
  } catch (e) {
    verification = { status: "non-verifie", notes: "La vérification n'a pas pu être faite (réseau). Corrigé à prendre avec prudence." };
  }
  return {
    id: "ex-" + Math.random().toString(36).slice(2, 10),
    subjectId: subject.id,
    notionIds,
    title: gen.title,
    statement: gen.statement,
    difficulty: gen.difficulty,
    hints: (gen.hints.length >= 3 ? gen.hints.slice(0, 3) : [...gen.hints, "Relis l'énoncé du théorème du cours qui correspond.", "Écris la première étape du corrigé type."].slice(0, 3)),
    solution, bareme, finalAnswer,
    verification,
    createdAt: new Date().toISOString(),
  };
}

function describeChecks(o: CheckOutcome[]): string {
  if (!o.length) return "";
  const ok = o.filter((x) => x.ok === true).length;
  const ko = o.filter((x) => x.ok === false).length;
  return `Calcul automatique : ${ok} vérification(s) confirmée(s)${ko ? `, ${ko} en désaccord` : ""}.`;
}

function mockExercise(subject: Subject, notionIds: string[], difficulty: 1 | 2 | 3): GenExercise {
  const n = subject.notions.find((x) => x.id === notionIds[0]);
  const existing = subject.exercises.find((e) => e.notionIds.some((id) => notionIds.includes(id)));
  if (existing) return { ...existing, checks: [{ type: "derivative", f: "(x^2+1)*exp(-x)", result: "-(x-1)^2*exp(-x)" }] } as GenExercise;
  return {
    title: `Entraînement : ${n?.title ?? "notion"}`,
    statement: `(Mode démo : exercice simulé.) Soit $f(x) = x e^{-x}$.\n1. Calculer $f'(x)$.\n2. En déduire le maximum de $f$ sur $\\mathbb{R}$.`,
    difficulty,
    hints: ["Quelle règle de dérivation s'applique à un produit ?", "Pose $u = x$ et $v = e^{-x}$, puis applique $(uv)' = u'v + uv'$.", "Tu dois obtenir $f'(x) = (1-x)e^{-x}$ : étudie son signe."],
    solution: "$f'(x) = e^{-x} - xe^{-x} = (1-x)e^{-x}$, du signe de $1-x$. Donc $f$ croît sur $]-\\infty,1]$, décroît sur $[1,+\\infty[$ : maximum $f(1) = e^{-1}$.",
    bareme: [{ step: "Dérivée correcte", points: 2 }, { step: "Signe de f'", points: 1.5 }, { step: "Maximum et sa valeur", points: 1.5 }],
    finalAnswer: "f'(x) = (1-x)e^{-x}",
    checks: [{ type: "derivative", f: "x*exp(-x)", result: "(1-x)*exp(-x)" }],
  };
}

// =====================================================================
// 6. Correction d'une réponse + vérification de la correction
// =====================================================================
const correctionSchema = z.object({
  steps: z.array(z.object({ label: str, awarded: num(0), max: num(1), comment: str })),
  errors: z.array(z.object({ type: errType, detail: str })).catch([]),
  feedback: str,
  correctedSolution: str,
  studentFinalAnswer: z.string().nullish(),
});
const correctionCheckSchema = z.object({
  status: z.string().transform((v) => (v.toLowerCase().startsWith("ok") ? "ok" : "corrige") as "ok" | "corrige"),
  notes: str,
  steps: z.array(z.object({ label: str, awarded: num(0), max: num(1), comment: str })).nullish(),
  errors: z.array(z.object({ type: errType, detail: str })).nullish(),
});

export async function correctAnswer(subject: Subject, ex: Exercise, answer: string, images: Blob[], hintsUsed: number, opts: AiOptions = {}): Promise<Correction> {
  const outOf = ex.bareme.reduce((s, b) => s + b.points, 0) || 5;
  const prompt = `${COACH_RULES}

Corrige la copie de l'étudiant comme un correcteur de partiel de ${subject.name}, en appliquant STRICTEMENT le barème. Pas de points pour un résultat juste sans justification si la justification est exigée. Une erreur de calcul coûte des points même si la méthode est bonne.
${images.length ? `La copie est (aussi) en photo : ${images.length} image(s). Lis-la attentivement ; si un passage est illisible, dis-le.` : ""}
L'étudiant a utilisé ${hintsUsed} indice(s) sur 3 (n'enlève pas de points pour ça, mais mentionne-le dans le retour si c'est pertinent).

ÉNONCÉ :
${ex.statement}

CORRIGÉ DE RÉFÉRENCE :
${ex.solution}

BARÈME (total ${outOf}) :
${ex.bareme.map((b) => `- ${b.step} : ${b.points} pt`).join("\n")}

COPIE DE L'ÉTUDIANT :
${answer || "(voir photo)"}

Pour chaque ligne du barème : points accordés et commentaire précis (ce qui est juste, ce qui manque).
Classe chaque erreur : "calcul" (faute de calcul), "methode" (mauvaise démarche), "redaction" (justification ou rédaction insuffisante), "cours" (théorème/définition pas su ou mal cité).
"feedback" : 2-4 phrases directes : le verdict, l'erreur la plus coûteuse, ce qu'il faut retravailler.
"correctedSolution" : la copie de l'étudiant corrigée à partir de l'endroit où elle déraille (ou « RAS » si parfaite).
"studentFinalAnswer" : son résultat final tel qu'écrit (syntaxe mathjs si possible), ou null.
${JSON_ONLY}
Format : {"steps":[{"label":"...","awarded":1,"max":1.5,"comment":"..."}],"errors":[{"type":"calcul","detail":"..."}],"feedback":"...","correctedSolution":"...","studentFinalAnswer":null}`;

  const c = await aiJSON("correction", prompt, correctionSchema, { tier: "main", images, noCache: true, ...opts }, () => mockCorrection(ex, answer));

  // Vérification automatique du résultat final quand c'est calculable.
  let autoNote = "";
  let autoDisagree = false;
  if (ex.finalAnswer && c.studentFinalAnswer) {
    const rhs = (s: string) => s.split("=").pop()!.trim();
    const r = runCheck({ type: "equal", a: rhs(ex.finalAnswer), b: rhs(c.studentFinalAnswer) });
    if (r.ok === true) autoNote = "Calcul automatique : ton résultat final est équivalent à celui du corrigé.";
    if (r.ok === false) { autoNote = "Calcul automatique : ton résultat final diffère de celui du corrigé."; autoDisagree = true; }
  }

  // Second appel : un autre correcteur vérifie la correction.
  const stepsTotal = c.steps.reduce((s, x) => s + x.awarded, 0);
  let verification: Correction["verification"] = { status: "non-verifie", notes: "" };
  let steps = c.steps, errors = c.errors;
  try {
    const vprompt = `Tu es correcteur en second d'un partiel de L1. Vérifie la correction ci-dessous : chaque point accordé ou retiré est-il justifié ? Le correcteur a-t-il validé une erreur, ou sanctionné à tort une réponse juste (y compris une méthode différente mais correcte) ?
ÉNONCÉ : ${ex.statement}
CORRIGÉ : ${ex.solution}
COPIE : ${answer || "(photo, voir la transcription dans les commentaires)"}
CORRECTION PROPOSÉE : ${JSON.stringify({ steps: c.steps, errors: c.errors })}
${autoNote ? `Info calcul automatique : ${autoNote}` : ""}
Si la correction est juste : {"status":"ok","notes":"..."}. Sinon : {"status":"corrige","notes":"ce qui change et pourquoi","steps":[...barème corrigé, même format...],"errors":[...]}.
${JSON_ONLY}`;
    const v = await aiJSON("verification-correction", vprompt, correctionCheckSchema, { tier: "main", images, noCache: true, ...opts }, () => ({ status: "ok" as const, notes: "Contre-correction simulée (mode démo).", steps: null, errors: null }));
    if (v.status === "corrige" && v.steps?.length) { steps = v.steps; errors = v.errors ?? errors; }
    verification = { status: (v.status === "ok" && autoDisagree && stepsTotal >= outOf * 0.9 ? "doute" : v.status) as Correction["verification"]["status"], notes: [v.notes, autoNote].filter(Boolean).join(" ") };
  } catch {
    verification = { status: "non-verifie", notes: "Contre-correction impossible (réseau) : note provisoire. " + autoNote };
  }
  const score = Math.min(outOf, Math.max(0, steps.reduce((s, x) => s + x.awarded, 0)));
  return { score: Math.round(score * 4) / 4, outOf, steps, errors, feedback: c.feedback, correctedSolution: c.correctedSolution, verification };
}

function mockCorrection(ex: Exercise, answer: string): z.infer<typeof correctionSchema> {
  const kw = (ex.solution.match(/[a-zA-Zé]{5,}/g) ?? []).map((w) => w.toLowerCase());
  const a = answer.toLowerCase();
  const ratio = kw.length ? kw.filter((w) => a.includes(w)).length / kw.length : 0;
  const quality = Math.min(1, ratio * 1.5 + (answer.length > 80 ? 0.2 : 0));
  return {
    steps: ex.bareme.map((b) => ({ label: b.step, max: b.points, awarded: Math.round(b.points * quality * 4) / 4, comment: quality > 0.7 ? "Correct." : "Incomplet ou non justifié." })),
    errors: quality < 0.7 ? [{ type: "redaction", detail: "(démo) Justification insuffisante." }] : [],
    feedback: "(Mode démo : correction simulée par mots-clés. La vraie correction est faite par Claude dans l'app sur claude.ai.)",
    correctedSolution: ex.solution,
    studentFinalAnswer: null,
  };
}

// =====================================================================
// 7. Mini-cours ciblé (streaming)
// =====================================================================
export function miniCours(subject: Subject, notion: Notion, sourceExcerpts: string, question: string, opts: AiOptions & { onText?: (t: string) => void } = {}) {
  const prompt = `${COACH_RULES}

Fais un mini-cours ciblé (lecture : 5 minutes max) sur la notion « ${notion.title} » de ${subject.name}${question ? `, en répondant précisément à ce qui bloque l'étudiant : « ${question} »` : ""}.
Appuie-toi UNIQUEMENT sur le cours fourni ci-dessous et cite la section source entre crochets après chaque élément, par exemple [Ch. 1 — §1.2].
Si tu dois utiliser quelque chose qui n'est PAS dans le cours, signale-le clairement par « ⚠ Hors cours : » au début de la phrase.
Structure : 1) l'idée en 2 phrases ; 2) l'énoncé exact (hypothèses !) ; 3) la méthode type en étapes numérotées ; 4) un exemple court entièrement rédigé ; 5) les 2 pièges classiques en partiel ; 6) une question de vérification à laquelle l'étudiant doit répondre seul.
Markdown, LaTeX.

ÉLÉMENTS DU COURS :
${notion.items.map((i) => `- (${i.kind}) ${i.title} : ${i.statement} [${i.source?.section ?? "?"}]`).join("\n")}

EXTRAITS DU COURS :
${sourceExcerpts || "(aucun extrait disponible)"}`;
  return aiText("mini-cours", prompt, { tier: "main", ...opts }, () => `**Mode démo** : mini-cours simulé sur « ${notion.title} ».\n\n${notion.items.map((i) => `- **${i.title}** : ${i.statement} [${i.source?.section ?? "cours"}]`).join("\n")}\n\n**Question de vérification** : énonce le théorème principal sans regarder, hypothèses comprises.`);
}

// =====================================================================
// 8. Examen blanc
// =====================================================================
const mockExamSchema = z.object({ exercises: z.array(genExerciseSchema.extend({ notionIds: z.array(z.string()).catch([]) })) });

export async function generateMockExam(subject: Subject, opts: AiOptions = {}): Promise<Exercise[]> {
  const prompt = `${COACH_RULES}

Construis un sujet d'examen blanc de ${subject.name}, ${subject.durationMin} minutes, ${subject.docsAllowed ? "documents autorisés" : "sans documents"}, total EXACTEMENT 20 points, qui ressemble le plus possible aux vraies annales (même structure, mêmes types d'exercices, même longueur), avec des énoncés NOUVEAUX.
Couvre en priorité les notions à fort poids. N'utilise que le contenu du cours.

Notions (id : titre : poids dans les annales) :
${subject.notions.map((n) => `${n.id} : ${n.title} : ${Math.round(n.weight * 100)} %`).join("\n")}

Exercices des annales :
${subject.examExercises.map((e) => `- [${e.year ?? "?"}, ${e.points ?? "?"} pts, « ${e.type} »] ${e.statement}`).join("\n")}

Pour chaque exercice : "notionIds" (de la liste), "statement", "hints" (3 indices, ils ne seront montrés qu'après), "solution" complète, "bareme" (somme de tous les exercices = 20), "finalAnswer", ${CHECKS_DOC}
${JSON_ONLY}
Format : {"exercises":[{"title":"Exercice 1","notionIds":["..."],"statement":"...","difficulty":2,"hints":["...","...","..."],"solution":"...","bareme":[{"step":"...","points":2}],"finalAnswer":"...","checks":[]}]}`;
  const r = await aiJSON("examen-blanc", prompt, mockExamSchema, { tier: "heavy", noCache: true, ...opts }, () => ({
    exercises: subject.examExercises.slice(0, 4).map((e, i) => ({
      title: `Exercice ${i + 1}`, notionIds: e.notionIds, statement: `(Mode démo : reprise d'annale) ${e.statement}`, difficulty: 2 as const,
      hints: ["Identifie le type d'exercice.", "Rappelle la méthode du cours.", "Écris la première étape."], solution: "(démo) Corrigé non disponible hors claude.ai.",
      bareme: [{ step: "Exercice complet", points: 5 }], finalAnswer: undefined, checks: [],
    })),
  }));
  // Vérification symbolique de chaque corrigé
  return r.exercises.map((g, i) => {
    const out = g.checks.map(runCheck);
    const bad = out.filter((o) => o.ok === false);
    return {
      id: `mock-${Date.now().toString(36)}-${i}`, subjectId: subject.id, notionIds: g.notionIds.filter((id) => subject.notions.some((n) => n.id === id)),
      title: g.title || `Exercice ${i + 1}`, statement: g.statement, difficulty: g.difficulty, hints: g.hints.slice(0, 3), solution: g.solution,
      bareme: g.bareme, finalAnswer: g.finalAnswer, createdAt: new Date().toISOString(),
      verification: { status: bad.length ? "doute" : out.length ? "ok" : "non-verifie", notes: bad.length ? `Calcul automatique en désaccord : ${bad.map((b) => b.detail).join(" ; ")}` : describeChecks(out) },
    } as Exercise;
  });
}

// =====================================================================
// 9. Messages du coach : check-in du matin, bilan du soir
// =====================================================================
export function coachMessage(kind: "checkin" | "bilan", context: string, opts: AiOptions & { onText?: (t: string) => void } = {}) {
  const prompt = `${COACH_RULES}

${kind === "checkin"
    ? "C'est le check-in du début de journée. En 4 à 6 phrases : réagis à l'énergie et au temps disponible annoncés, donne LA priorité du jour et pourquoi, et un conseil concret d'exécution (ordre des blocs, pauses, conditions de travail). Si le temps disponible est très réduit, dis ce qu'on sacrifie aujourd'hui."
    : "C'est le bilan de fin de journée. En 4 à 7 phrases : le travail réellement fait vs prévu (chiffres), les vrais progrès (seulement s'ils sont réels), le risque principal, et ce qui change demain. Termine par une consigne pour ce soir (sommeil, 10 min de flashcards, etc.)."}

CONTEXTE :
${context}`;
  return aiText(kind === "checkin" ? "check-in" : "bilan", prompt, { tier: "quick", noCache: true, ...opts }, () =>
    kind === "checkin"
      ? "(Mode démo) Bien reçu. Priorité du jour : le premier bloc d'exercices, sans téléphone. Commence par les flashcards pour te mettre en route, puis enchaîne sans relire le cours avant d'avoir essayé."
      : "(Mode démo) Bilan simulé : compare les blocs faits aux blocs prévus ci-dessus. Demain, on commence par ce qui n'a pas été fait aujourd'hui.");
}
