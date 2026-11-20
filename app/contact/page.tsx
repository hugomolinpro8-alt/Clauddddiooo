import type { Metadata } from "next";
import { PageClaire } from "@/components/pages/PageClaire";
import { ContactForm } from "@/components/pages/ContactForm";
import { Footer } from "@/components/layout/Footer";
import { SITE } from "@/lib/config";

export const metadata: Metadata = { title: "Contact", description: "Une question sur un masque, son état ou son authenticité ? Écrivez-nous.", alternates: { canonical: "/contact" } };

export default function Page() {
  return (
    <>
      <PageClaire surtitre="Une question ?" titre="Contact">
        <p className="mb-10 max-w-xl text-ardoise">
          Une question sur un masque, son état ou son authenticité ? Écrivez-nous, réponse sous [À REMPLIR] h. E-mail : {SITE.email}
        </p>
        <ContactForm />
      </PageClaire>
      <Footer />
    </>
  );
}
