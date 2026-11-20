import { create, all, type MathJsInstance } from "mathjs";

/*
 * Vérification symbolique / numérique côté code, indépendante de l'IA.
 * Utilisée pour contrôler les dérivées, limites et égalités produites par Claude.
 */
let math: MathJsInstance | null = null;
function m(): MathJsInstance {
  if (!math) math = create(all, {});
  return math;
}

export type MathCheck =
  | { type: "derivative"; f: string; variable?: string; result: string }
  | { type: "equal"; a: string; b: string; variable?: string }
  | { type: "limit"; f: string; variable?: string; at: string; result: string }
  | { type: "value"; expr: string; result: string };

export interface CheckOutcome {
  check: MathCheck;
  ok: boolean | null; // null = non vérifiable
  detail: string;
}

/** Convertit un peu de LaTeX courant en syntaxe mathjs. */
export function normalizeExpr(s: string): string {
  return s
    .replace(/\\left|\\right/g, "")
    .replace(/\\cdot|\\times/g, "*")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "(($1)/($2))")
    .replace(/\\sqrt\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/\\(ln|exp|sin|cos|tan)/g, "$1")
    .replace(/\\infty/g, "Infinity")
    .replace(/\{/g, "(").replace(/\}/g, ")")
    .replace(/\bln\s*\(/g, "log(")
    .replace(/\s+/g, " ")
    .trim();
}

function evalAt(expr: string, v: string, x: number): number {
  const val = m().evaluate(normalizeExpr(expr), { [v]: x, e: Math.E, pi: Math.PI });
  return typeof val === "number" ? val : Number(val);
}

const SAMPLES = [0.37, 0.81, 1.3, 1.9, 2.6, 3.7, 5.2];

export function numericallyEqual(a: string, b: string, v = "x"): boolean | null {
  let compared = 0;
  for (const x of SAMPLES) {
    let ya: number, yb: number;
    try { ya = evalAt(a, v, x); yb = evalAt(b, v, x); } catch { return null; }
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) continue;
    compared++;
    if (Math.abs(ya - yb) > 1e-6 * Math.max(1, Math.abs(ya), Math.abs(yb))) return false;
  }
  return compared >= 3 ? true : null;
}

export function runCheck(c: MathCheck): CheckOutcome {
  try {
    if (c.type === "derivative") {
      const v = c.variable || "x";
      const d = m().derivative(normalizeExpr(c.f), v).toString();
      const ok = numericallyEqual(d, c.result, v);
      return { check: c, ok, detail: ok === false ? `Dérivée calculée par le code : ${d}` : "Dérivée confirmée par calcul symbolique." };
    }
    if (c.type === "equal") {
      const ok = numericallyEqual(c.a, c.b, c.variable || "x");
      return { check: c, ok, detail: ok === false ? "Les deux expressions diffèrent numériquement." : "Égalité confirmée numériquement." };
    }
    if (c.type === "value") {
      const a = Number(m().evaluate(normalizeExpr(c.expr)));
      const b = Number(m().evaluate(normalizeExpr(c.result)));
      const ok = Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
      return { check: c, ok, detail: ok ? "Valeur confirmée." : `Le code trouve ${a}.` };
    }
    if (c.type === "limit") {
      const v = c.variable || "x";
      const at = normalizeExpr(c.at);
      const pts: number[] = [];
      if (/^\+?Infinity$/.test(at)) pts.push(1e4, 1e6, 1e8);
      else if (at === "-Infinity") pts.push(-1e4, -1e6, -1e8);
      else {
        const a0 = Number(m().evaluate(at));
        pts.push(a0 + 1e-3, a0 + 1e-5, a0 + 1e-7);
      }
      const ys = pts.map((x) => evalAt(c.f, v, x));
      const target = normalizeExpr(c.result);
      const last = ys[ys.length - 1];
      if (/Infinity/.test(target)) {
        const pos = !target.startsWith("-");
        const ok = pos ? ys[2] > ys[1] && ys[2] > 1e3 : ys[2] < ys[1] && ys[2] < -1e3;
        return { check: c, ok, detail: ok ? "Limite infinie confirmée numériquement." : `Valeurs proches : ${ys.map((y) => y.toPrecision(4)).join(", ")}` };
      }
      const L = Number(m().evaluate(target));
      const ok = Math.abs(last - L) < 1e-3 * Math.max(1, Math.abs(L));
      return { check: c, ok, detail: ok ? "Limite confirmée numériquement." : `Approximation numérique : ${last.toPrecision(6)}` };
    }
  } catch (e) {
    return { check: c, ok: null, detail: "Expression non vérifiable automatiquement." };
  }
  return { check: c, ok: null, detail: "Type de vérification inconnu." };
}
