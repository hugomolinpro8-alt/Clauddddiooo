import type { AppState, ISODate, Plan, PlanBlock, PlanChange, Subject } from "./types";
import { buildPlan, planMinutesBySubject, blockLabel } from "./planner";
import { subjectMastery, isStagnating } from "./mastery";
import { formatDay } from "./dates";

export interface ReplanContext {
  reasons: string[];
  stagnating: string[];
  missed: PlanBlock[];
}

/** Détecte ce qui justifie une replanification. */
export function detectReplanReasons(state: AppState, today: ISODate): ReplanContext {
  const reasons: string[] = [];
  const missed: PlanBlock[] = [];
  if (state.plan) {
    for (const d of state.plan.days) {
      if (d.date >= today) continue;
      for (const b of d.blocks) if (b.type !== "partiel" && (b.status === "todo" || b.status === "skipped")) missed.push(b);
    }
  }
  if (missed.length) {
    const min = missed.reduce((s, b) => s + b.durationMin, 0);
    reasons.push(`${missed.length} bloc(s) non faits les jours précédents (${Math.round(min / 6) / 10} h de retard).`);
  }
  const stagnating: string[] = [];
  for (const s of state.subjects) {
    for (const n of s.notions) {
      if (isStagnating(s, n, today)) {
        stagnating.push(n.id);
        reasons.push(`« ${n.title} » (${s.name}) stagne malgré plusieurs essais : on change d'approche (mini-cours ciblé).`);
      }
    }
  }
  const ci = state.checkins.find((c) => c.date === today);
  if (ci) {
    const planned = state.plan?.days.find((d) => d.date === today)?.capacityMin;
    if (planned != null && Math.abs(planned - ci.availableHours * 60) >= 30) {
      reasons.push(`Temps réel aujourd'hui : ${ci.availableHours} h au lieu de ${Math.round(planned / 6) / 10} h prévues.`);
    }
  }
  return { reasons, stagnating, missed };
}

export function masteryMap(subjects: Subject[], today: ISODate) {
  const out: Record<string, ReturnType<typeof subjectMastery>> = {};
  for (const s of subjects) out[s.id] = subjectMastery(s, today);
  return out;
}

/** Reconstruit le plan à partir d'aujourd'hui et produit un journal des changements. */
export function replan(state: AppState, today: ISODate, extraReasons: string[] = []): { plan: Plan; change: PlanChange } {
  const ctx = detectReplanReasons(state, today);
  const ci = state.checkins.find((c) => c.date === today);
  const old = state.plan;
  const keepToday = old?.days.find((d) => d.date === today)?.blocks.filter((b) => b.status === "done" || b.status === "partial") ?? [];
  const plan = buildPlan({
    subjects: state.subjects,
    availability: state.availability,
    today,
    mastery: masteryMap(state.subjects, today),
    todayMinutes: ci ? ci.availableHours * 60 : undefined,
    stagnating: ctx.stagnating,
    keepToday,
  });
  // On garde l'historique des jours passés (pour le suivi heures faites / prévues).
  if (old) {
    const past = old.days.filter((d) => d.date < today);
    plan.days = [...past, ...plan.days];
  }
  const changes = diffPlans(old, plan, state.subjects, today);
  return {
    plan,
    change: {
      id: plan.id,
      date: new Date().toISOString(),
      reasons: [...extraReasons, ...ctx.reasons].length ? [...extraReasons, ...ctx.reasons] : ["Replanification demandée."],
      changes,
    },
  };
}

export function diffPlans(old: Plan | null, next: Plan, subjects: Subject[], from: ISODate): string[] {
  if (!old) return ["Premier planning généré."];
  const out: string[] = [];
  const a = planMinutesBySubject(old, from);
  const b = planMinutesBySubject(next, from);
  for (const s of subjects) {
    const d = (b[s.id] ?? 0) - (a[s.id] ?? 0);
    if (Math.abs(d) >= 30) out.push(`${s.name} : ${d > 0 ? "+" : ""}${Math.round(d / 6) / 10} h de travail prévues d'ici le partiel.`);
    const mockA = old.days.find((x) => x.date >= from && x.blocks.some((k) => k.type === "examen-blanc" && k.subjectId === s.id))?.date;
    const mockB = next.days.find((x) => x.date >= from && x.blocks.some((k) => k.type === "examen-blanc" && k.subjectId === s.id))?.date;
    if (mockA !== mockB && mockB) out.push(`${s.name} : examen blanc déplacé au ${formatDay(mockB)}.`);
    const sacA = new Set(old.triage.find((t) => t.subjectId === s.id)?.sacrificed.map((x) => x.notionId) ?? []);
    const sacB = new Set(next.triage.find((t) => t.subjectId === s.id)?.sacrificed.map((x) => x.notionId) ?? []);
    for (const id of sacB) if (!sacA.has(id)) out.push(`${s.name} : « ${s.notions.find((n) => n.id === id)?.title} » passe en mode sacrifié (flashcards seulement).`);
    for (const id of sacA) if (!sacB.has(id)) out.push(`${s.name} : « ${s.notions.find((n) => n.id === id)?.title} » est réintégrée au programme.`);
  }
  const t0 = old.days.find((d) => d.date === from);
  const t1 = next.days.find((d) => d.date === from);
  if (t0 && t1) {
    const s0 = t0.blocks.map((x) => blockLabel(x.type)).join(", ");
    const s1 = t1.blocks.map((x) => blockLabel(x.type)).join(", ");
    if (s0 !== s1) out.push(`Aujourd'hui : ${t1.blocks.length} bloc(s) (${t1.capacityMin} min) au lieu de ${t0.blocks.length}.`);
  }
  if (!out.length) out.push("Aucun changement majeur : le plan tient.");
  return out;
}
