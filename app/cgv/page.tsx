import type { Metadata } from "next";
import Link from "next/link";
import { PageClaire } from "@/components/pages/PageClaire";
import { Article, Avertissement } from "@/components/pages/Legal";
import { Footer } from "@/components/layout/Footer";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Conditions générales de vente", alternates: { canonical: "/cgv" } };

export default function Page() {
  return (
    <>
      <PageClaire surtitre="Informations légales" titre="CGV">
        <Avertissement />
        <p className="mb-10 text-sm text-ardoise">Version du [À REMPLIR : date].</p>
        <Article titre="1. Objet">
          <p>
            Les présentes conditions régissent les ventes de masques de ski conclues sur le site {SITE.nom} entre [À REMPLIR : raison sociale] (« le vendeur ») et
            tout acheteur (« le client »). Passer commande vaut acceptation des présentes conditions.
          </p>
        </Article>
        <Article titre="2. Produits">
          <p>
            Les produits sont des masques Red Bull SPECT <strong>authentiques</strong>, neufs ou d&apos;occasion. {SITE.mentionRevendeur}. Chaque fiche indique
            l&apos;état de la pièce (neuf avec étiquette, neuf sans boîte, très bon état, bon état) et ses caractéristiques. La facture d&apos;origine est disponible
            sur demande. Les photos sont celles des pièces réellement vendues ou de pièces identiques [À REMPLIR : préciser].
          </p>
        </Article>
        <Article titre="3. Prix">
          <p>
            Les prix sont indiqués en euros, toutes taxes comprises [À REMPLIR : ou « TVA non applicable, art. 293 B du CGI » / régime de la marge pour les biens
            d&apos;occasion — à vérifier]. Les frais de livraison sont indiqués avant la validation de la commande.
          </p>
        </Article>
        <Article titre="4. Commande et paiement">
          <p>
            La commande est validée après paiement sécurisé via [À REMPLIR : Shopify Payments, carte bancaire, PayPal…]. Un e-mail de confirmation est envoyé au
            client. Le vendeur peut refuser une commande en cas de litige antérieur ou d&apos;indisponibilité.
          </p>
        </Article>
        <Article titre="5. Livraison">
          <p>
            Livraison en France, dans l&apos;Union européenne et dans le reste du monde. Délais et tarifs : [À REMPLIR]. Pour les envois hors Union européenne, des
            droits de douane et taxes locales peuvent être dus par le client.
          </p>
        </Article>
        <Article titre="6. Droit de rétractation (14 jours)">
          <p>
            Conformément aux articles L.221-18 et suivants du Code de la consommation, le client consommateur dispose d&apos;un délai de <strong>14 jours</strong> à
            compter de la réception du produit pour exercer son droit de rétractation, sans avoir à se justifier.
          </p>
          <p>
            Pour l&apos;exercer, le client informe le vendeur par une déclaration dénuée d&apos;ambiguïté (e-mail à {SITE.email} ou{" "}
            <Link href="/contact" className="underline">
              formulaire de contact
            </Link>
            ), ou au moyen du formulaire type ci-dessous. Le produit est renvoyé au plus tard 14 jours après cette communication, dans son état d&apos;origine.
            Frais de retour : [À REMPLIR : à la charge du client / offerts].
          </p>
          <p>
            Le vendeur rembourse la totalité des sommes versées, frais de livraison initiaux inclus (sur la base du mode standard), dans un délai de 14 jours à
            compter de la réception de la demande, ce remboursement pouvant être différé jusqu&apos;à la récupération du produit.
          </p>
          <div className="rounded-2xl bg-white p-5 text-sm ring-1 ring-nuit/10">
            <p className="font-semibold text-nuit">Formulaire type de rétractation</p>
            <p className="mt-2">
              À l&apos;attention de [À REMPLIR : raison sociale, adresse, e-mail] : je vous notifie par la présente ma rétractation du contrat portant sur la vente
              du bien ci-dessous. Commandé le / reçu le : … Nom du client : … Adresse : … Signature (si envoi papier) : … Date : …
            </p>
          </div>
        </Article>
        <Article titre="7. Garanties légales">
          <p>
            Les produits bénéficient de la garantie légale de conformité (articles L.217-3 et suivants du Code de la consommation) et de la garantie des vices
            cachés (articles 1641 et suivants du Code civil). Pour les biens d&apos;occasion : [À REMPLIR : durée applicable — à vérifier].
          </p>
        </Article>
        <Article titre="8. Données personnelles">
          <p>
            Voir la{" "}
            <Link href="/confidentialite" className="underline">
              politique de confidentialité
            </Link>
            .
          </p>
        </Article>
        <Article titre="9. Litiges">
          <p>
            Les présentes conditions sont soumises au droit français. En cas de litige, une solution amiable est recherchée en priorité ; le client peut recourir
            au médiateur de la consommation indiqué dans les mentions légales.
          </p>
        </Article>
      </PageClaire>
      <Footer />
    </>
  );
}
