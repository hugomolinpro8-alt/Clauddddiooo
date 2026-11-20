import { useMemo } from "react";
import katex from "katex";
import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ breaks: true, gfm: true });

/** Markdown + LaTeX ($…$, $$…$$, \(…\), \[…\]) rendu proprement et assaini. */
export function renderMath(src: string): string {
  const maths: string[] = [];
  const hold = (tex: string, display: boolean) => {
    let html: string;
    try {
      html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, strict: "ignore", output: "html" });
    } catch {
      html = `<code>${tex.replace(/</g, "&lt;")}</code>`;
    }
    maths.push(html);
    return `KTXPH${maths.length - 1}KTX`;
  };
  let s = src ?? "";
  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, t) => hold(t, true));
  s = s.replace(/\\\[([\s\S]+?)\\\]/g, (_, t) => hold(t, true));
  s = s.replace(/\\\(([\s\S]+?)\\\)/g, (_, t) => hold(t, false));
  s = s.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, t) => pre + hold(t, false));
  const html = DOMPurify.sanitize(marked.parse(s, { async: false }) as string);
  return html.replace(/KTXPH(\d+)KTX/g, (_, i) => maths[Number(i)]);
}

export function MathText({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => renderMath(text), [text]);
  return <div className={`prose-math ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathInline({ text }: { text: string }) {
  const html = useMemo(() => renderMath(text).replace(/^<p>|<\/p>\s*$/g, ""), [text]);
  return <span className="prose-math" dangerouslySetInnerHTML={{ __html: html }} />;
}
