import type { Metadata } from "next";
import { PageClaire } from "@/components/pages/PageClaire";
import { Article, Avertissement, BoutonCookies } from "@/components/pages/Legal";
import { Footer } from "@/components/layout/Footer";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Politique de confidentialité", alternates: { canonical: "/confidentialite" } };

export default function Page() {
  return (
    <>
      <PageClaire surtitre="Informations légales" titre="Confidentialité">
        <Avertissement />
        <Article titre="Responsable du traitement">
          <p>[À REMPLIR : raison sociale, adresse], joignable à {SITE.email}.</p>
        </Article>
        <Article titre="Données collectées et finalités">
          <p>
            <strong>Commande</strong> : identité, adresses, e-mail, téléphone, historique d&apos;achat — exécution du contrat (livraison, facturation, service
            client).
          </p>
          <p>
            <strong>Newsletter</strong> : e-mail — sur la base de votre consentement, retirable à tout moment via le lien de désinscription.
          </p>
          <p>
            <strong>Contact</strong> : nom, e-mail, message — répondre à vos demandes.
          </p>
          <p>
            <strong>Navigation</strong> : panier et favoris sont enregistrés dans votre navigateur (stockage local), sans transmission à des tiers.
          </p>
        </Article>
        <Article titre="Destinataires">
          <p>[À REMPLIR : Shopify (commande et paiement), hébergeur, transporteurs, outil d&apos;e-mailing…]. Aucune donnée n&apos;est vendue.</p>
        </Article>
        <Article titre="Durées de conservation">
          <p>[À REMPLIR : ex. données clients 3 ans après le dernier achat ; pièces comptables 10 ans ; prospects 3 ans après le dernier contact].</p>
        </Article>
        <Article titre="Vos droits">
          <p>
            Vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement, de limitation, d&apos;opposition et de portabilité. Écrivez à {SITE.email}.
            Vous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr).
          </p>
        </Article>
        <Article titre="Cookies">
          <p>
            Seuls les cookies et stockages nécessaires (panier, favoris, choix de consentement) sont utilisés par défaut. Aucun traceur de mesure d&apos;audience ou
            de marketing n&apos;est déposé sans votre accord. Refuser est aussi simple qu&apos;accepter, et vous pouvez changer d&apos;avis à tout moment.
          </p>
          <BoutonCookies />
        </Article>
      </PageClaire>
      <Footer />
    </>
  );
}
