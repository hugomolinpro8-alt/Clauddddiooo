/* Extraction du texte des fichiers importés. Les PDF scannés et les photos passent par la vision de Claude. */
import { transcribeImages } from "./ai/tasks";
import { getImageLimits } from "./runtime";

export interface Extracted {
  text: string;
  pages?: number;
  method: "texte" | "pdf-texte" | "vision";
}

let pdfjsPromise: Promise<any> | null = null;
async function pdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const lib: any = await import("pdfjs-dist/legacy/build/pdf.js");
      const workerCode: string = (await import("pdfjs-dist/legacy/build/pdf.worker.min.js?raw")).default;
      const url = URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" }));
      (lib.GlobalWorkerOptions ?? lib.default?.GlobalWorkerOptions).workerSrc = url;
      return lib.getDocument ? lib : lib.default;
    })();
  }
  return pdfjsPromise;
}

async function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/jpeg", 0.85));
}

/** Réduit une image (photo de téléphone) pour respecter les limites d'envoi. */
export async function shrinkImage(file: Blob, maxSide = 2000): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 3_000_000 && /jpe?g|png/.test(file.type)) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    return await canvasToBlob(c);
  } catch {
    return file;
  }
}

export async function extractFile(file: File, role: string, onProgress?: (msg: string) => void): Promise<Extracted> {
  const name = file.name.toLowerCase();
  if (file.type.startsWith("text/") || /\.(txt|md|markdown|tex)$/.test(name)) {
    return { text: await file.text(), method: "texte" };
  }
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    onProgress?.("Lecture du PDF…");
    const lib = await pdfjs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const out: string[] = [];
      let lastY: number | null = null;
      for (const it of content.items as any[]) {
        const y = it.transform?.[5];
        if (lastY != null && Math.abs(y - lastY) > 4) { out.push(line); line = ""; }
        line += it.str + (it.hasEOL ? "\n" : "");
        lastY = y;
      }
      out.push(line);
      pages.push(`\n[Page ${i}]\n` + out.join("\n").replace(/\n{3,}/g, "\n\n"));
    }
    const text = pages.join("\n");
    const avg = text.replace(/\s|\[Page \d+\]/g, "").length / Math.max(1, doc.numPages);
    if (avg >= 150) return { text, pages: doc.numPages, method: "pdf-texte" };

    // PDF scanné : rendu des pages en images, transcription par Claude.
    const limits = await getImageLimits();
    if (!limits) throw new Error("Ce PDF est scanné (pas de texte) et l'envoi d'images à Claude n'est pas disponible ici. Ouvre l'app sur claude.ai.");
    const maxPages = Math.min(doc.numPages, 30);
    const images: Blob[] = [];
    for (let i = 1; i <= maxPages; i++) {
      onProgress?.(`Rendu de la page ${i}/${maxPages}…`);
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1.6 });
      const c = document.createElement("canvas");
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise;
      images.push(await canvasToBlob(c));
    }
    const chunks: string[] = [];
    const per = Math.max(1, Math.min(limits.maxCount, 8));
    for (let i = 0; i < images.length; i += per) {
      onProgress?.(`Transcription par Claude : pages ${i + 1}-${Math.min(images.length, i + per)}…`);
      const r = await transcribeImages(images.slice(i, i + per), `${role}, pages ${i + 1} à ${Math.min(images.length, i + per)} d'un PDF scanné`);
      chunks.push(r.markdown);
    }
    const note = doc.numPages > maxPages ? `\n\n_(Seules les ${maxPages} premières pages ont été transcrites.)_` : "";
    return { text: chunks.join("\n\n") + note, pages: doc.numPages, method: "vision" };
  }
  if (file.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|gif)$/.test(name)) {
    const limits = await getImageLimits();
    onProgress?.("Transcription de la photo par Claude…");
    if (!limits) {
      const { aiAvailable } = await import("./ai/client");
      if (await aiAvailable()) throw new Error("L'envoi d'images à Claude n'est pas disponible ici.");
    }
    const img = await shrinkImage(file);
    const r = await transcribeImages([img], `photo de ${role}`);
    return { text: r.markdown, method: "vision" };
  }
  throw new Error(`Format non pris en charge : ${file.name}. Utilise PDF, image, .txt ou .md.`);
}
