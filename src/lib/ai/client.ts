import type { ZodTypeAny, output } from "zod";
import { getSample } from "../runtime";

export type Tier = "heavy" | "main" | "quick";

/* Modèle lourd (analyse des annales, plan) / principal (corrections, sessions) / rapide (messages courts). */
const TIERS: Record<Tier, Record<string, unknown>> = {
  heavy: { modelTier: "complex", model: "claude-opus-5-5" },
  main: { modelTier: "default", model: "claude-sonnet-5-5" },
  quick: { modelTier: "quick" },
};

export class AiError extends Error {
  constructor(public code: string, message: string, public partial?: string) { super(message); }
}

const MESSAGES: Record<string, string> = {
  not_granted: "Tu n'as pas autorisé l'app à utiliser Claude. Recharge la page et accepte la demande pour activer le coach.",
  sampling_disabled: "Claude n'est pas disponible pour ce compte.",
  rate_limited: "Limite d'utilisation de Claude atteinte pour le moment. Réessaie dans quelques minutes : ton travail est enregistré.",
  session_expired: "Ta session claude.ai a expiré : reconnecte-toi puis réessaie.",
  prompt_too_large: "Le document est trop long pour un seul appel. Découpe-le (par chapitre) et réessaie.",
  image_rejected: "Image refusée (trop grande ou format non pris en charge). Essaie une photo plus petite en JPEG ou PNG.",
  images_unavailable: "L'envoi d'images n'est pas disponible ici : tape ta réponse au clavier.",
  refused: "Claude a refusé cette demande. Reformule ou simplifie.",
  empty_completion: "Claude n'a rien répondu. Réessaie en demandant moins à la fois.",
  invalid_json: "Réponse illisible. Clique sur Réessayer.",
  upstream_error: "Coupure réseau ou service momentanément indisponible. Clique sur Réessayer : rien n'est perdu.",
  cancelled: "Annulé.",
  unavailable: "Le coach IA n'est disponible que dans l'app ouverte sur claude.ai. Ici, les réponses sont simulées (mode démo).",
  schema: "La réponse de Claude n'avait pas le bon format, même après correction. Clique sur Réessayer.",
};

export function errorMessage(e: unknown): string {
  if (e instanceof AiError) return e.message;
  const code = (e as any)?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  return (e as any)?.message ?? "Erreur inconnue.";
}

type Listener = (ev: { task: string; ok: boolean; mock: boolean }) => void;
const listeners = new Set<Listener>();
export function onAiCall(l: Listener) { listeners.add(l); return () => listeners.delete(l); }
function emit(task: string, ok: boolean, mock: boolean) { for (const l of listeners) l({ task, ok, mock }); }

let forceMock = false;
export function setForceMock(v: boolean) { forceMock = v; }

export async function aiAvailable(): Promise<boolean> {
  if (forceMock) return false;
  return (await getSample()) != null;
}

export interface AiOptions {
  tier?: Tier;
  images?: Blob[];
  signal?: AbortSignal;
  noCache?: boolean;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Appel structuré : JSON validé par Zod, une tentative de réparation si le format est faux. */
export async function aiJSON<S extends ZodTypeAny>(task: string, prompt: string, schema: S, opts: AiOptions, mock: () => output<S>): Promise<output<S>> {
  type T = output<S>;
  const sample = forceMock ? null : await getSample();
  if (!sample) {
    await delay(500);
    emit(task, true, true);
    return schema.parse(mock()) as T;
  }
  const base: Record<string, unknown> = { ...TIERS[opts.tier ?? "main"], signal: opts.signal };
  if (opts.images?.length) base.images = opts.images;
  if (opts.noCache) base.cache = false;
  let raw: unknown;
  try {
    raw = await sample.json(prompt, base);
  } catch (e: any) {
    emit(task, false, false);
    throw new AiError(e?.code ?? "upstream_error", MESSAGES[e?.code] ?? MESSAGES.upstream_error, e?.text);
  }
  const first = schema.safeParse(raw);
  if (first.success) { emit(task, true, false); return first.data as T; }

  const issues = first.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(racine)"} : ${i.message}`).join("\n");
  try {
    const repaired = await sample.json(
      `${prompt}\n\n---\nTa réponse précédente ne respectait pas le format demandé :\n${issues}\n\nRéponse précédente :\n${JSON.stringify(raw).slice(0, 20_000)}\n\nRenvoie UNIQUEMENT le JSON corrigé, complet.`,
      { ...base, cache: false },
    );
    const second = schema.safeParse(repaired);
    if (second.success) { emit(task, true, false); return second.data as T; }
  } catch (e: any) {
    emit(task, false, false);
    throw new AiError(e?.code ?? "upstream_error", MESSAGES[e?.code] ?? MESSAGES.upstream_error);
  }
  emit(task, false, false);
  throw new AiError("schema", MESSAGES.schema);
}

/** Appel texte libre, en streaming (mini-cours, messages du coach). */
export async function aiText(task: string, prompt: string, opts: AiOptions & { onText?: (t: string) => void }, mock: () => string): Promise<string> {
  const sample = forceMock ? null : await getSample();
  if (!sample) {
    const text = mock();
    let acc = "";
    for (const chunk of text.match(/.{1,60}/gs) ?? []) {
      acc += chunk;
      opts.onText?.(acc);
      await delay(15);
    }
    emit(task, true, true);
    return text;
  }
  const o: Record<string, unknown> = { ...TIERS[opts.tier ?? "main"], signal: opts.signal, onText: ({ text }: { text: string }) => opts.onText?.(text) };
  if (opts.images?.length) o.images = opts.images;
  if (opts.noCache) o.cache = false;
  try {
    const r = await sample(prompt, o);
    emit(task, true, false);
    return r.truncated ? r.text + "\n\n_(réponse coupée : demande la suite)_" : r.text;
  } catch (e: any) {
    emit(task, false, false);
    throw new AiError(e?.code ?? "upstream_error", MESSAGES[e?.code] ?? MESSAGES.upstream_error, e?.text);
  }
}
