import type { ISODate } from "./types";

/** Date locale du jour au format ISO (YYYY-MM-DD), sans décalage UTC. */
export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now);
}

export function toISO(d: Date): ISODate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12, 0, 0); // midi : évite les soucis d'heure d'été
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = parseISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86_400_000);
}

/** 0 = lundi ... 6 = dimanche */
export function weekdayIndex(s: ISODate): number {
  return (parseISO(s).getDay() + 6) % 7;
}

export function dateRange(from: ISODate, toExclusive: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d < toExclusive; d = addDays(d, 1)) out.push(d);
  return out;
}

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function minToTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export function formatDay(s: ISODate, withWeekday = true): string {
  const d = parseISO(s);
  const base = `${d.getDate()} ${MOIS[d.getMonth()]}`;
  return withWeekday ? `${JOURS[weekdayIndex(s)]} ${base}` : base;
}

export function weekdayName(i: number): string {
  return JOURS[i];
}
