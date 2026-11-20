import { clsx, type ClassValue } from "clsx";
import { SITE } from "./config";

export const cn = (...c: ClassValue[]) => clsx(c);

export const mod = (n: number, m: number) => ((n % m) + m) % m;

const fmt = new Intl.NumberFormat(SITE.locale, { style: "currency", currency: SITE.devise, maximumFractionDigits: 2, minimumFractionDigits: 0 });
export const formatPrix = (v: number) => fmt.format(v);

export const pad2 = (n: number) => String(n).padStart(2, "0");

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Interpolation linéaire entre deux couleurs hex → rgb() */
export function mixHex(a: string, b: string, t: number) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
