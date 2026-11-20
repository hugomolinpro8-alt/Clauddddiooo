// Génère /public/og.png (1200x630) avec le logo GOGGLES rendu en Anton.
// Nécessite Playwright (Chromium) : npx playwright install chromium   puis   node scripts/generate-og.mjs
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const logo = await fs.readFile(path.join(ROOT, "public/brand/goggles-logo-fond-fonce.svg"), "utf8");
const scene = await fs.readFile(path.join(ROOT, "public/scenes/intro.svg"), "utf8");
const html = `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@600&display=block" rel="stylesheet">
<style>html,body{margin:0;width:1200px;height:630px;background:#0E1A2B;overflow:hidden}
.s{position:absolute;inset:0;opacity:.55}.s svg{width:100%;height:100%}
.v{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(14,26,43,.2),rgba(14,26,43,.85))}
.l{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:760px}.l svg{width:100%;height:auto}
p{position:absolute;bottom:70px;width:100%;text-align:center;margin:0;font:600 18px Inter;letter-spacing:8px;color:#9FB3C8;text-transform:uppercase}</style></head>
<body><div class="s">${scene.replace(/width="\d+" height="\d+"/, 'preserveAspectRatio="xMidYMid slice"')}</div><div class="v"></div><div class="l">${logo}</div><p>Masques de ski authentiques</p></body></html>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
await p.setContent(html, { waitUntil: "networkidle" });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: path.join(ROOT, "public/og.png") });
await b.close();
console.log("public/og.png généré");
