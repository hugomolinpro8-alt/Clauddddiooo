// Transforme dist/index.html (fichier unique) en page publiable sur claude.ai :
// la plateforme ajoute elle-même <!doctype>, <html>, <head> et <body>.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const html = readFileSync("dist/index.html", "utf8");
const pick = (re) => [...html.matchAll(re)].map((m) => m[0]);
const title = pick(/<title>[\s\S]*?<\/title>/g)[0] ?? "<title>Coach Partiels</title>";
const metas = pick(/<meta name="claude:[^>]*>/g);
const links = pick(/<link [^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g);
const styles = pick(/<style[^>]*>[\s\S]*?<\/style>/g);
const scripts = pick(/<script[^>]*>[\s\S]*?<\/script>/g);
const out = [title, ...metas, ...links, ...styles, '<div id="root"></div>', ...scripts].join("\n");
mkdirSync("artifact", { recursive: true });
writeFileSync("artifact/coach-partiels.html", out);
console.log(`artifact/coach-partiels.html : ${(out.length / 1024 / 1024).toFixed(2)} Mo`);
