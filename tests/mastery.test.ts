import { describe, it, expect } from "vitest";
import { computeMastery, priorFromLevel, isStagnating } from "../src/lib/mastery";
import type { Attempt } from "../src/lib/types";
import { makeDemoSubject } from "../src/lib/seed";

const t = "2026-11-20";
const att = (date: string, score: number, kind: Attempt["kind"] = "exercice"): Attempt => ({ id: Math.random() + "", date: date + "T10:00:00", kind, notionIds: ["n"], score });

describe("maîtrise", () => {
  it("sans essai = niveau ressenti", () => {
    expect(computeMastery([], 1, t).mastery).toBe(10);
    expect(computeMastery([], 5, t).mastery).toBe(85);
    expect(priorFromLevel(3)).toBe(50);
  });
  it("monte avec des réussites et baisse avec des échecs", () => {
    const up = computeMastery([att(t, 1), att(t, 1), att(t, 0.9)], 2, t).mastery;
    const down = computeMastery([att(t, 0), att(t, 0.1)], 4, t).mastery;
    expect(up).toBeGreaterThan(65);
    expect(down).toBeLessThan(40);
  });
  it("un examen blanc pèse plus qu'une flashcard", () => {
    const fc = computeMastery([att(t, 1, "flashcard")], 1, t).mastery;
    const mock = computeMastery([att(t, 1, "examen-blanc")], 1, t).mastery;
    expect(mock).toBeGreaterThan(fc);
  });
  it("l'oubli fait baisser la maîtrise d'une notion non revue", () => {
    const fresh = computeMastery([att("2026-11-19", 1)], 3, t).mastery;
    const old = computeMastery([att("2026-10-20", 1)], 3, t).mastery;
    expect(old).toBeLessThan(fresh);
  });
  it("reste dans [0, 100]", () => {
    const m = computeMastery(Array.from({ length: 50 }, () => att(t, 1)), 5, t).mastery;
    expect(m).toBeLessThanOrEqual(100);
  });
  it("détecte une notion qui stagne", () => {
    const { subject } = makeDemoSubject(t);
    const n = subject.notions[0];
    subject.attempts = [0.3, 0.35, 0.3, 0.32].map((s, i) => ({ id: "a" + i, date: `2026-11-1${5 + i}T10:00:00`, kind: "exercice", notionIds: [n.id], score: s }));
    expect(isStagnating(subject, n, t)).toBe(true);
    subject.attempts = [0.3, 0.5, 0.7, 0.9].map((s, i) => ({ id: "a" + i, date: `2026-11-1${5 + i}T10:00:00`, kind: "exercice", notionIds: [n.id], score: s }));
    expect(isStagnating(subject, n, t)).toBe(false);
  });
});
