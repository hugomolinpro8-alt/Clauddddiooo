import type { Metadata } from "next";
import { PageClaire } from "@/components/pages/PageClaire";
import { CommandeDemo } from "@/components/pages/CommandeDemo";

export const metadata: Metadata = { title: "Commande", robots: { index: false } };

export default function Page() {
  return (
    <PageClaire surtitre="Paiement" titre="Commande">
      <CommandeDemo />
    </PageClaire>
  );
}
