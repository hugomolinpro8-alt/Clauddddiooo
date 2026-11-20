import { describe, it, expect } from "vitest";
import { initialSM2, reviewSM2, capForExam, qualityToScore } from "../src/lib/sm2";

describe("SM-2", () => {
  const t = "2026-11-20";
  it("suit les intervalles 1, 6, puis ×EF", () => {
    let s = initialSM2(t);
    s = reviewSM2(s, 5, t);
    expect(s.interval).toBe(1);
    expect(s.due).toBe("2026-11-21");
    s = reviewSM2(s, 5, "2026-11-21");
    expect(s.interval).toBe(6);
    s = reviewSM2(s, 5, "2026-11-27");
    expect(s.interval).toBe(16); // 6 × EF(2,7 avant mise à jour)
  });
  it("réinitialise après un échec et compte les oublis", () => {
    let s = initialSM2(t);
    s = reviewSM2(s, 4, t);
    s = reviewSM2(s, 4, t);
    s = reviewSM2(s, 1, t);
    expect(s.reps).toBe(0);
    expect(s.interval).toBe(1);
    expect(s.lapses).toBe(1);
  });
  it("EF ne descend jamais sous 1,3", () => {
    let s = initialSM2(t);
    for (let i = 0; i < 20; i++) s = reviewSM2(s, 0, t);
    expect(s.ef).toBeGreaterThanOrEqual(1.3);
  });
  it("EF : +0,1 si 5, −0,14 si 3", () => {
    expect(reviewSM2(initialSM2(t), 5, t).ef).toBeCloseTo(2.6);
    expect(reviewSM2(initialSM2(t), 3, t).ef).toBeCloseTo(2.36);
  });
  it("plafonne l'intervalle avant le partiel", () => {
    const s = { ef: 2.5, interval: 15, reps: 3, due: "2026-12-05", lapses: 0 };
    const c = capForExam(s, t, "2026-11-25");
    expect(c.due < "2026-11-25").toBe(true);
  });
  it("convertit la qualité en score monotone", () => {
    const xs = [0, 1, 2, 3, 4, 5].map(qualityToScore);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]);
  });
});
