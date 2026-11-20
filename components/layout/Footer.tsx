import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { NewsletterForm } from "@/components/ui/NewsletterForm";
import { RESEAUX, SITE } from "@/lib/config";

const LIENS = [
  { titre: "Boutique", liens: [["/collection", "Collection"], ["/technologie", "Technologie"], ["/favoris", "Favoris"], ["/faq", "FAQ"]] },
  { titre: "Informations", liens: [["/contact", "Contact"], ["/cgv", "CGV"], ["/mentions-legales", "Mentions légales"], ["/confidentialite", "Confidentialité"]] },
] as const;

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-nuit text-white" id="newsletter">
      <div className="mx-auto grid max-w-[1400px] gap-14 px-6 pb-10 pt-20 sm:px-10 lg:grid-cols-[1.3fr_1fr_1fr]">
        <div className="max-w-md">
          <p className="label text-glacier">Newsletter</p>
          <p className="titre mt-4 text-4xl sm:text-5xl">Premières traces, premiers servis.</p>
          <p className="mt-4 text-sm text-glacier">Recevez les nouvelles pièces avant tout le monde.</p>
          <div className="mt-6">
            <NewsletterForm />
          </div>
        </div>
        {LIENS.map((c) => (
          <nav key={c.titre} aria-label={c.titre}>
            <p className="label text-glacier">{c.titre}</p>
            <ul className="mt-5 space-y-3">
              {c.liens.map(([href, l]) => (
                <li key={href}>
                  <Link href={href} className="text-sm text-white/85 transition-colors hover:text-orange">
                    {l}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="mx-auto max-w-[1400px] px-6 sm:px-10">
        <Logo variant="fonce" className="w-full max-w-none opacity-[0.07]" title="GOGGLES" />
      </div>

      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 border-t border-white/10 px-6 py-6 text-[11px] text-glacier sm:flex-row sm:items-center sm:justify-between sm:px-10">
        <p>
          © {new Date().getFullYear()} {SITE.nom} — <strong className="font-semibold text-white">{SITE.mentionRevendeur}</strong>. Les marques citées
          appartiennent à leurs propriétaires respectifs.
        </p>
        <ul className="flex gap-4" aria-label="Réseaux sociaux">
          {RESEAUX.map((r) => (
            <li key={r.nom}>
              <a href={r.url} className="hover:text-white" target="_blank" rel="noreferrer">
                {r.nom}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  );
}
