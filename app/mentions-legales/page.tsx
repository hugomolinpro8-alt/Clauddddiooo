import type { Metadata } from "next";
import { PageClaire } from "@/components/pages/PageClaire";
import { Article, Avertissement } from "@/components/pages/Legal";
import { Footer } from "@/components/layout/Footer";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Mentions légales", alternates: { canonical: "/mentions-legales" } };

export default function Page() {
  return (
    <>
      <PageClaire surtitre="Informations légales" titre="Mentions légales">
        <Avertissement />
        <Article titre="Éditeur du site">
          <p>
            Le site {SITE.nom} est édité par <strong>[À REMPLIR : nom ou raison sociale]</strong>, [À REMPLIR : forme juridique — ex. entrepreneur individuel,
            SAS…], au capital de [À REMPLIR] €.
          </p>
          <p>Siège : [À REMPLIR : adresse complète]. SIREN / SIRET : [À REMPLIR]. RCS / RNE : [À REMPLIR]. TVA intracommunautaire : [À REMPLIR].</p>
          <p>Contact : {SITE.email} — Téléphone : [À REMPLIR].</p>
          <p>Directeur ou directrice de la publication : [À REMPLIR].</p>
        </Article>
        <Article titre="Hébergement">
          <p>Le site est hébergé par [À REMPLIR : ex. Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis — à vérifier].</p>
          <p>Le paiement et la commande sont opérés par [À REMPLIR : ex. Shopify International Limited — à vérifier].</p>
        </Article>
        <Article titre="Activité et marques">
          <p>
            {SITE.nom} est un <strong>revendeur indépendant</strong> de masques de ski neufs et d&apos;occasion. {SITE.nom} n&apos;est ni affilié à Red Bull, ni
            sponsorisé, ni approuvé par Red Bull. Les marques Red Bull et SPECT ainsi que les noms de modèles appartiennent à leurs titulaires respectifs et ne sont
            cités que pour désigner les produits revendus.
          </p>
          <p>Les photos des produits sont réalisées par {SITE.nom}. Aucune image officielle de la marque n&apos;est utilisée.</p>
        </Article>
        <Article titre="Propriété intellectuelle">
          <p>
            Le nom {SITE.nom}, le logo, la charte graphique, les textes et les photographies du site sont protégés. Toute reproduction sans autorisation écrite est
            interdite.
          </p>
        </Article>
        <Article titre="Médiation de la consommation">
          <p>
            Conformément aux articles L.611-1 et suivants du Code de la consommation, vous pouvez recourir gratuitement au médiateur : [À REMPLIR : nom, adresse et
            site du médiateur].
          </p>
        </Article>
      </PageClaire>
      <Footer />
    </>
  );
}
