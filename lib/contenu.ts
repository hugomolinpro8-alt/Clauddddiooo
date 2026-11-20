/** Contenus éditoriaux — tout texte [À REMPLIR] est à compléter (voir TODO.md). */

/** Scènes de fond : remplacez les fichiers dans /public/scenes/ (tailles dans /public/scenes/README.md) */
export const SCENES = {
  intro: "/scenes/intro.svg",
  carrousel: "/scenes/carrousel.svg",
};

export const CITATION = {
  texte: "[À REMPLIR] Une phrase d'ouverture qui raconte pourquoi un bon masque change une journée en montagne.",
  signature: "[À REMPLIR] Prénom Nom, fondateur de GOGGLES",
};

export const ETAPES = [
  { num: "01", titre: "Écran", scene: "/scenes/technologie-01.svg", texte: "[À REMPLIR] Forme, champ de vision et fabrication de l'écran. Décrivez ici ce que le masque apporte, sans inventer de chiffre." },
  { num: "02", titre: "Verre", scene: "/scenes/technologie-02.svg", texte: "[À REMPLIR] Traitement du verre, contraste, catégories S1 à S4 et usages selon la météo." },
  { num: "03", titre: "Anti-buée", scene: "/scenes/technologie-03.svg", texte: "[À REMPLIR] Traitement anti-buée et conseils pour garder une vision claire toute la journée." },
  { num: "04", titre: "Ventilation", scene: "/scenes/technologie-04.svg", texte: "[À REMPLIR] Circulation de l'air, aérations de la monture et confort à l'effort." },
  { num: "05", titre: "Mousse et confort", scene: "/scenes/technologie-05.svg", texte: "[À REMPLIR] Couches de mousse, contact avec le visage, maintien et confort sur la durée." },
  { num: "06", titre: "Sangle et compatibilité casque", scene: "/scenes/technologie-06.svg", texte: "[À REMPLIR] Réglage de la sangle, silicone antiglisse et compatibilité avec les casques." },
];

export const ARGUMENTS = ["[À REMPLIR] Argument 1", "[À REMPLIR] Argument 2", "[À REMPLIR] Argument 3"];

export const FAQ = [
  {
    q: "Les masques sont-ils authentiques ?",
    r: "Oui. Chaque masque est un masque Red Bull SPECT authentique, vérifié avant la mise en vente. La facture d'origine est disponible. [À REMPLIR : précisez votre processus de vérification]",
  },
  {
    q: "Comment l'état est-il évalué ?",
    r: "Chaque pièce porte un état : neuf avec étiquette, neuf sans boîte, très bon état ou bon état. [À REMPLIR : définissez précisément chaque état et les défauts possibles]",
  },
  { q: "Où livrez-vous et en combien de temps ?", r: "Nous livrons en France, dans l'Union européenne et dans le reste du monde. [À REMPLIR : transporteurs, délais et tarifs]" },
  {
    q: "Puis-je retourner un masque ?",
    r: "Vous disposez de 14 jours à compter de la réception pour exercer votre droit de rétractation. [À REMPLIR : conditions de retour, frais, état exigé]",
  },
  { q: "Comment entretenir mon masque ?", r: "[À REMPLIR] Conseils de nettoyage du verre et de la mousse, séchage et rangement dans la housse." },
  { q: "Êtes-vous liés à Red Bull ?", r: "Non. GOGGLES est un revendeur indépendant, non affilié à Red Bull." },
];
