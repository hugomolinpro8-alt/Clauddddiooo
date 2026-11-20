import type { Metadata } from "next";
import Link from "next/link";
import { PageClaire } from "@/components/pages/PageClaire";
import { Accordeon } from "@/components/ui/Accordeon";
import { Footer } from "@/components/layout/Footer";
import { FAQ } from "@/lib/contenu";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Authenticité, état, livraison, retours, entretien : les réponses à vos questions.",
  alternates: { canonical: "/faq" },
};

export default function Page() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.r } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <PageClaire surtitre="Questions fréquentes" titre="FAQ">
        <div className="border-t border-nuit/10">
          {FAQ.map((f, i) => (
            <Accordeon key={f.q} titre={f.q} ouvertParDefaut={i === 0}>
              {f.r}
            </Accordeon>
          ))}
        </div>
        <p className="mt-10 text-ardoise">
          Pas trouvé votre réponse ?{" "}
          <Link href="/contact" className="font-semibold text-nuit underline underline-offset-4">
            Contactez-nous
          </Link>
          .
        </p>
      </PageClaire>
      <Footer />
    </>
  );
}
