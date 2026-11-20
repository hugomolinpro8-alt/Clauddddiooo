import type { Exercise, ExamExercise, Item, Notion, Subject } from "./types";
import { addDays } from "./dates";
import { computeWeights, cardsFromNotions, exerciseTypes } from "./analysis";

/* Démo : faux cours de maths L1 (suites, limites, dérivées) + fausse annale. */

export const DEMO_COURSE = String.raw`# Analyse 1 — L1 Économie & Mathématiques (cours de démonstration)

## Chapitre 1 — Suites numériques

### §1.1 Suites arithmétiques et géométriques
Définition. Une suite $(u_n)$ est arithmétique de raison $r$ si pour tout $n$, $u_{n+1} = u_n + r$. Alors $u_n = u_0 + nr$.
Une suite est géométrique de raison $q$ si pour tout $n$, $u_{n+1} = q\,u_n$. Alors $u_n = u_0 q^n$.
Propriété. Pour $q \neq 1$ : $\sum_{k=0}^{n} q^k = \frac{1-q^{n+1}}{1-q}$.

### §1.2 Suites récurrentes $u_{n+1} = f(u_n)$
Méthode. Pour étudier une suite récurrente : (1) montrer par récurrence que $u_n$ reste dans un intervalle $I$ stable par $f$ ; (2) étudier le signe de $u_{n+1} - u_n$ ou la monotonie de $f$ ; (3) conclure avec le théorème de convergence monotone ; (4) la limite $\ell$ vérifie $f(\ell) = \ell$ si $f$ est continue.

### §1.3 Convergence
Théorème (convergence monotone). Toute suite croissante et majorée converge. Toute suite décroissante et minorée converge.
Théorème des gendarmes. Si $v_n \le u_n \le w_n$ à partir d'un certain rang et si $v_n$ et $w_n$ convergent vers la même limite $\ell$, alors $u_n$ converge vers $\ell$.

## Chapitre 2 — Limites et continuité

### §2.1 Opérations et formes indéterminées
Les formes indéterminées sont $\infty - \infty$, $0 \times \infty$, $\frac{\infty}{\infty}$, $\frac{0}{0}$, $1^\infty$. Méthode : factoriser par le terme dominant.

### §2.2 Croissances comparées
Théorème. Pour tous $a > 0$, $b > 0$ : $\lim_{x\to+\infty} \frac{(\ln x)^a}{x^b} = 0$ et $\lim_{x\to+\infty} \frac{x^b}{e^{ax}} = 0$.

### §2.3 Continuité et théorème des valeurs intermédiaires
Théorème (TVI). Si $f$ est continue sur $[a,b]$ et si $k$ est compris entre $f(a)$ et $f(b)$, alors il existe $c \in [a,b]$ tel que $f(c) = k$. Si de plus $f$ est strictement monotone, $c$ est unique.

## Chapitre 3 — Dérivation

### §3.1 Calcul de dérivées
Formules. $(uv)' = u'v + uv'$ ; $\left(\frac{u}{v}\right)' = \frac{u'v - uv'}{v^2}$ ; $(g \circ u)' = u' \times g' \circ u$. En particulier $(e^u)' = u'e^u$ et $(\ln u)' = \frac{u'}{u}$.

### §3.2 Étude de fonction
Méthode. Domaine, dérivée, signe de la dérivée (tableau de signes), tableau de variations, limites aux bornes, extremums. En économie : coût marginal $C'(q)$, élasticité $e = \frac{p}{q}\frac{dq}{dp}$.

### §3.3 Accroissements finis
Théorème (inégalité des accroissements finis). Si $f$ est dérivable sur $I$ et $|f'(x)| \le M$ sur $I$, alors pour tous $a, b \in I$ : $|f(b) - f(a)| \le M|b - a|$.
`;

export const DEMO_ANNALE = String.raw`# Partiel d'Analyse 1 — janvier 2025 (annale de démonstration)
Durée : 2 h. Documents non autorisés. Barème indicatif sur 20.

Exercice 1 (5 points). Soit $(u_n)$ définie par $u_0 = 1$ et $u_{n+1} = \sqrt{2 + u_n}$.
1. Montrer que pour tout $n$, $0 \le u_n \le 2$. 2. Montrer que $(u_n)$ est croissante. 3. En déduire qu'elle converge et calculer sa limite.

Exercice 2 (4 points). Calculer les limites : a) $\lim_{x\to+\infty} \frac{3x^2 - x}{2x^2 + 5}$ ; b) $\lim_{x\to+\infty} \frac{\ln x}{\sqrt{x}}$ ; c) $\lim_{x\to+\infty} x e^{-x}$.

Exercice 3 (6 points). Soit $f(x) = x e^{-x}$ sur $\mathbb{R}$. 1. Calculer $f'(x)$. 2. Dresser le tableau de variations de $f$. 3. Montrer que l'équation $f(x) = \frac{1}{4}$ admet exactement une solution sur $[0, 1]$.

Exercice 4 (5 points). Une entreprise a un coût total $C(q) = q^2 + 4q + 100$. 1. Calculer le coût marginal. 2. Déterminer la quantité qui minimise le coût moyen $\frac{C(q)}{q}$.
`;

export const DEMO_ANNALE_2 = String.raw`# Partiel d'Analyse 1 — janvier 2024 (annale de démonstration)

Exercice 1 (6 points). Soit $u_{n+1} = \frac{1}{2}u_n + 3$ avec $u_0 = 0$. 1. Montrer que $v_n = u_n - 6$ est géométrique. 2. En déduire $u_n$ et sa limite. 3. Calculer $\sum_{k=0}^{n} v_k$.

Exercice 2 (6 points). Étudier les variations de $g(x) = \ln(x) - x + 2$ sur $]0, +\infty[$ et montrer que $g(x) = 0$ a deux solutions.

Exercice 3 (4 points). Montrer que pour tous $x, y \ge 1$ : $|\ln x - \ln y| \le |x - y|$.

Exercice 4 (4 points). Encadrer $u_n = \frac{n + \sin n}{n + 1}$ et en déduire sa limite.
`;

function it(id: string, kind: Item["kind"], title: string, statement: string, section: string, excerpt: string): Item {
  return { id, kind, title, statement, source: { docId: "demo-cours", section, excerpt, verified: true } };
}

export function demoNotions(): Notion[] {
  const n = (id: string, chapterId: string, title: string, estHours: number, items: Item[]): Notion => ({ id, chapterId, title, items, weight: 0, frequency: 0, points: 0, estHours });
  return [
    n("n-arith-geo", "c-suites", "Suites arithmétiques et géométriques", 2, [
      it("i-geo", "formule", "Terme général d'une suite géométrique", String.raw`$u_{n+1} = q\,u_n \Rightarrow u_n = u_0 q^n$`, "Ch. 1 — §1.1", "Alors $u_n = u_0 q^n$"),
      it("i-somme-geo", "propriete", "Somme des termes d'une suite géométrique", String.raw`Pour $q \neq 1$ : $\sum_{k=0}^{n} q^k = \dfrac{1-q^{n+1}}{1-q}$`, "Ch. 1 — §1.1", "Pour $q \\neq 1$"),
    ]),
    n("n-recurrentes", "c-suites", "Suites récurrentes u(n+1) = f(u(n))", 4, [
      it("i-methode-rec", "methode", "Étudier une suite récurrente", String.raw`1) Récurrence : $u_n \in I$ stable par $f$. 2) Signe de $u_{n+1}-u_n$. 3) Convergence monotone. 4) La limite vérifie $f(\ell)=\ell$ si $f$ continue.`, "Ch. 1 — §1.2", "montrer par récurrence que $u_n$ reste dans un intervalle"),
    ]),
    n("n-convergence", "c-suites", "Convergence : monotone et gendarmes", 3, [
      it("i-conv-mono", "theoreme", "Théorème de convergence monotone", "Toute suite croissante et majorée converge. Toute suite décroissante et minorée converge.", "Ch. 1 — §1.3", "Toute suite croissante et majorée converge"),
      it("i-gendarmes", "theoreme", "Théorème des gendarmes", String.raw`Si $v_n \le u_n \le w_n$ à partir d'un rang et $v_n, w_n \to \ell$, alors $u_n \to \ell$.`, "Ch. 1 — §1.3", "Théorème des gendarmes"),
    ]),
    n("n-fi", "c-limites", "Limites : opérations et formes indéterminées", 3, [
      it("i-fi", "methode", "Lever une forme indéterminée", String.raw`Formes : $\infty-\infty$, $0\times\infty$, $\frac{\infty}{\infty}$, $\frac00$, $1^\infty$. Méthode : factoriser par le terme dominant.`, "Ch. 2 — §2.1", "factoriser par le terme dominant"),
    ]),
    n("n-croissances", "c-limites", "Croissances comparées", 1.5, [
      it("i-cc", "theoreme", "Croissances comparées", String.raw`$a,b>0$ : $\lim_{x\to+\infty} \frac{(\ln x)^a}{x^b} = 0$ et $\lim_{x\to+\infty} \frac{x^b}{e^{ax}} = 0$`, "Ch. 2 — §2.2", "Croissances comparées"),
    ]),
    n("n-tvi", "c-limites", "Continuité et TVI", 2.5, [
      it("i-tvi", "theoreme", "Théorème des valeurs intermédiaires", String.raw`$f$ continue sur $[a,b]$, $k$ entre $f(a)$ et $f(b)$ $\Rightarrow \exists c\in[a,b],\ f(c)=k$. Unique si $f$ strictement monotone.`, "Ch. 2 — §2.3", "il existe $c \\in [a,b]$ tel que $f(c) = k$"),
    ]),
    n("n-derivees", "c-deriv", "Calcul de dérivées", 2, [
      it("i-deriv-formules", "formule", "Dérivées : produit, quotient, composée", String.raw`$(uv)' = u'v+uv'$ ; $\left(\frac uv\right)' = \frac{u'v-uv'}{v^2}$ ; $(e^u)' = u'e^u$ ; $(\ln u)' = \frac{u'}{u}$`, "Ch. 3 — §3.1", "$(uv)' = u'v + uv'$"),
    ]),
    n("n-etude", "c-deriv", "Étude de fonction et optimisation (coût marginal)", 4, [
      it("i-etude", "methode", "Plan d'une étude de fonction", "Domaine → dérivée → signe de la dérivée → tableau de variations → limites aux bornes → extremums.", "Ch. 3 — §3.2", "Domaine, dérivée, signe de la dérivée"),
      it("i-elasticite", "definition", "Élasticité", String.raw`$e = \dfrac{p}{q}\dfrac{dq}{dp}$ ; coût marginal $= C'(q)$`, "Ch. 3 — §3.2", "élasticité"),
    ]),
    n("n-taf", "c-deriv", "Inégalité des accroissements finis", 2, [
      it("i-iaf", "theoreme", "Inégalité des accroissements finis", String.raw`$f$ dérivable sur $I$, $|f'| \le M$ sur $I$ $\Rightarrow |f(b)-f(a)| \le M|b-a|$`, "Ch. 3 — §3.3", "inégalité des accroissements finis"),
    ]),
  ];
}

export function demoExamExercises(): ExamExercise[] {
  const e = (id: string, docId: string, year: string, title: string, statement: string, notionIds: string[], type: string, points: number): ExamExercise => ({ id, docId, year, title, statement, notionIds, type, points });
  return [
    e("a25-1", "demo-annale-2025", "2025", "Exercice 1", String.raw`$u_0=1$, $u_{n+1}=\sqrt{2+u_n}$ : bornes, croissance, limite.`, ["n-recurrentes", "n-convergence"], "Étude de suite récurrente", 5),
    e("a25-2", "demo-annale-2025", "2025", "Exercice 2", "Trois limites (fraction rationnelle, croissances comparées).", ["n-fi", "n-croissances"], "Calcul de limites", 4),
    e("a25-3", "demo-annale-2025", "2025", "Exercice 3", String.raw`$f(x)=xe^{-x}$ : dérivée, variations, TVI.`, ["n-derivees", "n-etude", "n-tvi"], "Étude de fonction + TVI", 6),
    e("a25-4", "demo-annale-2025", "2025", "Exercice 4", "Coût marginal et minimisation du coût moyen.", ["n-derivees", "n-etude"], "Optimisation économique", 5),
    e("a24-1", "demo-annale-2024", "2024", "Exercice 1", "Suite arithmético-géométrique, suite auxiliaire géométrique.", ["n-arith-geo", "n-recurrentes"], "Étude de suite récurrente", 6),
    e("a24-2", "demo-annale-2024", "2024", "Exercice 2", String.raw`$g(x)=\ln x - x + 2$ : variations, deux solutions.`, ["n-etude", "n-tvi"], "Étude de fonction + TVI", 6),
    e("a24-3", "demo-annale-2024", "2024", "Exercice 3", "Inégalité par les accroissements finis.", ["n-taf"], "Inégalité des accroissements finis", 4),
    e("a24-4", "demo-annale-2024", "2024", "Exercice 4", "Encadrement et gendarmes.", ["n-convergence"], "Encadrement / gendarmes", 4),
  ];
}

export function demoExercises(subjectId: string): Exercise[] {
  return [
    {
      id: "ex-demo-1", subjectId, notionIds: ["n-derivees", "n-etude"], difficulty: 2, createdAt: new Date().toISOString(),
      title: "Dérivée et variations de f(x) = (x² + 1)e^{-x}",
      statement: String.raw`Soit $f(x) = (x^2+1)e^{-x}$ sur $\mathbb{R}$.
1. Calculer $f'(x)$ et l'écrire sous forme factorisée.
2. En déduire les variations de $f$.`,
      hints: [
        "Quelle formule de dérivation s'applique à un produit $u \\times v$ ?",
        "Pose $u = x^2+1$ et $v = e^{-x}$ : calcule $u'$ et $v'$ séparément, puis factorise par $e^{-x}$.",
        "Tu dois obtenir $f'(x) = -(x-1)^2 e^{-x}$. Que peux-tu dire de son signe ?",
      ],
      solution: String.raw`$f'(x) = 2x e^{-x} - (x^2+1)e^{-x} = -(x^2 - 2x + 1)e^{-x} = -(x-1)^2 e^{-x}$.
Comme $e^{-x} > 0$ et $(x-1)^2 \ge 0$, $f'(x) \le 0$ avec égalité seulement en $x=1$ : $f$ est strictement décroissante sur $\mathbb{R}$.`,
      bareme: [
        { step: "Formule du produit correctement appliquée", points: 1.5 },
        { step: "Factorisation $-(x-1)^2e^{-x}$", points: 1.5 },
        { step: "Signe de $f'$ justifié", points: 1 },
        { step: "Conclusion sur les variations", points: 1 },
      ],
      finalAnswer: String.raw`f'(x) = -(x-1)^2 e^{-x}`,
      verification: { status: "ok", notes: "Dérivée confirmée par calcul symbolique." },
    },
  ];
}

export function makeDemoSubject(today: string): { subject: Subject; docs: Record<string, string> } {
  const id = "demo-analyse";
  const exercises = demoExamExercises();
  const notions = computeWeights(demoNotions(), exercises);
  const subject: Subject = {
    id,
    name: "Analyse 1 (démo)",
    color: "#2B59C3",
    examDate: addDays(today, 14),
    examTime: "08:30",
    durationMin: 120,
    docsAllowed: false,
    coef: 3,
    targetGrade: 15,
    chapters: [
      { id: "c-suites", title: "Suites numériques", selfLevel: 3 },
      { id: "c-limites", title: "Limites et continuité", selfLevel: 2 },
      { id: "c-deriv", title: "Dérivation", selfLevel: 4 },
    ],
    notions,
    examExercises: exercises,
    documents: [
      { id: "demo-cours", name: "Cours Analyse 1 (démo).md", role: "cours", mime: "text/markdown", chars: DEMO_COURSE.length, addedAt: new Date().toISOString(), analyzed: true, status: "pret" },
      { id: "demo-annale-2025", name: "Partiel janvier 2025 (démo).md", role: "annale", mime: "text/markdown", chars: DEMO_ANNALE.length, addedAt: new Date().toISOString(), analyzed: true, status: "pret" },
      { id: "demo-annale-2024", name: "Partiel janvier 2024 (démo).md", role: "annale", mime: "text/markdown", chars: DEMO_ANNALE_2.length, addedAt: new Date().toISOString(), analyzed: true, status: "pret" },
    ],
    analysis: {
      generatedAt: new Date().toISOString(),
      annalesCount: 2,
      summary: "Deux annales analysées. Trois blocs rapportent l'essentiel des points : suites récurrentes (≈ 5-6 pts à chaque fois), étude de fonction avec TVI (≈ 6 pts) et dérivées appliquées à l'économie. Les croissances comparées et les accroissements finis tombent moins mais vite.",
      exerciseTypes: exerciseTypes(exercises, {
        "Étude de suite récurrente": "Bornes par récurrence → monotonie → convergence monotone → limite par point fixe. Tombe chaque année.",
        "Étude de fonction + TVI": "Dérivée, tableau de variations, puis existence/unicité d'une solution par le TVI (corollaire de la bijection).",
        "Calcul de limites": "Factorisation par le terme dominant et croissances comparées.",
        "Optimisation économique": "Coût marginal, coût moyen minimal : dériver et étudier le signe.",
      }),
    },
    cards: [],
    attempts: [],
    exercises: demoExercises(id),
    sessions: [],
    mockExams: [],
    createdAt: new Date().toISOString(),
  };
  subject.cards = cardsFromNotions(subject.notions, today);
  return { subject, docs: { "demo-cours": DEMO_COURSE, "demo-annale-2025": DEMO_ANNALE, "demo-annale-2024": DEMO_ANNALE_2 } };
}
