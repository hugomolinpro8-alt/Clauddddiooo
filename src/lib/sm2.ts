import type { ISODate, SM2State } from "./types";
import { addDays } from "./dates";

/**
 * Algorithme SM-2 (Wozniak, 1987).
 * quality : 0..5 (0-2 = raté, 3 = difficile, 4 = correct, 5 = facile).
 */
export function initialSM2(today: ISODate): SM2State {
  return { ef: 2.5, interval: 0, reps: 0, due: today, lapses: 0 };
}

export function reviewSM2(state: SM2State, quality: number, today: ISODate): SM2State {
  const q = Math.max(0, Math.min(5, Math.round(quality)));
  let { ef, interval, reps, lapses } = state;

  if (q < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ef);
  }
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;

  return { ef: Math.round(ef * 1000) / 1000, interval, reps, lapses, due: addDays(today, interval) };
}

/**
 * Variante « bachotage » : à l'approche du partiel, on plafonne l'intervalle
 * pour que la carte revienne au moins une fois avant l'épreuve.
 */
export function capForExam(state: SM2State, today: ISODate, examDate: ISODate): SM2State {
  if (state.due >= examDate) {
    const daysLeft = Math.max(1, Math.round((Date.parse(examDate) - Date.parse(today)) / 86_400_000) - 1);
    const interval = Math.min(state.interval, daysLeft);
    return { ...state, interval, due: addDays(today, interval) };
  }
  return state;
}

export function isDue(state: SM2State, today: ISODate): boolean {
  return state.due <= today;
}

/** Score 0..1 associé à une réponse flashcard, pour la maîtrise. */
export function qualityToScore(q: number): number {
  return [0, 0.1, 0.25, 0.6, 0.85, 1][Math.max(0, Math.min(5, Math.round(q)))];
}
