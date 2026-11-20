// Test de bout en bout : parcours complet sur la démo, IA simulée (hors claude.ai).
// Usage : npm run build && npm run e2e   (lance son propre serveur de prévisualisation)
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // Playwright préinstallé ou installé globalement
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const SHOTS = process.env.SHOTS || "";
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--port", "4179", "--strictPort"], { stdio: "pipe" });
await new Promise((r) => { server.stdout.on("data", (d) => String(d).includes("4179") && r()); setTimeout(r, 6000); });

const errors = [];
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: SHOTS ? 2 : 1 });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g/.test(m.text())) errors.push("console: " + m.text()); });
const shot = async (name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); } };
const step = (s) => console.log("•", s);

try {
  await page.goto("http://localhost:4179/");
  await page.getByText("Un programme jour par jour").waitFor();
  await shot("01-accueil-vide");
  step("Chargement de la démo");
  await page.getByRole("button", { name: /Charger les données de test/ }).click();
  await page.getByRole("heading", { name: "Aujourd'hui" }).waitFor();

  step("Check-in");
  await page.locator("#ci-hours").fill("3");
  await page.getByRole("button", { name: "Valider le check-in" }).click();
  await page.getByText("Check-in du matin").waitFor({ timeout: 15000 });
  await shot("02-aujourdhui");

  step("Flashcards");
  await page.locator('[data-block="flashcards"]').first().getByRole("button", { name: "Commencer" }).click();
  await page.getByRole("heading", { name: "Flashcards" }).waitFor();
  for (let i = 0; i < 3; i++) {
    await page.getByRole("button", { name: /retourner/ }).click();
    if (i === 0) await shot("03-flashcard");
    await page.getByRole("button", { name: /Bien/ }).click();
  }
  const reviewed = await page.getByText("3 revue(s) dans cette session").count();
  if (!reviewed) throw new Error("compteur de révisions incorrect");

  step("Exercice + correction");
  await page.goto("http://localhost:4179/#aujourdhui");
  await page.locator('[data-block="exercices"], [data-block="mini-cours"], [data-block="annale"]').first().getByRole("button", { name: "Commencer" }).click();
  await page.waitForFunction(() => location.hash === "#exercice");
  const pick = page.getByRole("button", { name: "Faire celui-ci" });
  if (await pick.count()) await pick.first().click();
  else await page.getByRole("button", { name: /Générer un exercice/ }).click();
  await page.locator("#ex-answer").waitFor({ timeout: 15000 });
  await page.getByRole("button", { name: /Indice 1/ }).click();
  await page.locator("#ex-answer").fill("On applique la formule du produit : f'(x) = 2x e^{-x} - (x^2+1)e^{-x} = -(x-1)^2 e^{-x}. Comme e^{-x} > 0 et (x-1)^2 >= 0, f est décroissante. Signe de la dérivée négatif, conclusion : f strictement décroissante.");
  await shot("04-exercice");
  await page.getByRole("button", { name: "Rendre ma copie" }).click();
  await page.getByText(/Ce que tu as rendu/).waitFor({ timeout: 20000 });
  await shot("05-correction");

  step("Planning");
  await page.goto("http://localhost:4179/#planning");
  await page.getByRole("heading", { name: /Programme jusqu'au partiel/ }).waitFor();
  const days = await page.locator("text=/prévues/").count();
  if (days < 10) throw new Error("planning trop court : " + days);
  await shot("06-planning");

  step("Rapport d'analyse");
  await page.goto("http://localhost:4179/#matiere");
  await page.getByText("Exercices types qui reviennent").waitFor();
  await shot("07-analyse");

  step("Suivi");
  await page.goto("http://localhost:4179/#suivi");
  await page.getByText("Comment la note est calculée").waitFor();
  await shot("08-suivi");

  step("Examen blanc");
  await page.goto("http://localhost:4179/#examen");
  await page.getByRole("button", { name: /Générer le sujet/ }).click();
  await page.getByRole("button", { name: "Lancer le chrono" }).click({ timeout: 15000 });
  await page.locator("textarea").first().fill("Réponse rapide de test.");
  await shot("09-examen");
  await page.getByRole("button", { name: "Rendre ma copie" }).click();
  await page.getByRole("button", { name: "Oui" }).click();
  await page.getByText(/sous ton objectif|atteint en conditions réelles/).waitFor({ timeout: 30000 });

  step("Persistance après rechargement");
  await page.waitForTimeout(1500);
  await page.reload();
  await page.goto("http://localhost:4179/#accueil");
  await page.getByText("Analyse 1 (démo)").first().waitFor();

  step("Mobile");
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 3 : 1 });
  m.on("pageerror", (e) => errors.push("mobile pageerror: " + e.message));
  await m.goto("http://localhost:4179/");
  await m.evaluate(() => {});
  await m.getByRole("button", { name: /Charger les données de test/ }).click();
  await m.getByRole("heading", { name: "Aujourd'hui" }).waitFor();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) throw new Error("défilement horizontal sur mobile : " + overflow + "px");
  if (SHOTS) await m.screenshot({ path: `${SHOTS}/10-mobile-aujourdhui.png` });
  for (const r of ["planning", "suivi", "matiere"]) {
    await m.goto("http://localhost:4179/#" + r);
    await m.waitForTimeout(400);
    const o = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (o > 1) throw new Error(`défilement horizontal sur mobile (${r}) : ${o}px`);
  }

  if (errors.length) throw new Error("Erreurs navigateur :\n" + errors.join("\n"));
  console.log("E2E OK");
} catch (e) {
  console.error("E2E ÉCHEC :", e.message);
  if (errors.length) console.error(errors.join("\n"));
  await page.screenshot({ path: "test-results-e2e-failure.png" }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
