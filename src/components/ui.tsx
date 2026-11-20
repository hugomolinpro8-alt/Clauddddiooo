import React from "react";

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; loading?: boolean };
export function Button({ variant = "primary", size = "md", loading, className = "", children, disabled, ...rest }: BtnProps) {
  const base = "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed select-none";
  const sz = size === "sm" ? "text-sm px-3 py-1.5" : "text-[15px] px-4 py-2.5";
  const v = {
    primary: "bg-accent text-accent-ink hover:opacity-90",
    secondary: "bg-surface text-ink border border-line hover:bg-sunken",
    ghost: "text-ink hover:bg-sunken",
    danger: "bg-surface text-bad border border-line hover:bg-sunken",
  }[variant];
  return (
    <button className={`${base} ${sz} ${v} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent animate-spin ${className}`} aria-hidden />;
}

export function Card({ className = "", children, ...rest }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-xl border border-line bg-surface p-4 sm:p-5 min-w-0 ${className}`} {...rest}>{children}</div>;
}

export function Badge({ tone = "neutral", children, className = "" }: { tone?: "neutral" | "accent" | "ok" | "warn" | "bad" | "pen"; children: React.ReactNode; className?: string }) {
  const t = {
    neutral: "bg-sunken text-muted",
    accent: "bg-accent/15 text-accent",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    bad: "bg-bad/15 text-bad",
    pen: "bg-pen/10 text-pen",
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${t} ${className}`}>{children}</span>;
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="flex flex-col gap-1 min-w-0" htmlFor={htmlFor}>
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

const inputCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:outline-none focus:border-accent";
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className = "", ...p }, ref) {
  return <input ref={ref} className={`${inputCls} ${className}`} {...p} />;
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = "", ...p }, ref) {
  return <textarea ref={ref} className={`${inputCls} ${className}`} {...p} />;
});
export function Select({ className = "", ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${inputCls} ${className}`} {...p} />;
}

export function ErrorBox({ error, onRetry }: { error: string | null | undefined; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad flex flex-wrap items-center gap-3">
      <span className="min-w-0 flex-1">{error}</span>
      {onRetry && <Button size="sm" variant="secondary" onClick={onRetry}>Réessayer</Button>}
    </div>
  );
}

export function Bar({ value, max = 100, tone = "accent", className = "" }: { value: number; max?: number; tone?: "accent" | "ok" | "warn" | "bad"; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bg = { accent: "bg-accent", ok: "bg-ok", warn: "bg-warn", bad: "bg-bad" }[tone];
  return (
    <div className={`h-2 w-full rounded-full bg-sunken overflow-hidden ${className}`}>
      <div className={`h-full rounded-full ${bg}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function masteryTone(m: number): "ok" | "warn" | "bad" {
  return m >= 70 ? "ok" : m >= 45 ? "warn" : "bad";
}

export function Grade({ value, outOf = 20, className = "" }: { value: number | string; outOf?: number; className?: string }) {
  return (
    <span className={`grade-ring tnum ${className}`}>
      <span>{typeof value === "number" ? value.toFixed(1).replace(".", ",") : value}</span>
      <span className="text-[0.6em] opacity-80">/{outOf}</span>
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line p-6 text-center flex flex-col items-center gap-3">
      <p className="font-display text-lg font-semibold">{title}</p>
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, id }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; id?: string }) {
  return (
    <div id={id} role="radiogroup" className="inline-flex flex-wrap rounded-lg border border-line bg-sunken p-0.5 gap-0.5">
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm rounded-md tnum ${o.value === value ? "bg-surface text-ink shadow-sm font-medium" : "text-muted hover:text-ink"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
