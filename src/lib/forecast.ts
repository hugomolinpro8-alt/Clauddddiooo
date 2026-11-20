import type { ISODate, Subject } from "./types";
import { subjectMastery, type MasteryResult } from "./mastery";
import { diffDays } from "./dates";

/**
 * Prévision de note au partiel (sur 20).
 *
 * Note attendue = 20 × Σ (poids de la notion × maîtrise/100)
 *   où le poids vient des annales (points + fréquence, normalisé à 1).
 *
 * Incertitude : chaque notion a une variance p(1−p)/(n_eff + 2),
 * n_eff étant la quantité d'essais récents. Peu de données ⇒ fourchette large.
 * On ajoute une erreur de modèle fixe de ±1 point (σ = 0,05 × 20).
 * Fourchette affichée = attendue ± 1,28 σ (≈ 80 % de chances d'être dedans).
 *
 * Si un examen blanc a été corrigé il y a moins de 14 jours, on mélange :
 * 60 % modèle + 40 % note de l'examen blanc, et σ est réduit de 20 %.
 */
export const MODEL_SIGMA = 0.05;
export const Z80 = 1.28;

export interface Forecast {
  expected: number;
  low: number;
  high: number;
  sigma: number;
  modelOnly: number;
  mockGrade?: number;
  contributions: { notionId: string; weight: number; mastery: number; points: number; maxPoints: number }[];
  coverage: number; // somme des poids (devrait être 1)
}

export function forecastSubject(
  subject: Subject,
  today: ISODate,
  mastery: Record<string, MasteryResult> = subjectMastery(subject, today),
): Forecast {
  const totalW = subject.notions.reduce((s, n) => s + Math.max(0, n.weight), 0) || 1;
  let expectedP = 0;
  let variance = 0;
  const contributions: Forecast["contributions"] = [];

  for (const n of subject.notions) {
    const w = Math.max(0, n.weight) / totalW;
    const m = mastery[n.id] ?? { mastery: 50, evidence: 0 };
    const p = m.mastery / 100;
    expectedP += w * p;
    variance += w * w * ((p * (1 - p)) / (m.evidence + 2));
    contributions.push({ notionId: n.id, weight: w, mastery: m.mastery, points: 20 * w * p, maxPoints: 20 * w });
  }

  let sigma = 20 * Math.sqrt(variance + MODEL_SIGMA * MODEL_SIGMA);
  const modelOnly = 20 * expectedP;
  let expected = modelOnly;

  const mock = [...subject.mockExams]
    .filter((m) => m.status === "corrige" && m.grade != null && m.submittedAt)
    .sort((a, b) => (b.submittedAt! > a.submittedAt! ? 1 : -1))[0];
  let mockGrade: number | undefined;
  if (mock && diffDays(today, mock.submittedAt!.slice(0, 10)) <= 14) {
    mockGrade = mock.grade!;
    expected = 0.6 * modelOnly + 0.4 * mockGrade;
    sigma *= 0.8;
  }

  const clamp = (x: number) => Math.max(0, Math.min(20, x));
  const r = (x: number) => Math.round(x * 10) / 10;
  return {
    expected: r(clamp(expected)),
    low: r(clamp(expected - Z80 * sigma)),
    high: r(clamp(expected + Z80 * sigma)),
    sigma: r(sigma),
    modelOnly: r(modelOnly),
    mockGrade,
    contributions: contributions.sort((a, b) => b.maxPoints - a.maxPoints),
    coverage: subject.notions.length ? 1 : 0,
  };
}

/** Notions à risque : poids élevé (≥ moyenne) et maîtrise < 50. */
export function riskyNotions(subject: Subject, mastery: Record<string, MasteryResult>) {
  const n = subject.notions.length || 1;
  const avgW = subject.notions.reduce((s, x) => s + x.weight, 0) / n;
  return subject.notions
    .filter((x) => x.weight >= avgW && (mastery[x.id]?.mastery ?? 0) < 50)
    .sort((a, b) => b.weight * (100 - mastery[b.id].mastery) - a.weight * (100 - mastery[a.id].mastery));
}
