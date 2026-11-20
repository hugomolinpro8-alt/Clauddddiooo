import type { ExamExercise, ExerciseType, Flashcard, ISODate, Notion, Subject } from "./types";
import { initialSM2 } from "./sm2";

/*
 * Poids d'une notion dans le partiel :
 *   poids = 0,7 × part des points des annales + 0,3 × part des apparitions,
 * puis un plancher de 2 % pour les notions jamais tombées (elles peuvent tomber),
 * et normalisation pour que la somme fasse 1.
 * Un exercice qui mobilise k notions répartit ses points à parts égales.
 */
export function computeWeights(notions: Notion[], exercises: ExamExercise[]): Notion[] {
  if (!notions.length) return notions;
  const pts: Record<string, number> = {};
  const freq: Record<string, number> = {};
  const annales = new Set(exercises.map((e) => e.docId));
  for (const e of exercises) {
    const ids = e.notionIds.filter((id) => notions.some((n) => n.id === id));
    if (!ids.length) continue;
    const p = (e.points ?? 4) / ids.length;
    for (const id of ids) {
      pts[id] = (pts[id] ?? 0) + p;
      freq[id] = (freq[id] ?? 0) + 1;
    }
  }
  const totalP = Object.values(pts).reduce((a, b) => a + b, 0);
  const totalF = Object.values(freq).reduce((a, b) => a + b, 0);
  const raw = notions.map((n) => {
    if (!totalP && !totalF) return 1 / notions.length;
    const w = 0.7 * ((pts[n.id] ?? 0) / (totalP || 1)) + 0.3 * ((freq[n.id] ?? 0) / (totalF || 1));
    return Math.max(0.02, w);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  const nA = Math.max(1, annales.size);
  return notions.map((n, i) => ({
    ...n,
    weight: Math.round((raw[i] / sum) * 1000) / 1000,
    frequency: freq[n.id] ?? 0,
    points: Math.round(((pts[n.id] ?? 0) / nA) * 10) / 10,
  }));
}

export function exerciseTypes(exercises: ExamExercise[], descriptions: Record<string, string> = {}): ExerciseType[] {
  const map = new Map<string, ExerciseType>();
  for (const e of exercises) {
    const key = e.type.trim().toLowerCase();
    const cur = map.get(key) ?? { type: e.type, count: 0, notionIds: [], description: descriptions[e.type] ?? "" };
    cur.count++;
    for (const id of e.notionIds) if (!cur.notionIds.includes(id)) cur.notionIds.push(id);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Rendement = poids × (1 − maîtrise) : les notions qui rapportent le plus de points à travailler. */
export function highYield(subject: Subject, mastery: Record<string, { mastery: number }>, n = 5) {
  return [...subject.notions]
    .filter((x) => !x.sacrificed)
    .map((x) => ({ notion: x, score: x.weight * (1 - (mastery[x.id]?.mastery ?? 50) / 100) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

const KIND_LABEL: Record<string, string> = {
  definition: "Définition", theoreme: "Théorème", methode: "Méthode", formule: "Formule", mecanisme: "Mécanisme", propriete: "Propriété",
};

/** Flashcards générées sans IA à partir des éléments du cours. */
export function cardsFromNotions(notions: Notion[], today: ISODate, existing: Flashcard[] = []): Flashcard[] {
  const have = new Set(existing.map((c) => c.id));
  const out: Flashcard[] = [];
  for (const n of notions) {
    for (const it of n.items) {
      const id = `card-${it.id}`;
      if (have.has(id)) continue;
      out.push({
        id,
        notionId: n.id,
        front: `**${KIND_LABEL[it.kind] ?? "Élément"}** — ${it.title}\n\n_Énonce-le précisément (hypothèses comprises)._`,
        back: it.statement,
        sm2: initialSM2(today),
        sourceSection: it.source?.section,
      });
    }
  }
  return out;
}

/** Vérifie que les extraits cités existent vraiment dans le texte source. */
export function verifyExcerpt(docText: string, excerpt: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[\s$\\{}]+/g, " ").replace(/[«»"'’]/g, "").trim();
  const e = norm(excerpt);
  if (e.length < 8) return false;
  const t = norm(docText);
  if (t.includes(e)) return true;
  // tolérance : 80 % des mots de l'extrait présents dans une fenêtre
  const words = e.split(" ").filter((w) => w.length > 3);
  if (!words.length) return false;
  const hit = words.filter((w) => t.includes(w)).length;
  return hit / words.length >= 0.8;
}
