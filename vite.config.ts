import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Ne garder que les polices KaTeX en woff2 (tous les navigateurs actuels) : page 3× plus légère.
const katexWoff2Only = (): Plugin => ({
  name: "katex-woff2-only",
  enforce: "pre",
  transform(code, id) {
    if (!id.includes("katex") || !id.endsWith(".css")) return;
    return code
      .replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g, "")
      .replace(/,\s*url\([^)]*\.ttf\)\s*format\(["']truetype["']\)/g, "");
  },
});

export default defineConfig({
  plugins: [katexWoff2Only(), react(), viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 },
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
} as any);
