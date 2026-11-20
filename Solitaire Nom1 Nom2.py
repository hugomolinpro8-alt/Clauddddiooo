"""
Solitaire (Klondike) en mode texte - Projet L1 Eco-Miashs.

Écrit avec les notions du cours : listes, tuples, chaînes, if / elif / else,
for / while, fonctions et procédures, variables globales, récursivité.
Aucune classe. Aucun dictionnaire : tout est rangé dans des listes, accessibles
par des indices nommés (E_PIOCHE, CACHEES, ...), qui sont des variables globales
(Python n'a pas de constantes : on les écrit en MAJUSCULES et on ne les modifie jamais).

Modules utilisés (tous de la bibliothèque standard de Python)
-------------------------------------------------------------
random : mélanger le paquet (random.shuffle) et varier l'ordre de recherche de l'ordinateur
json   : sauvegarder / reprendre une partie (json.dump, json.load)
os     : tester si la sauvegarde existe (os.path.exists) et activer les couleurs
         ANSI sous Windows (os.system)

Structures de données
---------------------
carte      : tuple (valeur, couleur). valeur de 1 (As) à 13 (Roi).
             couleur = numéro 0 (♥), 1 (♦), 2 (♣), 3 (♠). Rouge si couleur < 2.
colonne    : liste [cachees, visibles] (deux listes de cartes).
             visibles va de la plus grande carte (bas) à la plus petite (dessus).
etat       : liste [pioche, defausse, colonnes, fondations, parametres,
                    coups, recyclages_faits, annulations_utilisees]
             (le dessus de la pioche, de la défausse et des piles = dernier élément)
fondations : liste de 4 piles (une par couleur, dans l'ordre de SYMBOLES).
parametres : liste [nb_pioche, recyclages, annulations, aide]
"""

import random
import json
import os

# ----------------------------------------------------------------------
# Variables globales (utilisées comme des constantes)
# ----------------------------------------------------------------------
SYMBOLES = ["♥", "♦", "♣", "♠"]
NB_COLONNES = 7
FICHIER_SAUVEGARDE = "solitaire_sauvegarde.json"
UTILISER_COULEURS = True      # mettre False si le terminal n'affiche pas les couleurs
LARGEUR_CASE = 5
CACHEE = "##" + " " * (LARGEUR_CASE - 2)
VIDE = " " * LARGEUR_CASE

# Indices dans la liste etat
E_PIOCHE = 0
E_DEFAUSSE = 1
E_COLONNES = 2
E_FONDATIONS = 3
E_PARAM = 4
E_COUPS = 5
E_RECYCLES = 6
E_ANNULES = 7

# Indices dans une colonne
CACHEES = 0
VISIBLES = 1

# Indices dans la liste des paramètres
P_PIOCHE = 0        # nombre de cartes retournées à chaque pioche (1 ou 3)
P_RECYCLAGES = 1    # nombre de recyclages de la défausse (None = illimité)
P_ANNULATIONS = 2   # nombre d'annulations autorisées (None = illimité, 0 = aucune)
P_AIDE = 3          # True : l'aide (a) et l'ordinateur (j) sont actifs

# Niveaux : (nom, [nb_pioche, recyclages, annulations, aide])
NIVEAUX = [
    ("Facile", [1, None, None, True]),
    ("Moyen", [1, 3, 5, True]),
    ("Difficile", [3, 2, 0, False]),
]

# Réglages de la recherche de l'ordinateur
ESSAIS = 6            # nombre de recherches avec des ordres différents
LIMITE_NOEUDS = 4000  # nombre maximal de plateaux explorés par recherche
PROFONDEUR_MAX = 600  # profondeur maximale de la récursivité
NOEUDS = 0            # compteur de plateaux explorés (modifié avec global)


# ----------------------------------------------------------------------
# Petits sous-programmes sur les chaînes
# ----------------------------------------------------------------------
def decouper(texte):
    """FONCTION : découpe un texte en mots (séparés par des espaces), en minuscules."""
    mots = []
    mot = ""
    for c in texte.lower():
        if c == " ":
            if mot != "":
                mots.append(mot)
                mot = ""
        else:
            mot = mot + c
    if mot != "":
        mots.append(mot)
    return mots


def est_nombre(texte):
    """FONCTION : vrai si le texte est uniquement composé de chiffres 0 à 9."""
    if texte == "":
        return False
    for c in texte:
        if c not in "0123456789":
            return False
    return True


# ----------------------------------------------------------------------
# Cartes et affichage
# ----------------------------------------------------------------------
def nom_valeur(valeur):
    """FONCTION : 1 -> "A", 11 -> "V", 12 -> "D", 13 -> "R", sinon le nombre."""
    if valeur == 1:
        return "A"
    elif valeur == 11:
        return "V"
    elif valeur == 12:
        return "D"
    elif valeur == 13:
        return "R"
    else:
        return str(valeur)


def texte_carte(carte):
    """FONCTION : (12, 0) devient "D♥"."""
    return nom_valeur(carte[0]) + SYMBOLES[carte[1]]


def est_rouge(carte):
    """FONCTION : les coeurs (0) et les carreaux (1) sont rouges."""
    return carte[1] < 2


def colorer(texte, carte):
    """FONCTION : met le texte en rouge (code ANSI) pour les cartes rouges."""
    if UTILISER_COULEURS and est_rouge(carte):
        return "\033[31m" + texte + "\033[0m"
    return texte


def cellule(carte):
    """FONCTION : texte coloré d'une carte, complété par des espaces pour l'alignement."""
    texte = texte_carte(carte)
    return colorer(texte, carte) + " " * (LARGEUR_CASE - len(texte))


def afficher(etat):
    """PROCEDURE : affiche tout le plateau."""
    print("\n" + "=" * 46)

    # Pioche et défausse (avec le nombre de cartes de chacune)
    if len(etat[E_PIOCHE]) > 0:
        pioche = "[##] x" + str(len(etat[E_PIOCHE]))
    else:
        pioche = "[  ] vide"
    if len(etat[E_DEFAUSSE]) > 0:
        dessus = etat[E_DEFAUSSE][-1]
        defausse = colorer(texte_carte(dessus), dessus) + " x" + str(len(etat[E_DEFAUSSE]))
    else:
        defausse = "vide"
    print("Pioche :", pioche, "    Défausse :", defausse)

    # Fondations, numérotées F1 à F4 (pour la commande r)
    ligne = "Fondations :"
    for f in range(4):
        pile = etat[E_FONDATIONS][f]
        if len(pile) > 0:
            texte = colorer(texte_carte(pile[-1]), pile[-1])
        else:
            texte = colorer(SYMBOLES[f] + "-", (0, f))
        ligne = ligne + "   F" + str(f + 1) + ":" + texte
    print(ligne)

    # Colonnes, ligne par ligne
    print()
    entete = ""
    for i in range(NB_COLONNES):
        nom = "C" + str(i + 1)
        entete = entete + nom + " " * (LARGEUR_CASE - len(nom))
    print(entete)
    hauteur = 1
    for col in etat[E_COLONNES]:
        taille = len(col[CACHEES]) + len(col[VISIBLES])
        if taille > hauteur:
            hauteur = taille
    for ligne_n in range(hauteur):
        texte = ""
        for col in etat[E_COLONNES]:
            nb_cachees = len(col[CACHEES])
            if ligne_n < nb_cachees:
                texte = texte + CACHEE
            elif ligne_n < nb_cachees + len(col[VISIBLES]):
                texte = texte + cellule(col[VISIBLES][ligne_n - nb_cachees])
            elif ligne_n == 0:
                texte = texte + "[ ]" + " " * (LARGEUR_CASE - 3)
            else:
                texte = texte + VIDE
        print(texte)
    print("\nCoups joués :", etat[E_COUPS])


def afficher_commandes():
    """PROCEDURE : affiche la liste des commandes et les règles."""
    print("""
COMMANDES
  p              piocher (ou retourner la défausse quand la pioche est vide)
  d <n>          défausse -> colonne n          ex. : d 3
  d f            défausse -> fondation
  f <n>          colonne n -> fondation         ex. : f 5
  r <f> <n>      fondation f -> colonne n       ex. : r 1 4
                 (f = 1:♥  2:♦  3:♣  4:♠, voir F1 à F4 à l'écran)
  c <a> <b> [k]  colonne a -> colonne b         ex. : c 2 6   ou   c 2 6 3
                 (k = nombre de cartes ; sans k, l'ordinateur le devine)
  a              aide : liste des coups possibles et conseil
  j [k]          l'ordinateur joue à ta place (k coups, ou jusqu'au bout)
  u              annuler le dernier coup
  s              sauvegarder la partie
  q              quitter
  ?              afficher cette aide

RÈGLES
  - Une colonne se construit en ordre décroissant, couleurs alternées
    (rouge/noir) : on pose une Dame noire sur un Roi rouge.
  - Seul un Roi peut être posé sur une colonne vide.
  - Une fondation se construit par couleur, de l'As (A) au Roi (R).
  - On peut redescendre la carte du dessus d'une fondation sur une colonne.
  - On gagne quand les 52 cartes sont dans les fondations.""")


# ----------------------------------------------------------------------
# Création d'une partie
# ----------------------------------------------------------------------
def creer_paquet():
    """FONCTION : liste des 52 cartes (valeur, couleur)."""
    paquet = []
    for couleur in range(4):
        for valeur in range(1, 14):
            paquet.append((valeur, couleur))
    return paquet


def nouvelle_partie(parametres):
    """FONCTION : mélange le paquet, distribue les colonnes et renvoie l'état."""
    paquet = creer_paquet()
    random.shuffle(paquet)
    colonnes = []
    for i in range(NB_COLONNES):
        cachees = []
        for j in range(i):
            cachees.append(paquet.pop())
        visibles = [paquet.pop()]
        colonnes.append([cachees, visibles])
    return [paquet, [], colonnes, [[], [], [], []], parametres, 0, 0, 0]


def partie_gagnee(etat):
    """FONCTION : vrai si les 52 cartes sont dans les fondations."""
    total = 0
    for pile in etat[E_FONDATIONS]:
        total = total + len(pile)
    return total == 52


def copier_etat(etat):
    """FONCTION : copie indépendante de l'état (sert à l'annulation et à la recherche)."""
    colonnes = []
    for col in etat[E_COLONNES]:
        colonnes.append([col[CACHEES][:], col[VISIBLES][:]])
    fondations = []
    for pile in etat[E_FONDATIONS]:
        fondations.append(pile[:])
    return [etat[E_PIOCHE][:], etat[E_DEFAUSSE][:], colonnes, fondations,
            etat[E_PARAM], etat[E_COUPS], etat[E_RECYCLES], etat[E_ANNULES]]


# ----------------------------------------------------------------------
# Règles du jeu
# ----------------------------------------------------------------------
def peut_sur_fondation(etat, carte):
    """FONCTION : la carte est la suivante de sa fondation (l'As pour une fondation vide)."""
    return carte[0] == len(etat[E_FONDATIONS][carte[1]]) + 1


def peut_sur_colonne(col, carte):
    """FONCTION : couleur opposée et valeur - 1 ; sur colonne vide, seulement un Roi."""
    if len(col[VISIBLES]) > 0:
        dessus = col[VISIBLES][-1]
        return est_rouge(dessus) != est_rouge(carte) and carte[0] == dessus[0] - 1
    return carte[0] == 13 and len(col[CACHEES]) == 0


def retourner_dessus(col):
    """PROCEDURE : retourne la carte cachée du dessus si plus aucune carte n'est visible."""
    if len(col[VISIBLES]) == 0 and len(col[CACHEES]) > 0:
        col[VISIBLES].append(col[CACHEES].pop())


def recyclage_possible(etat):
    """FONCTION : vrai si on peut encore retourner la défausse."""
    limite = etat[E_PARAM][P_RECYCLAGES]
    return limite is None or etat[E_RECYCLES] < limite


def trouver_nb_cartes(etat, src, dst):
    """FONCTION : nombre de cartes à déplacer de la colonne src vers dst (None si impossible)."""
    source = etat[E_COLONNES][src]
    dest = etat[E_COLONNES][dst]
    for k in range(1, len(source[VISIBLES]) + 1):
        carte = source[VISIBLES][-k]
        if peut_sur_colonne(dest, carte):
            if carte[0] == 13 and k == len(source[VISIBLES]) and len(source[CACHEES]) == 0:
                return None   # déplacer un Roi déjà tout en bas ne sert à rien
            return k
    return None


# ----------------------------------------------------------------------
# Déplacements : chaque fonction renvoie un tuple (réussi, message)
# ----------------------------------------------------------------------
def piocher(etat):
    message = "Vous piochez."
    if len(etat[E_PIOCHE]) == 0:
        if len(etat[E_DEFAUSSE]) == 0:
            return (False, "Il n'y a plus aucune carte à piocher.")
        if not recyclage_possible(etat):
            return (False, "Vous avez épuisé vos recyclages de la pioche.")
        # La défausse est retournée (slicing avec un pas de -1) pour reformer la pioche
        etat[E_PIOCHE] = etat[E_DEFAUSSE][::-1]
        etat[E_DEFAUSSE] = []
        etat[E_RECYCLES] = etat[E_RECYCLES] + 1
        message = "La pioche était vide : la défausse est retournée, puis vous piochez."
    nb = etat[E_PARAM][P_PIOCHE]
    if len(etat[E_PIOCHE]) < nb:
        nb = len(etat[E_PIOCHE])
    for i in range(nb):
        etat[E_DEFAUSSE].append(etat[E_PIOCHE].pop())
    return (True, message)


def defausse_vers_colonne(etat, i):
    if len(etat[E_DEFAUSSE]) == 0:
        return (False, "La défausse est vide.")
    carte = etat[E_DEFAUSSE][-1]
    if not peut_sur_colonne(etat[E_COLONNES][i], carte):
        return (False, "Interdit : " + texte_carte(carte) + " ne peut pas aller sur la colonne " + str(i + 1) + ".")
    etat[E_COLONNES][i][VISIBLES].append(etat[E_DEFAUSSE].pop())
    return (True, texte_carte(carte) + " posé sur la colonne " + str(i + 1) + ".")


def defausse_vers_fondation(etat):
    if len(etat[E_DEFAUSSE]) == 0:
        return (False, "La défausse est vide.")
    carte = etat[E_DEFAUSSE][-1]
    if not peut_sur_fondation(etat, carte):
        return (False, "Interdit : " + texte_carte(carte) + " ne peut pas aller sur sa fondation.")
    etat[E_FONDATIONS][carte[1]].append(etat[E_DEFAUSSE].pop())
    return (True, texte_carte(carte) + " monte sur la fondation.")


def colonne_vers_fondation(etat, i):
    col = etat[E_COLONNES][i]
    if len(col[VISIBLES]) == 0:
        return (False, "La colonne " + str(i + 1) + " est vide.")
    carte = col[VISIBLES][-1]
    if not peut_sur_fondation(etat, carte):
        return (False, "Interdit : " + texte_carte(carte) + " ne peut pas aller sur sa fondation.")
    etat[E_FONDATIONS][carte[1]].append(col[VISIBLES].pop())
    retourner_dessus(col)
    return (True, texte_carte(carte) + " monte sur la fondation.")


def fondation_vers_colonne(etat, f, i):
    """Redescend la carte du dessus de la fondation f (0 à 3) sur la colonne i."""
    pile = etat[E_FONDATIONS][f]
    if len(pile) == 0:
        return (False, "La fondation " + str(f + 1) + " (" + SYMBOLES[f] + ") est vide.")
    carte = pile[-1]
    if not peut_sur_colonne(etat[E_COLONNES][i], carte):
        return (False, "Interdit : " + texte_carte(carte) + " ne peut pas aller sur la colonne " + str(i + 1) + ".")
    etat[E_COLONNES][i][VISIBLES].append(pile.pop())
    return (True, texte_carte(carte) + " redescend de la fondation sur la colonne " + str(i + 1) + ".")


def colonne_vers_colonne(etat, src, dst, n):
    """Déplace n cartes visibles de src vers dst (n = None : l'ordinateur le devine)."""
    if src == dst:
        return (False, "La source et la destination sont identiques.")
    source = etat[E_COLONNES][src]
    dest = etat[E_COLONNES][dst]
    if len(source[VISIBLES]) == 0:
        return (False, "La colonne " + str(src + 1) + " est vide.")
    if n is None:
        n = trouver_nb_cartes(etat, src, dst)
        if n is None:
            return (False, "Interdit : aucune carte de la colonne " + str(src + 1)
                    + " ne peut aller sur la colonne " + str(dst + 1) + ".")
    elif n < 1 or n > len(source[VISIBLES]) or not peut_sur_colonne(dest, source[VISIBLES][-n]):
        return (False, "Interdit : ce déplacement de " + str(n) + " carte(s) n'est pas possible.")
    taille = len(source[VISIBLES])
    groupe = source[VISIBLES][taille - n:]
    source[VISIBLES] = source[VISIBLES][:taille - n]
    dest[VISIBLES].extend(groupe)
    retourner_dessus(source)
    return (True, str(n) + " carte(s) déplacée(s) de la colonne " + str(src + 1)
            + " vers la colonne " + str(dst + 1) + ".")


# ----------------------------------------------------------------------
# Aide : coups possibles et conseil
# ----------------------------------------------------------------------
def coups_possibles(etat, avec_retours):
    """
    FONCTION : liste de tuples (commande, description, score).
    Le score sert à choisir le conseil :
      +3 si le coup retourne une carte cachée
      +2 si le coup monte une carte en fondation
      +1 si le coup pose une carte sur une colonne
      +1 si le coup vide complètement une colonne (place libre pour un Roi)
       0 pour piocher
      -1 pour redescendre une carte d'une fondation (jamais conseillé)
    Les retours depuis les fondations ne sont listés que si avec_retours est
    True : sinon ils empêcheraient de détecter une partie bloquée.
    """
    coups = []

    if len(etat[E_DEFAUSSE]) > 0:
        carte = etat[E_DEFAUSSE][-1]
        if peut_sur_fondation(etat, carte):
            coups.append(("d f", texte_carte(carte) + " (défausse) -> fondation", 2))
        for i in range(NB_COLONNES):
            if peut_sur_colonne(etat[E_COLONNES][i], carte):
                coups.append(("d " + str(i + 1),
                              texte_carte(carte) + " (défausse) -> colonne " + str(i + 1), 1))

    for i in range(NB_COLONNES):
        col = etat[E_COLONNES][i]
        if len(col[VISIBLES]) > 0:
            carte = col[VISIBLES][-1]
            if peut_sur_fondation(etat, carte):
                score = 2
                if len(col[VISIBLES]) == 1:
                    if len(col[CACHEES]) > 0:
                        score = score + 3
                    else:
                        score = score + 1
                coups.append(("f " + str(i + 1),
                              texte_carte(carte) + " (col " + str(i + 1) + ") -> fondation", score))

    for src in range(NB_COLONNES):
        for dst in range(NB_COLONNES):
            if src != dst:
                n = trouver_nb_cartes(etat, src, dst)
                if n is not None:
                    source = etat[E_COLONNES][src]
                    carte = source[VISIBLES][-n]
                    score = 1
                    if n == len(source[VISIBLES]):
                        if len(source[CACHEES]) > 0:
                            score = score + 3
                        else:
                            score = score + 1
                    commande = "c " + str(src + 1) + " " + str(dst + 1)
                    description = texte_carte(carte) + " (col " + str(src + 1) + ") -> col " + str(dst + 1)
                    if n > 1:
                        commande = commande + " " + str(n)
                        description = description + " [" + str(n) + " cartes]"
                    coups.append((commande, description, score))

    if avec_retours:
        for f in range(4):
            pile = etat[E_FONDATIONS][f]
            if len(pile) > 0:
                carte = pile[-1]
                for i in range(NB_COLONNES):
                    if peut_sur_colonne(etat[E_COLONNES][i], carte):
                        coups.append(("r " + str(f + 1) + " " + str(i + 1),
                                      texte_carte(carte) + " (fondation " + str(f + 1)
                                      + ") -> colonne " + str(i + 1), -1))

    if len(etat[E_PIOCHE]) > 0:
        coups.append(("p", "Piocher", 0))
    elif len(etat[E_DEFAUSSE]) > 0 and recyclage_possible(etat):
        coups.append(("p", "Retourner la défausse", 0))

    return coups


def trier_coups(coups):
    """PROCEDURE : tri par insertion, du meilleur score au moins bon (les égalités gardent leur ordre)."""
    for i in range(1, len(coups)):
        coup = coups[i]
        j = i - 1
        while j >= 0 and coups[j][2] < coup[2]:
            coups[j + 1] = coups[j]
            j = j - 1
        coups[j + 1] = coup


def afficher_aide(etat):
    """PROCEDURE : affiche tous les coups possibles et le conseil."""
    coups = coups_possibles(etat, True)
    if len(coups) == 0:
        print("Aucun coup possible : la partie est bloquée.")
    else:
        trier_coups(coups)
        print("\nCoups possibles :")
        for coup in coups:
            print("  " + coup[0] + " " * (8 - len(coup[0])) + coup[1])
        if coups[0][2] >= 0:
            print("★ Conseil :", coups[0][0], "->", coups[0][1])
        else:
            print("Aucun coup vraiment utile : seuls des retours depuis les fondations sont possibles.")


# ----------------------------------------------------------------------
# L'ordinateur joue : d'abord il cherche une solution (récursivité)
# ----------------------------------------------------------------------
def cle_etat(etat):
    """FONCTION : texte qui identifie un plateau (pour ne pas l'explorer deux fois)."""
    recyclages = 0
    if etat[E_PARAM][P_RECYCLAGES] is not None:
        recyclages = etat[E_RECYCLES]
    return str([etat[E_COLONNES], etat[E_FONDATIONS], etat[E_PIOCHE], etat[E_DEFAUSSE], recyclages])


def montee_sure(etat, carte):
    """
    FONCTION : vrai si monter cette carte en fondation ne peut jamais gêner :
    un As, un 2, ou une carte dont les cartes de couleur opposée de valeur
    inférieure sont déjà toutes en fondation (elle ne servira plus de support).
    """
    valeur = carte[0]
    if valeur <= 2:
        return True
    for f in range(4):
        if (f < 2) != (carte[1] < 2):
            if len(etat[E_FONDATIONS][f]) < valeur - 1:
                return False
    return True


def jouer_montees_sures(etat):
    """FONCTION : joue toutes les montées sûres ; renvoie la liste des coups faits."""
    faits = []
    continuer = True
    while continuer:
        continuer = False
        if len(etat[E_DEFAUSSE]) > 0:
            carte = etat[E_DEFAUSSE][-1]
            if peut_sur_fondation(etat, carte) and montee_sure(etat, carte):
                defausse_vers_fondation(etat)
                faits.append(("d f", texte_carte(carte) + " (défausse) -> fondation"))
                continuer = True
        if not continuer:
            for i in range(NB_COLONNES):
                col = etat[E_COLONNES][i]
                if not continuer and len(col[VISIBLES]) > 0:
                    carte = col[VISIBLES][-1]
                    if peut_sur_fondation(etat, carte) and montee_sure(etat, carte):
                        colonne_vers_fondation(etat, i)
                        faits.append(("f " + str(i + 1),
                                      texte_carte(carte) + " (col " + str(i + 1) + ") -> fondation"))
                        continuer = True
    return faits


def coups_tries(etat, graine):
    """FONCTION : coups possibles, du meilleur au moins bon (mélangés d'abord si graine > 0)."""
    coups = coups_possibles(etat, False)
    if graine > 0:
        random.shuffle(coups)
    trier_coups(coups)
    return coups


def explorer(etat, vus, profondeur, graine):
    """
    FONCTION RÉCURSIVE : cherche une suite de coups qui gagne depuis ce plateau
    (l'ordinateur connaît les cartes cachées).
      cas terminal 1 : la partie est gagnée -> liste vide (plus rien à jouer)
      cas terminal 2 : trop profond, ou trop de plateaux explorés -> None
      cas récursif   : on essaie chaque coup, puis on explore le plateau obtenu ;
                       si l'appel renvoie None, on essaie le coup suivant (retour en arrière).
    vus : ensemble (set) des plateaux déjà explorés (test "in" très rapide).
    Renvoie la liste de coups (commande, description) ou None.
    """
    global NOEUDS
    if partie_gagnee(etat):
        return []
    if profondeur >= PROFONDEUR_MAX:
        return None
    for coup in coups_tries(etat, graine):
        if NOEUDS >= LIMITE_NOEUDS:
            return None
        essai = copier_etat(etat)
        reussi, message = executer_coup(essai, decouper(coup[0]))
        if reussi:
            suite = [(coup[0], coup[1])] + jouer_montees_sures(essai)
            cle = cle_etat(essai)
            if cle not in vus:
                vus.add(cle)
                NOEUDS = NOEUDS + 1
                reste = explorer(essai, vus, profondeur + 1, graine)
                if reste is not None:
                    return suite + reste
    return None


def resoudre(etat):
    """
    FONCTION : lance plusieurs recherches avec des ordres de coups différents.
    Renvoie une solution (liste de coups) ou None si aucune n'est trouvée.
    """
    global NOEUDS
    for graine in range(ESSAIS):
        racine = copier_etat(etat)
        debut = jouer_montees_sures(racine)
        NOEUDS = 0
        vus = set()
        vus.add(cle_etat(racine))
        suite = explorer(racine, vus, 0, graine)
        if suite is not None:
            return debut + suite
        if NOEUDS < LIMITE_NOEUDS:
            return None       # recherche complète : cette donne n'a pas de solution
    return None


def coup_utile(coup):
    """
    FONCTION : un coup est utile au mode "glouton" s'il fait avancer la partie :
    piocher, jouer la défausse, ou un coup de score >= 2 (fondation, carte
    cachée retournée, colonne vidée). Un déplacement latéral (score 1) ne sert à rien.
    """
    return coup[2] >= 2 or coup[0][0] == "p" or coup[0][0] == "d"


def jouer_glouton(etat, maximum):
    """
    FONCTION (plan B) : l'ordinateur joue toujours le meilleur coup utile, sans
    regarder plus loin. S'arrête si la partie est gagnée, bloquée, ou si le
    plateau revient à un état déjà vu. Renvoie le nombre de coups joués.
    """
    vus = []
    joues = 0
    while not partie_gagnee(etat) and (maximum is None or joues < maximum):
        cle = cle_etat(etat)
        if cle in vus:
            print("L'ordinateur tourne en rond : il s'arrête.")
            return joues
        vus.append(cle)
        coups = []
        for coup in coups_possibles(etat, False):
            if coup_utile(coup):
                coups.append(coup)
        if len(coups) == 0:
            print("L'ordinateur est bloqué : plus aucun coup utile.")
            return joues
        trier_coups(coups)
        reussi, message = executer_coup(etat, decouper(coups[0][0]))
        if reussi:
            etat[E_COUPS] = etat[E_COUPS] + 1
            joues = joues + 1
            print(str(joues) + ". " + coups[0][1])
    return joues


def jouer_auto(etat, maximum):
    """
    FONCTION : l'ordinateur cherche une solution puis la joue coup par coup
    (maximum coups, ou jusqu'au bout si maximum vaut None). Aucune méthode ne
    gagne à tous les coups : certaines donnes n'ont pas de solution. Si rien
    n'est trouvé, il joue au mieux (glouton). Renvoie le nombre de coups joués.
    """
    print("L'ordinateur réfléchit...")
    solution = resoudre(etat)
    if solution is None:
        print("Aucune solution trouvée depuis cette position : je joue au mieux.")
        return jouer_glouton(etat, maximum)
    joues = 0
    for coup in solution:
        if maximum is None or joues < maximum:
            reussi, message = executer_coup(etat, decouper(coup[0]))
            if reussi:
                etat[E_COUPS] = etat[E_COUPS] + 1
                joues = joues + 1
                print(str(joues) + ". " + coup[1])
    return joues


# ----------------------------------------------------------------------
# Sauvegarde
# ----------------------------------------------------------------------
def sauvegarder(etat):
    """PROCEDURE : écrit l'état dans un fichier JSON."""
    try:
        fichier = open(FICHIER_SAUVEGARDE, "w", encoding="utf-8")
        json.dump(etat, fichier)
        fichier.close()
        print("Partie sauvegardée dans", FICHIER_SAUVEGARDE)
    except OSError:
        print("Erreur : impossible d'écrire le fichier de sauvegarde.")


def charger():
    """FONCTION : renvoie l'état sauvegardé, ou None si absent ou invalide."""
    if not os.path.exists(FICHIER_SAUVEGARDE):
        return None
    try:
        fichier = open(FICHIER_SAUVEGARDE, "r", encoding="utf-8")
        etat = json.load(fichier)
        fichier.close()
        if len(etat) != 8 or len(etat[E_COLONNES]) != NB_COLONNES or len(etat[E_FONDATIONS]) != 4:
            return None
        return etat
    except (OSError, ValueError, TypeError):
        return None


# ----------------------------------------------------------------------
# Saisie et paramétrage
# ----------------------------------------------------------------------
def lire_colonne(texte):
    """FONCTION : "3" donne l'indice 2 ; None si ce n'est pas une colonne valide."""
    if est_nombre(texte):
        n = int(texte)
        if 1 <= n <= NB_COLONNES:
            return n - 1
    return None


def lire_fondation(texte):
    """FONCTION : "1" donne l'indice 0 ; None si ce n'est pas une fondation valide."""
    if est_nombre(texte):
        n = int(texte)
        if 1 <= n <= 4:
            return n - 1
    return None


def lire_choix(question):
    """FONCTION : lit une saisie et renvoie son mot unique ("" si vide ou plusieurs mots)."""
    mots = decouper(input(question))
    if len(mots) == 1:
        return mots[0]
    return ""


def demander_entier(question, mini, maxi, autoriser_vide):
    """FONCTION : redemande tant que la saisie n'est pas un entier entre mini et maxi."""
    while True:
        mots = decouper(input(question))
        if len(mots) == 0 and autoriser_vide:
            return None
        if len(mots) == 1 and est_nombre(mots[0]):
            if mini <= int(mots[0]) <= maxi:
                return int(mots[0])
        print("Valeur invalide.")


def parametres_personnalises():
    """FONCTION : demande les paramètres au joueur et renvoie la liste des paramètres."""
    print("\nParamètres personnalisés")
    nb_pioche = demander_entier("Cartes retournées à chaque pioche (1 ou 3) : ", 1, 3, False)
    if nb_pioche == 2:
        nb_pioche = 1
    recyclages = demander_entier("Recyclages de la pioche (vide = illimité) : ", 0, 99, True)
    annulations = demander_entier("Annulations autorisées (vide = illimité, 0 = aucune) : ", 0, 99, True)
    aide = lire_choix("Activer l'aide et l'ordinateur (o/n) ? ") != "n"
    return [nb_pioche, recyclages, annulations, aide]


def choisir_niveau():
    """FONCTION : affiche les niveaux et renvoie la liste des paramètres choisis."""
    print("\nNiveau de difficulté :")
    for i in range(len(NIVEAUX)):
        nom = NIVEAUX[i][0]
        p = NIVEAUX[i][1]
        texte = "  " + str(i + 1) + ") " + nom + " : " + str(p[P_PIOCHE]) + " carte(s) par pioche, recyclages "
        if p[P_RECYCLAGES] is None:
            texte = texte + "illimités"
        else:
            texte = texte + str(p[P_RECYCLAGES])
        texte = texte + ", annulations "
        if p[P_ANNULATIONS] is None:
            texte = texte + "illimitées"
        else:
            texte = texte + str(p[P_ANNULATIONS])
        if p[P_AIDE]:
            texte = texte + ", aide oui"
        else:
            texte = texte + ", aide non"
        print(texte)
    print("  4) Personnalisé")
    while True:
        choix = lire_choix("> ")
        if choix == "1" or choix == "2" or choix == "3":
            return NIVEAUX[int(choix) - 1][1][:]
        if choix == "4":
            return parametres_personnalises()
        print("Choix invalide.")


# ----------------------------------------------------------------------
# Boucle de jeu
# ----------------------------------------------------------------------
def executer_coup(etat, mots):
    """FONCTION : exécute un coup de déplacement ; renvoie (réussi, message)."""
    action = mots[0]
    if action == "p" and len(mots) == 1:
        return piocher(etat)
    if action == "d" and len(mots) == 2:
        if mots[1] == "f":
            return defausse_vers_fondation(etat)
        i = lire_colonne(mots[1])
        if i is not None:
            return defausse_vers_colonne(etat, i)
    elif action == "f" and len(mots) == 2:
        i = lire_colonne(mots[1])
        if i is not None:
            return colonne_vers_fondation(etat, i)
    elif action == "r" and len(mots) == 3:
        f = lire_fondation(mots[1])
        i = lire_colonne(mots[2])
        if f is not None and i is not None:
            return fondation_vers_colonne(etat, f, i)
    elif action == "c" and 3 <= len(mots) <= 4:
        src = lire_colonne(mots[1])
        dst = lire_colonne(mots[2])
        n = None
        if len(mots) == 4:
            if not est_nombre(mots[3]):
                return (False, "Le nombre de cartes doit être un entier.")
            n = int(mots[3])
        if src is not None and dst is not None:
            return colonne_vers_colonne(etat, src, dst, n)
    return (False, "Commande incorrecte. Tapez ? pour la liste des commandes.")


def jouer(etat):
    """PROCEDURE : boucle de jeu (une commande par saisie)."""
    historique = []
    afficher(etat)
    while True:
        if partie_gagnee(etat):
            print("\n*** BRAVO, vous avez gagné en", etat[E_COUPS], "coups ! ***")
            return
        mots = decouper(input("\nCommande (? = aide) > "))
        if len(mots) == 0:
            print("Tapez une commande (? pour l'aide).")
        elif mots[0] == "?" and len(mots) == 1:
            afficher_commandes()
        elif mots[0] == "a" and len(mots) == 1:
            if etat[E_PARAM][P_AIDE]:
                afficher_aide(etat)
            else:
                print("L'aide est désactivée à ce niveau.")
        elif mots[0] == "j" and len(mots) <= 2:
            if not etat[E_PARAM][P_AIDE]:
                print("L'ordinateur ne joue pas à votre place à ce niveau.")
            elif len(mots) == 2 and not est_nombre(mots[1]):
                print("Usage : j (jusqu'au bout)  ou  j <nombre de coups>")
            else:
                maximum = None
                if len(mots) == 2:
                    maximum = int(mots[1])
                avant = copier_etat(etat)
                if jouer_auto(etat, maximum) > 0:
                    historique.append(avant)
                afficher(etat)
        elif mots[0] == "s" and len(mots) == 1:
            sauvegarder(etat)
        elif mots[0] == "q" and len(mots) == 1:
            if lire_choix("Sauvegarder avant de quitter (o/n) ? ") == "o":
                sauvegarder(etat)
            return
        elif mots[0] == "u" and len(mots) == 1:
            limite = etat[E_PARAM][P_ANNULATIONS]
            if len(historique) == 0:
                print("Rien à annuler.")
            elif limite is not None and etat[E_ANNULES] >= limite:
                print("Plus d'annulations disponibles à ce niveau.")
            else:
                utilisees = etat[E_ANNULES] + 1
                etat = historique.pop()
                etat[E_ANNULES] = utilisees
                afficher(etat)
        else:
            avant = copier_etat(etat)
            reussi, message = executer_coup(etat, mots)
            print(message)
            if reussi:
                etat[E_COUPS] = etat[E_COUPS] + 1
                historique.append(avant)
                afficher(etat)
                if not partie_gagnee(etat) and len(coups_possibles(etat, False)) == 0:
                    print("Plus aucun coup utile : partie bloquée (u pour annuler, q pour quitter).")


def menu_principal():
    """PROCEDURE : menu de départ."""
    continuer = True
    while continuer:
        print("\n===== SOLITAIRE =====")
        print("1) Nouvelle partie")
        print("2) Reprendre la partie sauvegardée")
        print("3) Commandes et règles")
        print("4) Quitter")
        choix = lire_choix("> ")
        if choix == "1":
            jouer(nouvelle_partie(choisir_niveau()))
        elif choix == "2":
            etat = charger()
            if etat is None:
                print("Aucune sauvegarde valide trouvée.")
            else:
                jouer(etat)
        elif choix == "3":
            afficher_commandes()
        elif choix == "4":
            print("À bientôt !")
            continuer = False
        else:
            print("Choix invalide.")


# Programme principal
if __name__ == "__main__":
    os.system("")   # active les couleurs ANSI dans le terminal Windows
    menu_principal()
