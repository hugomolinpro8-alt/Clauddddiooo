// Génère tous les visuels de remplacement (placeholders) du site :
//  - icônes PNG (32 / 180 / 512) + favicon.ico à partir de /public/brand/goggles-icone.svg
//  - pour chaque produit de data/products.json : photo détourée PNG transparente,
//    4 photos de galerie, séquence 360° (24 images)
//  - scènes de fond (dégradés + montagnes) dans /public/scenes/
//
// Usage : npm run assets   (n'écrase PAS les fichiers déjà présents, sauf avec --force)
// Les placeholders sont des dessins originaux : aucune image de marque.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const FORCE = process.argv.includes("--force");

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
async function write(p, buf) {
  if (!FORCE && (await exists(p))) return false;
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, buf);
  return true;
}

/* ------------------------------------------------------------------ */
/* Couleurs                                                            */
/* ------------------------------------------------------------------ */
function hexToRgb(h) {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ */
/* Silhouette de masque (dessin original)                              */
/* ------------------------------------------------------------------ */
// Contour de la monture, centré sur (0,0), ~1100 x 560.
const FRAME =
  "M -540 -170 C -360 -262 360 -262 540 -170 C 612 -128 626 40 586 160 " +
  "C 556 246 470 282 330 280 C 230 278 170 262 120 214 C 80 172 40 150 0 150 " +
  "C -40 150 -80 172 -120 214 C -170 262 -230 278 -330 280 C -470 282 -556 246 -586 160 " +
  "C -626 40 -612 -128 -540 -170 Z";
const LENS =
  "M -498 -138 C -330 -218 330 -218 498 -138 C 556 -104 566 34 534 134 " +
  "C 510 206 440 234 326 232 C 238 230 188 216 146 176 C 104 136 52 112 0 112 " +
  "C -52 112 -104 136 -146 176 C -188 216 -238 230 -326 232 C -440 234 -510 206 -534 134 " +
  "C -566 34 -556 -104 -498 -138 Z";

/**
 * Dessine le masque vu sous l'angle `deg` (0 = face, 90 = profil, 180 = dos).
 * Pseudo-3D : compression horizontale par cos(angle) + profil épaissi.
 */
function goggleSVG({ tint, frame = "#151C26", strap = "#1E2733", deg = 0, w = 1600, h = 900, bg = null, label = null, zoom = 1 }) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const sx = Math.max(Math.abs(c), 0.16);
  const back = c < 0;
  const id = `g${Math.round(deg)}${tint.replace("#", "")}`;
  const lensTop = mix(tint, "#FFFFFF", 0.35);
  const lensBot = mix(tint, "#0E1A2B", 0.45);
  // Décalage latéral léger pour simuler la rotation autour de la tête
  const shift = s * 60;
  const strapSpan = 720;
  const strapY = -20;

  const strapBand = `
    <path d="M ${-strapSpan} ${strapY - 58} C ${-strapSpan / 2} ${strapY - 74} ${strapSpan / 2} ${strapY - 74} ${strapSpan} ${strapY - 58}
             L ${strapSpan} ${strapY + 58} C ${strapSpan / 2} ${strapY + 44} ${-strapSpan / 2} ${strapY + 44} ${-strapSpan} ${strapY + 58} Z"
          fill="${strap}"/>
    <path d="M ${-strapSpan} ${strapY - 18} C ${-strapSpan / 2} ${strapY - 32} ${strapSpan / 2} ${strapY - 32} ${strapSpan} ${strapY - 18}"
          stroke="${mix(strap, "#9FB3C8", 0.35)}" stroke-width="6" fill="none" stroke-dasharray="26 18" opacity="0.6"/>`;

  const front = `
    <g transform="translate(${shift},0) scale(${sx},1)">
      <path d="${FRAME}" fill="${frame}"/>
      <path d="${FRAME}" fill="url(#rim${id})" opacity="0.55"/>
      <path d="${LENS}" fill="url(#lens${id})"/>
      <path d="${LENS}" fill="url(#shine${id})"/>
      <path d="M -430 -150 C -250 -200 -60 -206 120 -190" stroke="#FFFFFF" stroke-width="14" stroke-linecap="round" fill="none" opacity="0.45"/>
      <path d="M -470 -40 C -380 -150 -220 -186 -80 -190" stroke="#FFFFFF" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.35"/>
      <rect x="-60" y="-236" width="120" height="16" rx="8" fill="${mix(frame, "#FFFFFF", 0.2)}" opacity="0.8"/>
    </g>`;

  const backView = `
    <g transform="translate(${shift},0) scale(${sx},1)">
      <path d="${FRAME}" fill="${frame}"/>
      <path d="${LENS}" fill="${mix(frame, "#3A4656", 0.6)}"/>
      <path d="${LENS}" fill="url(#foam${id})" opacity="0.9"/>
    </g>`;

  // Profil : épaisseur visible quand on est proche de 90°
  const profile = Math.abs(c) < 0.5
    ? `<g transform="translate(${shift + (c >= 0 ? 1 : -1) * Math.sign(s || 1) * 540 * sx},0)">
         <path d="M ${-70 * (1 - Math.abs(c))} -200 C 60 -210 80 200 ${-30 * (1 - Math.abs(c))} 270 L ${-110 * (1 - Math.abs(c))} 240 C -40 160 -40 -160 ${-110 * (1 - Math.abs(c))} -180 Z"
               fill="${mix(frame, "#FFFFFF", 0.08)}" opacity="${(1 - Math.abs(c) * 2).toFixed(2)}"/>
       </g>`
    : "";

  const scale = Math.min(w / 1600, h / 900) * zoom;
  const bgRect = bg
    ? `<rect width="${w}" height="${h}" fill="url(#bg${id})"/>
       <ellipse cx="${w / 2}" cy="${h * 0.8}" rx="${w * 0.32}" ry="${h * 0.035}" fill="#0E1A2B" opacity="0.12"/>`
    : "";
  const lab = label
    ? `<text x="${w / 2}" y="${h - 48}" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="${Math.round(w / 48)}" letter-spacing="6" fill="#4A5A6D">${label}</text>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="lens${id}" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="${lensTop}"/>
      <stop offset="0.55" stop-color="${tint}"/>
      <stop offset="1" stop-color="${lensBot}"/>
    </linearGradient>
    <radialGradient id="shine${id}" cx="0.3" cy="0.2" r="0.8">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="0.4" stop-color="#FFFFFF" stop-opacity="0.08"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.25"/>
    </radialGradient>
    <linearGradient id="rim${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/>
      <stop offset="0.5" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <pattern id="foamp${id}" width="18" height="18" patternUnits="userSpaceOnUse">
      <circle cx="9" cy="9" r="3" fill="#000" opacity="0.25"/>
    </pattern>
    <linearGradient id="bg${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#DCE4EC"/>
    </linearGradient>
    <linearGradient id="foam${id}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#5A6778"/>
      <stop offset="1" stop-color="#2A3442"/>
    </linearGradient>
  </defs>
  ${bgRect}
  <g transform="translate(${w / 2},${h / 2 - (bg ? h * 0.04 : 0)}) scale(${scale})">
    ${back ? "" : strapBand}
    ${back ? backView : front}
    ${back ? strapBand : ""}
    ${profile}
  </g>
  ${lab}
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Scènes de fond                                                      */
/* ------------------------------------------------------------------ */
function sceneSVG({ sky1, sky2, m1, m2, m3, sun = true, seed = 1, w = 2400, h = 1350 }) {
  let r = seed;
  const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const ridge = (base, amp, n) => {
    let d = `M 0 ${h} L 0 ${base}`;
    for (let i = 1; i <= n; i++) {
      const x = (w / n) * i;
      const y = base - rnd() * amp;
      d += ` L ${x - w / n / 2} ${y} L ${x} ${base - rnd() * amp * 0.35}`;
    }
    return d + ` L ${w} ${h} Z`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky1}"/><stop offset="1" stop-color="${sky2}"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.72" cy="0.3" r="0.35">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.75"/>
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="snow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.9"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  ${sun ? `<rect width="${w}" height="${h}" fill="url(#sun)"/>` : ""}
  <path d="${ridge(h * 0.55, h * 0.25, 7)}" fill="${m1}"/>
  <path d="${ridge(h * 0.68, h * 0.22, 9)}" fill="${m2}"/>
  <path d="${ridge(h * 0.82, h * 0.16, 12)}" fill="${m3}"/>
  <rect y="${h * 0.86}" width="${w}" height="${h * 0.14}" fill="url(#snow)" opacity="0.35"/>
</svg>`;
}

const SCENES = {
  "intro.svg": { sky1: "#0E1A2B", sky2: "#3B5878", m1: "#5D7A99", m2: "#2B4260", m3: "#16263B", seed: 3 },
  "carrousel.svg": { sky1: "#FFFFFF", sky2: "#C9D6E3", m1: "#E4ECF3", m2: "#C3D1DE", m3: "#9FB3C8", seed: 7 },
  "technologie-01.svg": { sky1: "#0E1A2B", sky2: "#2C5D8F", m1: "#4E739B", m2: "#22405F", m3: "#0E1A2B", seed: 11 },
  "technologie-02.svg": { sky1: "#1B2B45", sky2: "#6B4C9A", m1: "#7E6AA8", m2: "#3F3364", m3: "#1B2B45", seed: 13 },
  "technologie-03.svg": { sky1: "#E8EEF4", sky2: "#9FB3C8", m1: "#C9D6E3", m2: "#8AA0B7", m3: "#4A5A6D", seed: 17 },
  "technologie-04.svg": { sky1: "#10324A", sky2: "#2F8496", m1: "#4FA0B0", m2: "#1F5B6E", m3: "#0E2A3A", seed: 19 },
  "technologie-05.svg": { sky1: "#2A1F1C", sky2: "#A8492C", m1: "#C06A48", m2: "#6E3322", m3: "#2A1A16", seed: 23 },
  "technologie-06.svg": { sky1: "#1A2330", sky2: "#545E72", m1: "#7A8599", m2: "#3A4352", m3: "#1A2330", seed: 29 },
};

/* ------------------------------------------------------------------ */
/* ICO (conteneur PNG)                                                 */
/* ------------------------------------------------------------------ */
function pngToIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir.writeUInt8(size >= 256 ? 0 : size, 0);
  dir.writeUInt8(size >= 256 ? 0 : size, 1);
  dir.writeUInt8(0, 2);
  dir.writeUInt8(0, 3);
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(22, 12);
  return Buffer.concat([header, dir, png]);
}

/* ------------------------------------------------------------------ */
async function main() {
  let n = 0;
  // Icônes
  const icon = await fs.readFile(path.join(PUB, "brand/goggles-icone.svg"));
  for (const size of [32, 180, 192, 512]) {
    const png = await sharp(icon, { density: 300 }).resize(size, size).png().toBuffer();
    if (await write(path.join(PUB, `brand/goggles-icone-${size}.png`), png)) n++;
    if (size === 32 && (await write(path.join(ROOT, "app/favicon.ico"), pngToIco(png, 32)))) n++;
  }

  // Scènes
  for (const [file, cfg] of Object.entries(SCENES)) {
    if (await write(path.join(PUB, "scenes", file), Buffer.from(sceneSVG(cfg)))) n++;
  }

  // Produits
  const products = JSON.parse(await fs.readFile(path.join(ROOT, "data/products.json"), "utf8"));
  for (const p of products) {
    const dir = path.join(PUB, "products", p.slug);
    const tint = p.teinteVerre || "#7FD3FF";
    // Photo détourée (transparente) : 1600 x 1000
    const det = await sharp(Buffer.from(goggleSVG({ tint, w: 1600, h: 1000 }))).png({ compressionLevel: 9, palette: false }).toBuffer();
    if (await write(path.join(dir, "detoure.png"), det)) n++;
    // Galerie : 1600 x 1600
    const shots = [
      { deg: 0, zoom: 0.92 },
      { deg: 38, zoom: 0.92 },
      { deg: 180, zoom: 0.92 },
      { deg: 0, zoom: 1.9 },
    ];
    for (let i = 0; i < shots.length; i++) {
      const svg = goggleSVG({ tint, ...shots[i], w: 1600, h: 1600, bg: true, label: `PHOTO À VENIR · ${p.modele} · ${i + 1}/4` });
      const buf = await sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer();
      if (await write(path.join(dir, `photo-${i + 1}.webp`), buf)) n++;
    }
    // Séquence 360° : N images, fond transparent, 1200 x 750
    const N = p.sequence360?.images ?? 24;
    for (let i = 0; i < N; i++) {
      const svg = goggleSVG({ tint, deg: (360 / N) * i, w: 1200, h: 750 });
      const buf = await sharp(Buffer.from(svg)).webp({ quality: 80, alphaQuality: 90 }).toBuffer();
      if (await write(path.join(dir, "360", `${String(i + 1).padStart(2, "0")}.webp`), buf)) n++;
    }
  }
  console.log(`Assets : ${n} fichier(s) écrit(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
