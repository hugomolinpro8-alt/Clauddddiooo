import type {
  Availability, BlockType, DayKind, ISODate, Notion, Plan, PlanBlock, PlanDay, Subject, TriageReport,
} from "./types";
import type { MasteryResult } from "./mastery";
import { addDays, dateRange, diffDays, minToTime, timeToMin, weekdayIndex, formatDay } from "./dates";

/*
 * Moteur de rétroplanning — 100 % déterministe (pas d'IA), donc testable.
 *
 * Priorité d'une notion = poids dans les annales × (1 − maîtrise/100)
 * Besoin en heures      = heures estimées × (maîtrise cible − maîtrise)/100 × 1,2
 * Rendement (triage)    = points gagnables / heure = 20 × poids × écart / besoin
 *
 * Répartition entre matières (chaque créneau de 50 min) :
 *   score = coefficient × besoin restant / jours restants avant le partiel
 * Rappels espacés : une notion vue pour la première fois revient à J+1, J+3, J+7.
 * Alternance : jamais deux fois la même notion principale dans une journée si on a le choix,
 * et les blocs d'exercices mélangent une 2e notion.
 */

export const SLOT_MIN = 50;
export const PAUSE_MIN = 10;
export const FLASH_MIN = 20;
export const VEILLE_MAX_MIN = 90;
export const CORRECTION_MIN = 45;
export const REVIEW_OFFSETS = [1, 3, 7];

export interface PlannerInput {
  subjects: Subject[];
  availability: Availability;
  today: ISODate;
  mastery: Record<string, Record<string, MasteryResult>>;
  /** Minutes réellement disponibles aujourd'hui (check-in). */
  todayMinutes?: number;
  /** Notions qui stagnent (ids). */
  stagnating?: string[];
  /** Blocs déjà faits aujourd'hui (conservés en tête de journée). */
  keepToday?: PlanBlock[];
  idSeed?: string;
}

export function targetMastery(targetGrade: number): number {
  return Math.max(60, Math.min(95, targetGrade * 5 + 10));
}

export function notionNeedHours(n: Notion, mastery: number, target: number): number {
  const gap = Math.max(0, target - mastery);
  return (n.estHours * gap * 1.2) / 100;
}

interface NotionState {
  notion: Notion;
  subjectId: string;
  mastery: number;
  priority: number;
  need: number;
  remaining: number;
  times: number;
  reviews: ISODate[];
  kept: boolean;
  hasAnnale: boolean;
  stagnating: boolean;
}

interface DayWork {
  date: ISODate;
  capacity: number;
  free: number;
  kinds: Set<DayKind>;
  reserved: { subjectId: string; type: BlockType; minutes: number; objective: string; atTime?: string }[];
  slots: string[]; // subjectId par créneau
  flash: string[]; // subjectIds
  notes: string[];
}

let counter = 0;
function mkId(seed: string) {
  counter = (counter + 1) % 1_000_000;
  return `${seed}-${counter.toString(36)}`;
}

export function buildPlan(input: PlannerInput): Plan {
  const { availability, today } = input;
  const seed = input.idSeed ?? "b" + Date.now().toString(36);
  const warnings: string[] = [];
  const stagn = new Set(input.stagnating ?? []);

  const subjects = input.subjects
    .filter((s) => s.examDate >= today)
    .sort((a, b) => a.examDate.localeCompare(b.examDate));

  if (!subjects.length) {
    return { id: seed, generatedAt: new Date().toISOString(), from: today, days: [], triage: [], warnings: ["Aucun partiel à venir : ajoute une matière avec sa date de partiel."] };
  }

  const lastExam = subjects[subjects.length - 1].examDate;
  const dates = dateRange(today, addDays(lastExam, 1));

  // ---------- Capacité par jour ----------
  const days: DayWork[] = dates.map((date) => {
    const blocked = availability.blockedDates.includes(date);
    const w = availability.weekly[weekdayIndex(date)] ?? { start: "09:00", hours: 0 };
    let capacity = blocked ? 0 : Math.round(w.hours * 60);
    if (date === today && input.todayMinutes != null) capacity = Math.max(0, Math.round(input.todayMinutes));
    return { date, capacity, free: capacity, kinds: new Set<DayKind>(), reserved: [], slots: [], flash: [], notes: [] };
  });
  const dayOf = (d: ISODate) => days.find((x) => x.date === d);

  // Blocs déjà faits aujourd'hui : on retire leur durée de la capacité.
  const keep = input.keepToday ?? [];
  if (keep.length && days[0]) {
    const used = keep.reduce((s, b) => s + b.durationMin + PAUSE_MIN, 0);
    days[0].free = Math.max(0, days[0].free - used);
  }

  // Jours de partiel
  for (const s of subjects) {
    const d = dayOf(s.examDate);
    if (!d) continue;
    d.kinds.add("partiel");
    d.reserved.push({ subjectId: s.id, type: "partiel", minutes: 0, objective: `Partiel de ${s.name} (${s.durationMin} min). Arrive en avance, relis ta fiche méthode 15 min, pas plus.`, atTime: s.examTime });
    // Le jour d'un partiel, on ne garde que la moitié du temps pour les autres matières.
    d.free = Math.floor(d.free * 0.5);
  }

  // ---------- Réservations : veille, examen blanc, jour tampon ----------
  const mockDayOf: Record<string, ISODate | undefined> = {};
  for (const s of subjects) {
    const study = days.filter((d) => d.date < s.examDate && d.capacity > 0);
    if (!study.length) {
      warnings.push(`${s.name} : aucun jour disponible avant le partiel. Il faut libérer du temps.`);
      continue;
    }
    const veille = dayOf(addDays(s.examDate, -1));
    if (veille && veille.capacity > 0 && study.length >= 2) {
      const m = Math.min(VEILLE_MAX_MIN - FLASH_MIN - 5, veille.free - FLASH_MIN - 5);
      if (m >= 30) {
        veille.kinds.add("veille");
        veille.reserved.push({ subjectId: s.id, type: "fiches", minutes: m, objective: `Veille du partiel de ${s.name} : relecture des fiches et des flashcards ratées, rien de nouveau. Couché tôt : le sommeil consolide ce que tu as appris.` });
        // Veille allégée : rien d'autre que les fiches et les flashcards ce jour-là.
        veille.free = 0;
        veille.notes.push(`Veille de ${s.name} : journée allégée.`);
      }
    }

    // Examen blanc : J-3, puis J-2, J-4, puis le jour possible le plus tardif.
    const need = s.durationMin + CORRECTION_MIN;
    const candidates = [-3, -2, -4].map((k) => dayOf(addDays(s.examDate, k)));
    let mock = candidates.find((d) => d && d.date >= today && !d.kinds.has("veille") && d.free >= need);
    if (!mock) {
      mock = [...study].reverse().find((d) => !d.kinds.has("veille") && d.free >= need);
    }
    if (!mock) {
      mock = [...study].reverse().find((d) => !d.kinds.has("veille") && d.free >= s.durationMin);
    }
    if (mock) {
      const corr = Math.min(CORRECTION_MIN, mock.free - s.durationMin);
      mock.kinds.add("examen-blanc");
      mock.reserved.push({ subjectId: s.id, type: "examen-blanc", minutes: s.durationMin, objective: `Examen blanc de ${s.name} chronométré : ${s.durationMin} min, ${s.docsAllowed ? "documents autorisés comme au partiel" : "sans documents"}, téléphone dans une autre pièce.`, atTime: undefined });
      mock.free -= s.durationMin + PAUSE_MIN;
      if (corr > 0) {
        mock.reserved.push({ subjectId: s.id, type: "correction-examen", minutes: corr, objective: `Corriger l'examen blanc et noter chaque erreur dans ta fiche « pièges ».` });
        mock.free -= corr + PAUSE_MIN;
      }
      mockDayOf[s.id] = mock.date;
      const dist = diffDays(s.examDate, mock.date);
      if (dist < 2 || dist > 4) warnings.push(`${s.name} : l'examen blanc tombe à J-${dist} (idéal : J-4 à J-2) faute de créneau assez long.`);
    } else {
      warnings.push(`${s.name} : pas de créneau de ${s.durationMin} min pour un examen blanc. Libère une demi-journée avant le partiel.`);
    }

    // Jour tampon : seulement si au moins 7 jours de travail.
    if (study.length >= 7) {
      const limit = mockDayOf[s.id] ?? addDays(s.examDate, -1);
      const tampon = [...study].reverse().find((d) => d.date < limit && !d.kinds.has("veille") && !d.kinds.has("examen-blanc") && !d.kinds.has("tampon") && d.free > 0);
      if (tampon) {
        const m = Math.round(tampon.free * 0.6);
        tampon.kinds.add("tampon");
        tampon.reserved.push({ subjectId: s.id, type: "tampon", minutes: m, objective: `Jour tampon : rattrape les blocs en retard. Si tu es à jour, fais une annale complète de ${s.name}.` });
        tampon.free -= m;
      }
    } else {
      warnings.push(`${s.name} : moins de 7 jours de travail, pas de jour tampon possible. Aucun retard n'est absorbable.`);
    }
  }

  // ---------- État des notions ----------
  const ns: Record<string, NotionState[]> = {};
  const needTotal: Record<string, number> = {};
  for (const s of subjects) {
    const target = targetMastery(s.targetGrade);
    const annaleNotions = new Set(s.examExercises.flatMap((e) => e.notionIds));
    ns[s.id] = s.notions.map((n) => {
      const m = input.mastery[s.id]?.[n.id]?.mastery ?? 50;
      const need = n.sacrificed ? 0 : notionNeedHours(n, m, target);
      return {
        notion: n, subjectId: s.id, mastery: m, priority: Math.max(0.0001, n.weight) * (1 - m / 100),
        need, remaining: need, times: 0, reviews: [], kept: !n.sacrificed, hasAnnale: annaleNotions.has(n.id), stagnating: stagn.has(n.id),
      };
    });
    needTotal[s.id] = ns[s.id].reduce((a, x) => a + x.need, 0);
    if (!s.notions.length) warnings.push(`${s.name} : aucune notion détectée. Ajoute ton cours et lance l'analyse pour un planning précis.`);
  }

  // ---------- Créneaux : flashcards + slots de 50 min répartis entre matières ----------
  const remainingNeed: Record<string, number> = { ...needTotal };
  const slotsCount: Record<string, number> = {};
  for (const d of days) {
    const active = subjects.filter((s) => s.examDate > d.date && s.notions.length);
    if (!active.length) continue;
    if (d.kinds.has("veille")) {
      // la veille : 20 min de flashcards seulement, prises sur le temps des fiches
      for (const s of active.filter((x) => addDays(x.examDate, -1) === d.date)) d.flash.push(s.id);
      continue;
    }
    if (d.free <= 0) continue;
    // Flashcards : 20 min par matière active si la journée le permet, sinon la plus proche.
    const flashFor = d.free >= active.length * (FLASH_MIN + 5) + SLOT_MIN ? active : active.slice(0, 1);
    for (const s of flashFor) {
      if (d.free < FLASH_MIN) break;
      d.flash.push(s.id);
      d.free -= FLASH_MIN + 5;
    }
    const nSlots = Math.floor((d.free + PAUSE_MIN) / (SLOT_MIN + PAUSE_MIN));
    const today: Record<string, number> = {};
    for (let i = 0; i < nSlots; i++) {
      let best: Subject | null = null;
      let bestScore = -1;
      for (const s of active) {
        const daysLeft = Math.max(1, days.filter((x) => x.date >= d.date && x.date < s.examDate && x.capacity > 0).length);
        const need = remainingNeed[s.id] > 0 ? remainingNeed[s.id] : 0.15;
        const score = (s.coef * need) / daysLeft / (1 + (today[s.id] ?? 0) * 0.35);
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (!best) break;
      d.slots.push(best.id);
      today[best.id] = (today[best.id] ?? 0) + 1;
      slotsCount[best.id] = (slotsCount[best.id] ?? 0) + 1;
      remainingNeed[best.id] -= SLOT_MIN / 60;
    }
    d.free -= nSlots * (SLOT_MIN + PAUSE_MIN);
  }

  // ---------- Triage ----------
  const triage: TriageReport[] = [];
  for (const s of subjects) {
    const available = ((slotsCount[s.id] ?? 0) * SLOT_MIN) / 60;
    const need = needTotal[s.id];
    const report: TriageReport = { subjectId: s.id, needHours: round1(need), availableHours: round1(available), sufficient: need <= available + 0.01, kept: [], sacrificed: [] };
    const list = ns[s.id];
    for (const x of list) if (x.notion.sacrificed) report.sacrificed.push({ notionId: x.notion.id, reason: "Sacrifiée manuellement." });
    if (!report.sufficient) {
      // Rendement = points gagnables par heure de travail.
      const target = targetMastery(s.targetGrade);
      const cands = list.filter((x) => x.kept && x.need > 0).sort((a, b) => rendement(b, target) - rendement(a, target));
      let acc = 0;
      for (const x of cands) {
        if (acc + x.need <= available || acc === 0) {
          acc += x.need;
        } else {
          x.kept = false;
          const pts = 20 * x.notion.weight;
          report.sacrificed.push({
            notionId: x.notion.id,
            reason: `${round1(x.need)} h nécessaires pour une notion qui pèse ~${round1(pts)} pt(s) au partiel : rendement trop faible face au temps restant. Gardée en flashcards seulement.`,
          });
        }
      }
    }
    report.kept = list.filter((x) => x.kept).map((x) => x.notion.id);
    triage.push(report);
    if (!report.sufficient) {
      warnings.push(`${s.name} : il faudrait ${round1(need)} h pour viser ${s.targetGrade}/20, tu en as ${round1(available)}. Plan « triage » activé.`);
    }
  }

  // ---------- Attribution des notions aux créneaux (chronologique) ----------
  const outDays: PlanDay[] = [];
  for (const d of days) {
    const blocks: PlanBlock[] = [];
    const dayIdx = weekdayIndex(d.date);
    let cursor = timeToMin(availability.weekly[dayIdx]?.start ?? "09:00");
    if (d.date === today) {
      for (const b of keep) {
        blocks.push(b);
        cursor = Math.max(cursor, timeToMin(b.start) + b.durationMin + PAUSE_MIN);
      }
    }
    const push = (b: Omit<PlanBlock, "id" | "start" | "status">, at?: string) => {
      const start = at ?? minToTime(cursor);
      blocks.push({ ...b, id: mkId(seed), start, status: "todo" });
      if (!at) cursor += b.durationMin + (b.durationMin >= SLOT_MIN ? PAUSE_MIN : 5);
    };

    // 1. Examen blanc en premier (conditions réelles, esprit frais) puis sa correction.
    for (const r of d.reserved.filter((r) => r.type === "examen-blanc" || r.type === "correction-examen")) {
      push({ subjectId: r.subjectId, durationMin: r.minutes, type: r.type, notionIds: [], objective: r.objective });
    }
    // 2. Flashcards (échauffement, récupération active)
    for (const sid of d.flash) {
      push({ subjectId: sid, durationMin: FLASH_MIN, type: "flashcards", notionIds: [], objective: "Cartes dues du jour : réponds de tête AVANT de retourner la carte, sois honnête sur la note." });
    }
    // 3. Créneaux de travail
    const usedToday = new Set<string>();
    for (const sid of d.slots) {
      const list = ns[sid];
      const pick = pickNotion(list, d.date, usedToday);
      if (!pick) continue;
      usedToday.add(pick.notion.id);
      const isReview = pick.times > 0 && pick.reviews.includes(d.date);
      let type: BlockType = "exercices";
      if ((pick.times === 0 && pick.mastery < 40) || (pick.stagnating && pick.times === 0)) type = "mini-cours";
      else if (pick.hasAnnale && (pick.mastery >= 55 || pick.times >= 2)) type = "annale";
      const notionIds = [pick.notion.id];
      if (type === "exercices") {
        const second = pickNotion(list.filter((x) => x !== pick), d.date, usedToday, true);
        if (second && second.times > 0) notionIds.push(second.notion.id);
      }
      push({ subjectId: sid, durationMin: SLOT_MIN, type, notionIds, objective: objectiveFor(type, pick, list, notionIds), review: isReview });
      if (pick.times === 0) pick.reviews = REVIEW_OFFSETS.map((k) => addDays(d.date, k));
      pick.times += 1;
      pick.remaining -= SLOT_MIN / 60;
    }
    // 4. Tampon / veille
    for (const r of d.reserved.filter((r) => r.type === "tampon" || r.type === "fiches")) {
      push({ subjectId: r.subjectId, durationMin: r.minutes, type: r.type, notionIds: [], objective: r.objective });
    }
    // 5. Partiel
    for (const r of d.reserved.filter((r) => r.type === "partiel")) {
      const s = subjects.find((x) => x.id === r.subjectId)!;
      push({ subjectId: r.subjectId, durationMin: s.durationMin, type: "partiel", notionIds: [], objective: r.objective }, r.atTime);
    }

    blocks.sort((a, b) => timeToMin(a.start) - timeToMin(b.start));
    const kinds = [...d.kinds];
    if (!kinds.length) kinds.push(d.capacity > 0 ? "travail" : "off");
    outDays.push({ date: d.date, kinds, capacityMin: d.capacity, blocks, note: d.notes.join(" ") || undefined });
  }

  return { id: seed, generatedAt: new Date().toISOString(), from: today, days: outDays, triage, warnings };
}

function rendement(x: NotionState, target: number): number {
  const gap = Math.max(0, target - x.mastery);
  return x.need > 0 ? (20 * x.notion.weight * gap) / 100 / x.need : 0;
}

function pickNotion(list: NotionState[], date: ISODate, usedToday: Set<string>, secondary = false): NotionState | null {
  let best: NotionState | null = null;
  let bestScore = -1;
  const pool = list.filter((x) => x.kept).length ? list.filter((x) => x.kept) : list;
  for (const x of pool) {
    let score = x.priority;
    score *= x.remaining > 0 ? 1 : 0.15 / (1 + 0.4 * x.times); // déjà « couverte » : révision, en variant
    if (x.reviews.includes(date)) score *= 1.8; // rappel espacé dû
    if (usedToday.has(x.notion.id)) score *= secondary ? 0 : 0.05; // alternance
    if (x.stagnating) score *= 1.3;
    if (score > bestScore) { bestScore = score; best = x; }
  }
  return bestScore > 0 ? best : null;
}

function objectiveFor(type: BlockType, pick: NotionState, list: NotionState[], ids: string[]): string {
  const name = pick.notion.title;
  const other = ids[1] ? list.find((x) => x.notion.id === ids[1])?.notion.title : undefined;
  switch (type) {
    case "mini-cours":
      return pick.stagnating
        ? `« ${name} » stagne : mini-cours ciblé sur le point qui bloque, puis 2 exercices courts pour vérifier.`
        : `Découvrir « ${name} » : mini-cours (15 min max) puis exercices d'application immédiats. Pas de relecture passive.`;
    case "annale":
      return `Exercice d'annale sur « ${name} » en temps limité, puis correction notée selon le barème.`;
    default:
      return other
        ? `Exercices mélangés « ${name} » + « ${other} » : identifier la méthode sans indice, rédiger comme au partiel.`
        : `Exercices sur « ${name} » : 2-3 exercices de difficulté croissante, indices seulement si bloqué 5 min.`;
  }
}

function round1(x: number) {
  return Math.round(x * 10) / 10;
}

// ---------- Utilitaires ----------

export function planMinutesBySubject(plan: Plan, from: ISODate): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of plan.days) {
    if (d.date < from) continue;
    for (const b of d.blocks) {
      if (b.type === "partiel") continue;
      out[b.subjectId] = (out[b.subjectId] ?? 0) + b.durationMin;
    }
  }
  return out;
}

export function blockLabel(t: BlockType): string {
  return {
    exercices: "Exercices",
    "mini-cours": "Mini-cours + exos",
    annale: "Annale",
    flashcards: "Flashcards",
    "examen-blanc": "Examen blanc",
    "correction-examen": "Correction examen blanc",
    fiches: "Fiches (veille)",
    tampon: "Tampon / rattrapage",
    partiel: "PARTIEL",
  }[t];
}

/** Résumé lisible d'un plan pour les prompts du coach. */
export function describeDay(day: PlanDay, subjects: Subject[]): string {
  const name = (id: string) => subjects.find((s) => s.id === id)?.name ?? "?";
  const notion = (sid: string, nid: string) => subjects.find((s) => s.id === sid)?.notions.find((n) => n.id === nid)?.title ?? nid;
  return [
    `${formatDay(day.date)} (${day.kinds.join(", ")})`,
    ...day.blocks.map((b) => `- ${b.start} ${b.durationMin} min · ${name(b.subjectId)} · ${blockLabel(b.type)}${b.notionIds.length ? " · " + b.notionIds.map((n) => notion(b.subjectId, n)).join(" + ") : ""} [${b.status}]`),
  ].join("\n");
}
