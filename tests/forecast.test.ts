import { describe, it, expect } from "vitest";
import { forecastSubject, riskyNotions } from "../src/lib/forecast";
import { subjectMastery } from "../src/lib/mastery";
import { makeDemoSubject } from "../src/lib/seed";

const t = "2026-11-20";

describe("prévision de note", () => {
  it("est la somme pondérée des maîtrises × 20", () => {
    const { subject } = makeDemoSubject(t);
    const f = forecastSubject(subject, t);
    const m = subjectMastery(subject, t);
    const expected = 20 * subject.notions.reduce((s, n) => s + n.weight * m[n.id].mastery / 100, 0) / subject.notions.reduce((s, n) => s + n.weight, 0);
    expect(f.modelOnly).toBeCloseTo(expected, 0);
    expect(f.low).toBeLessThanOrEqual(f.expected);
    expect(f.high).toBeGreaterThanOrEqual(f.expected);
  });
  it("la fourchette se resserre avec plus de données", () => {
    const { subject } = makeDemoSubject(t);
    const w0 = forecastSubject(subject, t);
    subject.attempts = subject.notions.flatMap((n, i) => Array.from({ length: 6 }, (_, k) => ({ id: `${i}-${k}`, date: t + "T09:00:00", kind: "exercice" as const, notionIds: [n.id], score: 0.6 })));
    const w1 = forecastSubject(subject, t);
    expect(w1.high - w1.low).toBeLessThan(w0.high - w0.low);
  });
  it("intègre un examen blanc récent (60/40)", () => {
    const { subject } = makeDemoSubject(t);
    const before = forecastSubject(subject, t);
    subject.mockExams = [{ id: "m", subjectId: subject.id, createdAt: t, durationMin: 120, exercises: [], answers: {}, corrections: {}, grade: 18, status: "corrige", submittedAt: t + "T12:00:00" }];
    const after = forecastSubject(subject, t);
    expect(after.expected).toBeCloseTo(0.6 * before.modelOnly + 0.4 * 18, 0);
  });
  it("trouve les notions à risque", () => {
    const { subject } = makeDemoSubject(t);
    const r = riskyNotions(subject, subjectMastery(subject, t));
    expect(r.every((n) => subjectMastery(subject, t)[n.id].mastery < 50)).toBe(true);
  });
});
