/* Accès aux capacités claude.ai (IA via le compte de l'étudiant, base de données). */
import { ChunkedKV, LocalStore, type DocStore } from "./kv";

type AnyFn = (...args: any[]) => any;
export interface SampleFn extends AnyFn {
  (input: unknown, opts?: Record<string, unknown>): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: unknown, opts?: Record<string, unknown>): Promise<T>;
  limits(): Promise<{ maxPromptBytes: number; images?: { maxCount: number; maxBytes?: number; mediaTypes: string[] } }>;
}

declare global {
  interface Window { claude?: { use(name: string): Promise<any> } }
}

function use<T>(name: string): Promise<T | null> {
  try {
    if (typeof window === "undefined" || !window.claude?.use) return Promise.resolve(null);
    return window.claude.use(name).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

let samplePromise: Promise<SampleFn | null> | null = null;
export function getSample(): Promise<SampleFn | null> {
  if (!samplePromise) samplePromise = use<SampleFn>("sample");
  return samplePromise;
}

let imageLimits: Promise<{ maxCount: number; mediaTypes: string[] } | null> | null = null;
export function getImageLimits() {
  if (!imageLimits) {
    imageLimits = getSample().then(async (s) => {
      if (!s) return null;
      try { return (await s.limits()).images ?? null; } catch { return null; }
    });
  }
  return imageLimits;
}

class ClaudeDbStore implements DocStore {
  constructor(private db: any, private uid: string) {}
  private ref(k: string) { return this.db.doc(`data/users/${this.uid}/${k}`); }
  async get(k: string) {
    const snap: any = await withRetry(() => this.ref(k).get());
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  }
  async set(k: string, v: Record<string, unknown>) { await withRetry(() => this.ref(k).set(v)); }
  async remove(k: string) { await withRetry(() => this.ref(k).delete()); }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e?.code === "unavailable") {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 800));
      return fn();
    }
    throw e;
  }
}

export interface Storage {
  remote: ChunkedKV | null; // claude.ai db
  local: ChunkedKV; // copie de secours dans ce navigateur
  mode: "cloud" | "local";
}

export async function initStorage(): Promise<Storage> {
  const local = new ChunkedKV(new LocalStore());
  const [db, user] = await Promise.all([use<any>("db"), use<any>("user")]);
  if (db && user) {
    try {
      const uid = await user.id();
      if (uid) return { remote: new ChunkedKV(new ClaudeDbStore(db, uid)), local, mode: "cloud" };
    } catch { /* on retombe en local */ }
  }
  return { remote: null, local, mode: "local" };
}
