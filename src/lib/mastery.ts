import type { Attempt, Notion, Subject, ISODate } from "./types";
import { diffDays } from "./dates";

/**
 * Score de maîtrise par notion (0-100). Formule volontairement simple et explicable :
 *
 * 1. Point de départ (a priori) : ton niveau ressenti sur le chapitre
 *    (1→10, 2→30, 3→50, 4→70, 5→85), qui compte comme 2 « essais » fictifs.
 * 2. Chaque essai ajoute son score (0-100) avec un poids :
 *    flashcard 0,5 · exercice 1 · annale 1,5 · examen blanc 2,
 *    multiplié par un facteur de fraîcheur 0,5^(âge en jours / 14).
 * 3. Base = moyenne pondérée (a priori + essais).
 * 4. Oubli : si tu n'as pas travaillé la notion depuis t jours,
 *    maîtrise = base × (0,75 + 0,25 × e^(−t/S)), où la stabilité S = 2 × 1,5^(réussites) jours (max 60).
 */
export const PRIOR_BY_LEVEL = [10, 30, 50, 70, 85];
export const PRIOR_WEIGHT = 2;
export const KIND_WEIGHT: Record<Attempt["kind"], number> = {
  flashcard: 0.5,
  exercice: 1,
  annale: 1.5,
  "examen-blanc": 2,
};
export const HALF_LIFE_DAYS = 14;

export interface MasteryResult {
  mastery: number; // 0..100
  prior: number;
  evidence: number; // somme des poids effectifs (n_eff)
  attempts: number;
  lastPractice?: string;
  retention: number; // 0..1
}

export function priorFromLevel(level: number): number {
  const i = Math.max(1, Math.min(5, Math.round(level || 3))) - 1;
  return PRIOR_BY_LEVEL[i];
}

export function computeMastery(
  attempts: Attempt[],
  selfLevel: number,
  today: ISODate,
): MasteryResult {
  const prior = priorFromLevel(selfLevel);
  let num = PRIOR_WEIGHT * prior;
  let den = PRIOR_WEIGHT;
  let successes = 0;
  let last: string | undefined;

  for (const a of attempts) {
    const day = a.date.slice(0, 10);
    const age = Math.max(0, diffDays(today, day));
    const w = KIND_WEIGHT[a.kind] * Math.pow(0.5, age / HALF_LIFE_DAYS);
    num += w * a.score * 100;
    den += w;
    if (a.score >= 0.7) successes++;
    if (!last || day > last) last = day;
  }

  const base = num / den;
  let retention = 1;
  if (last) {
    const t = Math.max(0, diffDays(today, last));
    const S = Math.min(60, 2 * Math.pow(1.5, successes));
    retention = Math.exp(-t / S);
  }
  const mastery = attempts.length ? base * (0.75 + 0.25 * retention) : base;
  return {
    mastery: Math.round(Math.max(0, Math.min(100, mastery)) * 10) / 10,
    prior,
    evidence: den - PRIOR_WEIGHT,
    attempts: attempts.length,
    lastPractice: last,
    retention,
  };
}

export function notionLevel(subject: Subject, notion: Notion): number {
  return subject.chapters.find((c) => c.id === notion.chapterId)?.selfLevel ?? 3;
}

export function attemptsFor(subject: Subject, notionId: string): Attempt[] {
  return subject.attempts.filter((a) => a.notionIds.includes(notionId));
}

export function subjectMastery(subject: Subject, today: ISODate): Record<string, MasteryResult> {
  const out: Record<string, MasteryResult> = {};
  for (const n of subject.notions) {
    out[n.id] = computeMastery(attemptsFor(subject, n.id), notionLevel(subject, n), today);
  }
  return out;
}

/**
 * Notion qui stagne : au moins 3 essais sur les 7 derniers jours
 * et une progression de moins de 5 points entre le début et la fin de cette période.
 */
export function isStagnating(subject: Subject, notion: Notion, today: ISODate): boolean {
  const recent = attemptsFor(subject, notion.id).filter((a) => diffDays(today, a.date.slice(0, 10)) <= 7);
  if (recent.length < 3) return false;
  const sorted = [...recent].sort((a, b) => a.date.localeCompare(b.date));
  const half = Math.ceil(sorted.length / 2);
  const avg = (xs: Attempt[]) => xs.reduce((s, a) => s + a.score, 0) / xs.length;
  const first = avg(sorted.slice(0, half));
  const second = avg(sorted.slice(half));
  return second - first < 0.05 && second < 0.7;
}
