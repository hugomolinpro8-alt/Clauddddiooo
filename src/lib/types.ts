// Modèle de données de l'application (tout est sérialisable en JSON).

export type ISODate = string; // "2026-12-04"

export type ItemKind = "definition" | "theoreme" | "methode" | "formule" | "mecanisme" | "propriete";

export interface SourceRef {
  docId: string;
  section: string; // "Chapitre 2 — §2.3 Théorème des gendarmes"
  excerpt: string; // citation courte
  verified?: boolean; // l'extrait a été retrouvé tel quel dans le document
}

export interface Item {
  id: string;
  kind: ItemKind;
  title: string;
  statement: string; // markdown + LaTeX
  source?: SourceRef;
}

export interface Chapter {
  id: string;
  title: string;
  selfLevel: number; // 1..5, niveau ressenti
}

export interface Notion {
  id: string;
  chapterId: string;
  title: string;
  items: Item[];
  /** Poids de la notion dans le partiel (0..1, somme = 1 sur la matière). Modifiable. */
  weight: number;
  /** Nombre d'exercices d'annales qui la mobilisent. */
  frequency: number;
  /** Points moyens par annale qui en dépendent. */
  points: number;
  /** Heures estimées pour passer de 0 à maîtrise solide. */
  estHours: number;
  /** Notion sacrifiée par l'étudiant ou le triage (forcé manuellement). */
  sacrificed?: boolean;
}

export interface ExamExercise {
  id: string;
  docId: string;
  title: string;
  statement: string;
  notionIds: string[];
  type: string; // "étude de suite récurrente", "calcul de limite"...
  points?: number;
  year?: string;
}

export interface DocMeta {
  id: string;
  name: string;
  role: "cours" | "annale" | "notes";
  mime: string;
  chars: number;
  pages?: number;
  addedAt: string;
  analyzed?: boolean;
  status: "pret" | "extraction" | "erreur";
  error?: string;
}

export interface ExerciseType {
  type: string;
  count: number;
  notionIds: string[];
  description: string;
}

export interface AnalysisReport {
  generatedAt: string;
  summary: string;
  exerciseTypes: ExerciseType[];
  annalesCount: number;
  notes?: string; // remarques de l'étudiant (modifiable)
}

export interface SM2State {
  ef: number;
  interval: number; // jours
  reps: number;
  due: ISODate;
  lapses: number;
}

export interface Flashcard {
  id: string;
  notionId: string;
  front: string;
  back: string;
  sm2: SM2State;
  sourceSection?: string;
}

export type ErrorType = "calcul" | "methode" | "redaction" | "cours";

export interface Attempt {
  id: string;
  date: string; // ISO datetime
  kind: "exercice" | "flashcard" | "examen-blanc" | "annale";
  notionIds: string[];
  score: number; // 0..1
  errors?: { type: ErrorType; detail: string }[];
  refId?: string;
}

export interface Exercise {
  id: string;
  subjectId: string;
  notionIds: string[];
  title: string;
  statement: string;
  difficulty: 1 | 2 | 3;
  hints: string[]; // 3 niveaux
  solution: string;
  bareme: { step: string; points: number }[];
  finalAnswer?: string;
  fromAnnale?: string; // id d'exercice d'annale
  verification?: { status: "ok" | "corrige" | "doute" | "non-verifie"; notes: string };
  createdAt: string;
}

export interface Correction {
  score: number;
  outOf: number;
  steps: { label: string; awarded: number; max: number; comment: string }[];
  errors: { type: ErrorType; detail: string }[];
  feedback: string;
  correctedSolution: string;
  verification: { status: "ok" | "corrige" | "doute" | "non-verifie"; notes: string };
}

export interface ExerciseSession {
  id: string;
  exerciseId: string;
  blockId?: string;
  hintsShown: number;
  answer: string;
  hadPhoto: boolean;
  correction?: Correction;
  status: "en-cours" | "correction" | "corrige" | "erreur";
  error?: string;
  updatedAt: string;
}

export interface MockExam {
  id: string;
  subjectId: string;
  createdAt: string;
  durationMin: number;
  exercises: Exercise[];
  answers: Record<string, string>;
  startedAt?: string;
  submittedAt?: string;
  corrections: Record<string, Correction>;
  grade?: number; // /20
  status: "pret" | "en-cours" | "a-corriger" | "corrige";
}

export interface Subject {
  id: string;
  name: string;
  color: string;
  examDate: ISODate;
  examTime: string; // "08:30"
  durationMin: number;
  docsAllowed: boolean;
  docsAllowedNote?: string;
  coef: number;
  targetGrade: number; // /20
  chapters: Chapter[];
  notions: Notion[];
  examExercises: ExamExercise[];
  documents: DocMeta[];
  analysis: AnalysisReport | null;
  cards: Flashcard[];
  attempts: Attempt[];
  exercises: Exercise[];
  sessions: ExerciseSession[];
  mockExams: MockExam[];
  createdAt: string;
}

export interface DayAvailability {
  start: string; // "09:00"
  hours: number; // 0 = jour off
}

export interface Availability {
  weekly: DayAvailability[]; // index 0 = lundi ... 6 = dimanche
  blockedDates: ISODate[];
}

export type BlockType =
  | "exercices"
  | "mini-cours"
  | "annale"
  | "flashcards"
  | "examen-blanc"
  | "correction-examen"
  | "fiches"
  | "tampon"
  | "partiel";

export type BlockStatus = "todo" | "done" | "partial" | "skipped";

export interface PlanBlock {
  id: string;
  subjectId: string;
  start: string; // "HH:MM"
  durationMin: number;
  type: BlockType;
  notionIds: string[];
  objective: string;
  status: BlockStatus;
  review?: boolean; // révision espacée
}

export type DayKind = "travail" | "tampon" | "examen-blanc" | "veille" | "partiel" | "off";

export interface PlanDay {
  date: ISODate;
  kinds: DayKind[];
  capacityMin: number;
  blocks: PlanBlock[];
  note?: string;
}

export interface TriageReport {
  subjectId: string;
  needHours: number;
  availableHours: number;
  sufficient: boolean;
  kept: string[];
  sacrificed: { notionId: string; reason: string }[];
}

export interface Plan {
  id: string;
  generatedAt: string;
  from: ISODate;
  days: PlanDay[];
  triage: TriageReport[];
  warnings: string[];
}

export interface PlanChange {
  id: string;
  date: string;
  reasons: string[];
  changes: string[];
}

export interface CheckIn {
  date: ISODate;
  energy: number; // 1..5
  availableHours: number;
  note?: string;
  coachMessage?: string;
  bilan?: { message: string; createdAt: string };
}

export interface ForecastPoint {
  date: ISODate;
  subjectId: string;
  expected: number;
  low: number;
  high: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface OnboardingDraft {
  messages: ChatMessage[];
  fields: Partial<SubjectConfig>;
}

export interface SubjectConfig {
  name: string;
  examDate: ISODate;
  examTime: string;
  durationMin: number;
  docsAllowed: boolean;
  docsAllowedNote?: string;
  coef: number;
  targetGrade: number;
  chapters: { title: string; selfLevel: number }[];
}

export interface AppState {
  version: 1;
  subjects: Subject[];
  availability: Availability;
  plan: Plan | null;
  planChanges: PlanChange[];
  checkins: CheckIn[];
  forecasts: ForecastPoint[];
  onboarding: OnboardingDraft | null;
  aiCalls: number;
  lastOpened?: ISODate;
}
