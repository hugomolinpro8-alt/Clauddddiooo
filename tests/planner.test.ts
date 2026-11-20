import { describe, it, expect } from "vitest";
import { buildPlan, targetMastery } from "../src/lib/planner";
import { makeDemoSubject } from "../src/lib/seed";
import { subjectMastery } from "../src/lib/mastery";
import { addDays, diffDays } from "../src/lib/dates";
import type { Availability, Subject } from "../src/lib/types";

const t = "2026-11-20"; // vendredi
const avail = (h: number, blocked: string[] = []): Availability => ({ weekly: Array.from({ length: 7 }, () => ({ start: "09:00", hours: h })), blockedDates: blocked });
const mastery = (subs: Subject[]) => Object.fromEntries(subs.map((s) => [s.id, subjectMastery(s, t)]));

function demo(daysToExam = 14, patch: Partial<Subject> = {}): Subject {
  const { subject } = makeDemoSubject(t);
  return { ...subject, examDate: addDays(t, daysToExam), ...patch };
}

describe("planning", () => {
  it("couvre chaque jour jusqu'au partiel, avec examen blanc J-4..J-2, tampon et veille allégée", () => {
    const s = demo(14);
    const p = buildPlan({ subjects: [s], availability: avail(5), today: t, mastery: mastery([s]), idSeed: "x" });
    expect(p.days[0].date).toBe(t);
    expect(p.days[p.days.length - 1].date).toBe(s.examDate);
    const mock = p.days.find((d) => d.blocks.some((b) => b.type === "examen-blanc"))!;
    const dist = diffDays(s.examDate, mock.date);
    expect(dist).toBeGreaterThanOrEqual(2);
    expect(dist).toBeLessThanOrEqual(4);
    expect(p.days.some((d) => d.kinds.includes("tampon"))).toBe(true);
    const veille = p.days.find((d) => d.date === addDays(s.examDate, -1))!;
    expect(veille.kinds).toContain("veille");
    const veilleMin = veille.blocks.reduce((a, b) => a + b.durationMin, 0);
    expect(veilleMin).toBeLessThanOrEqual(5 * 60);
    expect(veille.blocks.some((b) => b.type === "fiches")).toBe(true);
    expect(p.days.find((d) => d.date === s.examDate)!.blocks.some((b) => b.type === "partiel")).toBe(true);
  });

  it("ne dépasse jamais la capacité d'un jour", () => {
    const s = demo(10);
    const p = buildPlan({ subjects: [s], availability: avail(3), today: t, mastery: mastery([s]) });
    for (const d of p.days) {
      if (d.kinds.includes("partiel")) continue;
      const used = d.blocks.reduce((a, b) => a + b.durationMin, 0);
      expect(used).toBeLessThanOrEqual(d.capacityMin);
    }
  });

  it("respecte les jours bloqués", () => {
    const s = demo(10);
    const blocked = [addDays(t, 2), addDays(t, 3)];
    const p = buildPlan({ subjects: [s], availability: avail(4, blocked), today: t, mastery: mastery([s]) });
    for (const b of blocked) expect(p.days.find((d) => d.date === b)!.blocks.length).toBe(0);
  });

  it("alterne les notions : pas deux blocs principaux identiques le même jour quand c'est possible", () => {
    const s = demo(14);
    const p = buildPlan({ subjects: [s], availability: avail(6), today: t, mastery: mastery([s]) });
    for (const d of p.days) {
      const mains = d.blocks.filter((b) => ["exercices", "mini-cours", "annale"].includes(b.type)).map((b) => b.notionIds[0]);
      expect(new Set(mains).size).toBe(mains.length);
    }
  });

  it("programme des rappels espacés", () => {
    const s = demo(14);
    const p = buildPlan({ subjects: [s], availability: avail(5), today: t, mastery: mastery([s]) });
    expect(p.days.flatMap((d) => d.blocks).some((b) => b.review)).toBe(true);
  });

  it("donne la priorité aux notions importantes et faibles", () => {
    const s = demo(14);
    const p = buildPlan({ subjects: [s], availability: avail(3), today: t, mastery: mastery([s]) });
    const count: Record<string, number> = {};
    for (const b of p.days.flatMap((d) => d.blocks)) if (b.type !== "flashcards") for (const n of b.notionIds.slice(0, 1)) count[n] = (count[n] ?? 0) + 1;
    const m = mastery([s])[s.id];
    const prio = (id: string) => s.notions.find((n) => n.id === id)!.weight * (1 - m[id].mastery / 100);
    const sorted = [...s.notions].sort((a, b) => prio(b.id) - prio(a.id));
    expect(count[sorted[0].id] ?? 0).toBeGreaterThanOrEqual(count[sorted[sorted.length - 1].id] ?? 0);
  });

  it("déclenche un triage honnête quand le temps manque", () => {
    const s = demo(4, { targetGrade: 18 });
    const p = buildPlan({ subjects: [s], availability: avail(1), today: t, mastery: mastery([s]) });
    const tr = p.triage[0];
    expect(tr.sufficient).toBe(false);
    expect(tr.sacrificed.length).toBeGreaterThan(0);
    expect(p.warnings.join(" ")).toMatch(/triage/);
  });

  it("n'active pas le triage quand le temps suffit", () => {
    const s = demo(20, { targetGrade: 12 });
    const p = buildPlan({ subjects: [s], availability: avail(6), today: t, mastery: mastery([s]) });
    expect(p.triage[0].sufficient).toBe(true);
  });

  it("arbitre entre deux matières selon dates et coefficients", () => {
    const a = demo(7, { id: "A", name: "A", coef: 1 });
    const b = demo(14, { id: "B", name: "B", coef: 4 });
    b.notions = b.notions.map((n) => ({ ...n }));
    const p = buildPlan({ subjects: [a, b], availability: avail(5), today: t, mastery: mastery([a, b]) });
    const after = p.days.filter((d) => d.date > a.examDate).flatMap((d) => d.blocks);
    expect(after.some((x) => x.subjectId === "A" && x.type !== "partiel")).toBe(false);
    const before = p.days.filter((d) => d.date < a.examDate).flatMap((d) => d.blocks);
    expect(before.some((x) => x.subjectId === "A")).toBe(true);
    expect(before.some((x) => x.subjectId === "B")).toBe(true);
    expect(p.days.find((d) => d.date === a.examDate)!.blocks.some((x) => x.type === "partiel" && x.subjectId === "A")).toBe(true);
  });

  it("utilise le temps réel du check-in pour aujourd'hui", () => {
    const s = demo(10);
    const p = buildPlan({ subjects: [s], availability: avail(5), today: t, mastery: mastery([s]), todayMinutes: 60 });
    expect(p.days[0].blocks.reduce((a, b) => a + b.durationMin, 0)).toBeLessThanOrEqual(60);
  });

  it("cible de maîtrise bornée", () => {
    expect(targetMastery(20)).toBe(95);
    expect(targetMastery(8)).toBe(60);
  });
});
