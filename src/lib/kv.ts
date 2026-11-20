/*
 * Stockage clé/valeur au-dessus du `db` de claude.ai (documents ≤ 256 Kio),
 * avec repli sur localStorage hors claude.ai. Les valeurs trop grosses sont
 * découpées automatiquement en morceaux.
 */
export interface DocStore {
  get(key: string): Promise<Record<string, unknown> | null>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export const CHUNK_CHARS = 180_000;

export function splitString(s: string, size = CHUNK_CHARS): string[] {
  const parts: string[] = [];
  for (let i = 0; i < s.length; i += size) parts.push(s.slice(i, i + size));
  return parts.length ? parts : [""];
}

export class ChunkedKV {
  constructor(private store: DocStore) {}

  async get<T>(key: string): Promise<T | null> {
    const head = await this.store.get(safe(key));
    if (!head) return null;
    const n = Number(head.parts ?? 0);
    let json = String(head.p0 ?? "");
    for (let i = 1; i < n; i++) {
      const part = await this.store.get(safe(`${key}~${i}`));
      if (!part) throw new Error(`Morceau manquant ${i}/${n} pour ${key}`);
      json += String(part.p ?? "");
    }
    return JSON.parse(json) as T;
  }

  async set(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    const parts = splitString(json);
    // On écrit d'abord les morceaux, puis la tête : une écriture interrompue ne casse pas l'ancienne version de la tête.
    for (let i = 1; i < parts.length; i++) await this.store.set(safe(`${key}~${i}`), { p: parts[i] });
    await this.store.set(safe(key), { parts: parts.length, p0: parts[0], savedAt: new Date().toISOString() });
  }

  async remove(key: string): Promise<void> {
    const head = await this.store.get(safe(key));
    const n = Number(head?.parts ?? 1);
    for (let i = 1; i < n; i++) await this.store.remove(safe(`${key}~${i}`));
    await this.store.remove(safe(key));
  }
}

function safe(key: string) {
  return key.replace(/[^A-Za-z0-9_\-.~:@+]/g, "_");
}

export class MemoryStore implements DocStore {
  data = new Map<string, Record<string, unknown>>();
  async get(k: string) { return this.data.get(k) ?? null; }
  async set(k: string, v: Record<string, unknown>) { this.data.set(k, JSON.parse(JSON.stringify(v))); }
  async remove(k: string) { this.data.delete(k); }
}

export class LocalStore implements DocStore {
  constructor(private prefix = "coach:") {}
  async get(k: string) {
    try { const s = localStorage.getItem(this.prefix + k); return s ? JSON.parse(s) : null; } catch { return null; }
  }
  async set(k: string, v: Record<string, unknown>) {
    try { localStorage.setItem(this.prefix + k, JSON.stringify(v)); } catch { /* quota ou stockage bloqué */ }
  }
  async remove(k: string) {
    try { localStorage.removeItem(this.prefix + k); } catch { /* ignore */ }
  }
}
