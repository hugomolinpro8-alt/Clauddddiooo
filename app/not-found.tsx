import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export default function NotFound() {
  return (
    <section className="grid min-h-svh place-items-center bg-nuit px-6 text-center text-white">
      <div>
        <Logo variant="fonce" symbolOnly className="mx-auto w-24" />
        <p className="label mt-8 text-glacier">Erreur 404</p>
        <h1 className="titre mt-3 text-6xl sm:text-8xl">Hors piste</h1>
        <p className="mt-4 text-glacier">Cette page n&apos;existe pas ou a été déplacée.</p>
        <Link href="/" className="btn btn-blanc mt-8">
          Retour à l&apos;accueil
        </Link>
      </div>
    </section>
  );
}
