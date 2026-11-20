import { describe, it, expect } from "vitest";
import { runCheck, numericallyEqual } from "../src/lib/mathcheck";
import { ChunkedKV, MemoryStore } from "../src/lib/kv";
import { computeWeights, verifyExcerpt } from "../src/lib/analysis";
import { demoNotions, demoExamExercises, DEMO_COURSE } from "../src/lib/seed";
import { replan } from "../src/lib/replan";
import { makeDemoSubject } from "../src/lib/seed";
import type { AppState } from "../src/lib/types";

describe("vérification maths", () => {
  it("valide une bonne dérivée et rejette une fausse", () => {
    expect(runCheck({ type: "derivative", f: "(x^2+1)*exp(-x)", result: "-(x-1)^2*exp(-x)" }).ok).toBe(true);
    expect(runCheck({ type: "derivative", f: "x*exp(-x)", result: "exp(-x)" }).ok).toBe(false);
  });
  it("comprend un peu de LaTeX", () => {
    expect(runCheck({ type: "derivative", f: "\\ln(x^2+1)", result: "\\frac{2x}{x^2+1}" }).ok).toBe(true);
  });
  it("vérifie des limites numériquement", () => {
    expect(runCheck({ type: "limit", f: "(3x^2-x)/(2x^2+5)", at: "+Infinity", result: "3/2" }).ok).toBe(true);
    expect(runCheck({ type: "limit", f: "x*exp(-x)", at: "Infinity", result: "1" }).ok).toBe(false);
    expect(runCheck({ type: "limit", f: "sin(x)/x", at: "0", result: "1" }).ok).toBe(true);
  });
  it("égalité numérique", () => {
    expect(numericallyEqual("(x+1)^2", "x^2+2x+1")).toBe(true);
    expect(numericallyEqual("(x+1)^2", "x^2+1")).toBe(false);
  });
  it("renvoie null si non vérifiable", () => {
    expect(runCheck({ type: "equal", a: "blabla(", b: "x" }).ok).toBe(null);
  });
});

describe("stockage découpé", () => {
  it("relit une valeur de plus de 256 Kio", async () => {
    const kv = new ChunkedKV(new MemoryStore());
    const big = { text: "é".repeat(600_000), n: 3 };
    await kv.set("doc:1", big);
    expect(await kv.get("doc:1")).toEqual(big);
  });
});

describe("analyse", () => {
  it("poids normalisés, plus forts pour les notions fréquentes", () => {
    const ns = computeWeights(demoNotions(), demoExamExercises());
    const sum = ns.reduce((s, n) => s + n.weight, 0);
    expect(sum).toBeCloseTo(1, 2);
    const w = (id: string) => ns.find((n) => n.id === id)!.weight;
    expect(w("n-etude")).toBeGreaterThan(w("n-croissances"));
    expect(ns.every((n) => n.weight > 0)).toBe(true);
  });
  it("retrouve les extraits cités dans le cours", () => {
    expect(verifyExcerpt(DEMO_COURSE, "Toute suite croissante et majorée converge")).toBe(true);
    expect(verifyExcerpt(DEMO_COURSE, "Le théorème de Rolle s'applique aux fonctions holomorphes")).toBe(false);
  });
});

describe("replanification", () => {
  it("détecte le retard et explique les changements", () => {
    const today = "2026-11-20";
    const { subject } = makeDemoSubject("2026-11-18");
    const state: AppState = { version: 1, subjects: [subject], availability: { weekly: Array.from({ length: 7 }, () => ({ start: "09:00", hours: 4 })), blockedDates: [] }, plan: null, planChanges: [], checkins: [], forecasts: [], onboarding: null, aiCalls: 0 };
    const first = replan(state, "2026-11-18");
    state.plan = first.plan;
    const second = replan(state, today);
    expect(second.change.reasons.join(" ")).toMatch(/non faits/);
    expect(second.change.changes.length).toBeGreaterThan(0);
    expect(second.plan.days[0].date).toBe("2026-11-18"); // historique conservé
  });
});
