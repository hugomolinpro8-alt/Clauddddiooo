#!/usr/bin/env node
/**
 * analyze-har.mjs — Analyse un fichier HAR capturé sur Vinted et produit un
 * rapport ANONYMISÉ, que vous pouvez partager sans risque.
 *
 * Usage :
 *   node tools/analyze-har.mjs chemin/vers/capture.har
 *
 * Produit, à côté du fichier HAR :
 *   capture.rapport.md    rapport lisible (endpoints, méthodes, structure des données)
 *   capture.rapport.json  même contenu, format machine
 *
 * Ce qui est SUPPRIMÉ / MASQUÉ :
 *   - tous les cookies, jetons (CSRF, auth, session), en-têtes d'authentification ;
 *   - toutes les valeurs texte des corps de requête/réponse (remplacées par
 *     leur type et leur longueur), sauf quelques champs techniques sans
 *     donnée personnelle (statut, type, devise...) ;
 *   - les adresses e-mail et numéros de téléphone repérés.
 * Seule la STRUCTURE des échanges est conservée : c'est tout ce qu'il faut
 * pour identifier les bons endpoints.
 *
 * ⚠ Ne partagez JAMAIS le fichier .har brut : il contient vos cookies de
 * session, qui permettent de se connecter à votre compte.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** En-têtes dont on ne garde que le NOM (la valeur est secrète ou personnelle). */
const SENSITIVE_HEADER = /cookie|authorization|token|csrf|session|anon|auth|secret|key|fingerprint|datadome|x-amz|signature/i;
/** En-têtes standards sans intérêt pour l'analyse. */
const BORING_HEADER = /^(accept-encoding|accept-language|connection|host|sec-ch-|sec-fetch-|user-agent|referer|origin|pragma|cache-control|priority|dnt|upgrade-insecure|te$|:)/i;
/** Champs dont la valeur courte est conservée (techniques, non personnels). */
const SAFE_VALUE_KEYS = new Set([
  'status', 'type', 'entry_type', 'kind', 'currency', 'currency_code', 'code', 'action', 'state',
  'order', 'per_page', 'page', 'is_draft', 'is_hidden', 'is_closed', 'status_id', 'package_size_id',
  'catalog_id', 'brand_id', 'size_id', 'color_ids', 'material_ids', 'temp_uuid', 'upload_session_id',
  'is_unisex', 'item_status', 'message_type', 'transaction_status', 'total_pages', 'current_page',
  'total_entries', 'time', 'per_page', 'feedback_reputation',
]);
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE = /\+?\d[\d .-]{8,}\d/g;
const MAX_DEPTH = 6;

/** Remplace les identifiants dans un chemin : /items/123/edit → /items/{id}/edit */
export function normalizePath(pathname) {
  return pathname
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/{uuid}')
    .replace(/\/\d+(?=\/|$)/g, '/{id}')
    .replace(/\/\d+-[^/]+(?=\/|$)/g, '/{id-slug}');
}

/** Masque un texte libre tout en indiquant sa nature. */
function maskString(s) {
  if (/^https?:\/\//.test(s)) {
    try {
      const u = new URL(s);
      return `<url ${u.host}${normalizePath(u.pathname)}>`;
    } catch {
      return '<url>';
    }
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return '<date>';
  return `<texte ${s.length} car.>`;
}

/**
 * Décrit la STRUCTURE d'une valeur JSON sans ses données personnelles.
 * Les tableaux sont résumés par leur longueur et la forme de leur 1er élément.
 */
export function shapeOf(value, key = '', depth = 0) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    if (!value.length) return [];
    return { '<tableau>': value.length, '<exemple>': shapeOf(value[0], key, depth + 1) };
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '<objet…>';
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = shapeOf(v, k, depth + 1);
    return out;
  }
  if (typeof value === 'string') {
    if (SAFE_VALUE_KEYS.has(key) && value.length <= 40) return value.replace(EMAIL, '<email>').replace(PHONE, '<tel>');
    return maskString(value);
  }
  if (typeof value === 'number') {
    // Les identifiants longs sont masqués ; les petits nombres (prix, compteurs, ids de catalogue) gardés.
    if (SAFE_VALUE_KEYS.has(key)) return value;
    return /(^|_)id$|_ids?$|^id$/.test(key) && value > 99999 ? '<id>' : value;
  }
  return value; // booléens
}

/** Analyse un corps (JSON, formulaire, multipart). */
function describeBody(text, mimeType = '', params) {
  if (params?.length) {
    return { format: mimeType || 'formulaire', champs: params.map((p) => (p.fileName ? `${p.name} (fichier)` : p.name)) };
  }
  if (!text) return null;
  if (/multipart\/form-data/i.test(mimeType)) {
    const names = [...text.matchAll(/name="([^"]+)"(; filename="[^"]*")?/g)].map((m) => (m[2] ? `${m[1]} (fichier)` : m[1]));
    return { format: 'multipart/form-data', champs: [...new Set(names)] };
  }
  try {
    return { format: 'json', structure: shapeOf(JSON.parse(text)) };
  } catch {
    if (/x-www-form-urlencoded/i.test(mimeType)) {
      return { format: 'formulaire', champs: [...new URLSearchParams(text).keys()] };
    }
    if (/<html/i.test(text)) return { format: 'html', note: 'page HTML (possible page de vérification)' };
    return { format: mimeType || 'texte', note: `<${text.length} car.>` };
  }
}

/** Liste les en-têtes intéressants (noms seulement pour les sensibles). */
function describeHeaders(headers = []) {
  const out = {};
  for (const { name, value } of headers) {
    if (BORING_HEADER.test(name)) continue;
    const n = name.toLowerCase();
    out[n] = SENSITIVE_HEADER.test(n) ? '[masqué]' : String(value).slice(0, 80);
  }
  return out;
}

/** Fonction principale, testable : objet HAR → rapport. */
export function analyzeHar(har) {
  const entries = har?.log?.entries;
  if (!Array.isArray(entries)) throw new Error("Ce fichier n'est pas un HAR valide (log.entries manquant).");

  const groups = new Map();
  const alerts = [];
  let ignored = 0;

  for (const e of entries) {
    let url;
    try {
      url = new URL(e.request.url);
    } catch {
      ignored++;
      continue;
    }
    // On ne garde que les appels d'API Vinted (pas les images, scripts, pubs…).
    if (!/(^|\.)vinted\.[a-z.]+$/.test(url.hostname) || !url.pathname.includes('/api/')) {
      ignored++;
      continue;
    }
    const method = e.request.method;
    const path = normalizePath(url.pathname);
    const key = `${method} ${path}`;
    const status = e.response?.status;

    if (status === 403 || status === 429) alerts.push(`${key} a renvoyé HTTP ${status}`);

    if (!groups.has(key)) {
      groups.set(key, {
        methode: method,
        chemin: path,
        hote: url.hostname,
        appels: 0,
        statuts: {},
        parametres: [...new Set([...url.searchParams.keys()])],
        enTetes: describeHeaders(e.request.headers),
        requete: describeBody(e.request.postData?.text, e.request.postData?.mimeType, e.request.postData?.params),
        reponse: describeBody(e.response?.content?.text, e.response?.content?.mimeType),
        premierAppel: e.startedDateTime || null,
      });
    }
    const g = groups.get(key);
    g.appels++;
    g.statuts[status] = (g.statuts[status] || 0) + 1;
    for (const p of url.searchParams.keys()) if (!g.parametres.includes(p)) g.parametres.push(p);
  }

  // Ordre chronologique : suit l'ordre des actions faites à la main.
  const endpoints = [...groups.values()].sort((a, b) => String(a.premierAppel).localeCompare(String(b.premierAppel)));
  return { total: entries.length, ignores: ignored, endpoints, alertes: alerts };
}

/** Rapport lisible en Markdown. */
export function toMarkdown(report, sourceName = 'capture.har') {
  const lines = [
    `# Rapport HAR anonymisé — ${sourceName}`,
    '',
    `${report.endpoints.length} endpoint(s) d'API Vinted trouvés sur ${report.total} requêtes (${report.ignores} ignorées : images, scripts, autres sites).`,
    '',
    'Toutes les valeurs personnelles ont été masquées. Ce fichier peut être partagé.',
    '',
  ];
  if (report.alertes.length) {
    lines.push('## ⚠ Alertes', '', ...report.alertes.map((a) => `- ${a}`), '');
  }
  for (const ep of report.endpoints) {
    lines.push(`## ${ep.methode} \`${ep.chemin}\``, '');
    lines.push(`- Hôte : ${ep.hote} — appels : ${ep.appels} — statuts : ${Object.entries(ep.statuts).map(([s, n]) => `${s}×${n}`).join(', ')}`);
    if (ep.parametres.length) lines.push(`- Paramètres d'URL : ${ep.parametres.map((p) => `\`${p}\``).join(', ')}`);
    const h = Object.entries(ep.enTetes);
    if (h.length) lines.push(`- En-têtes : ${h.map(([k, v]) => `\`${k}: ${v}\``).join(', ')}`);
    if (ep.requete) lines.push('- Corps de la requête :', '```json', JSON.stringify(ep.requete, null, 2), '```');
    if (ep.reponse) lines.push('- Réponse :', '```json', JSON.stringify(ep.reponse, null, 2).slice(0, 6000), '```');
    lines.push('');
  }
  return lines.join('\n');
}

// --- Exécution en ligne de commande ----------------------------------------
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage : node tools/analyze-har.mjs chemin/vers/capture.har');
    process.exit(1);
  }
  let har;
  try {
    har = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Impossible de lire ${file} : ${e.message}`);
    process.exit(1);
  }
  const report = analyzeHar(har);
  const base = join(dirname(file), basename(file).replace(/\.har$/i, ''));
  writeFileSync(`${base}.rapport.md`, toMarkdown(report, basename(file)));
  writeFileSync(`${base}.rapport.json`, JSON.stringify(report, null, 2));
  console.log(`✓ ${report.endpoints.length} endpoint(s) trouvés.`);
  console.log(`  Rapport : ${base}.rapport.md`);
  console.log(`  (format machine : ${base}.rapport.json)`);
  if (report.alertes.length) console.log(`⚠ ${report.alertes.length} alerte(s) 403/429 dans la capture.`);
}
