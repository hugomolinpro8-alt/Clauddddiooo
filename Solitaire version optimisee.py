"""
Solitaire (Klondike) en mode texte - Projet L1 MIASHS / Éco.
Version optimisée : mêmes règles, mêmes commandes et mêmes niveaux que la
version d'origine, en plus court et avec uniquement des notions de L1 :
listes, tuples, chaînes, if / elif / else, for / while, fonctions et
procédures, variables globales, récursivité.

Structures de données
---------------------
carte      : tuple (valeur, couleur). valeur de 1 (As) à 13 (Roi).
             couleur 0 = ♥, 1 = ♦, 2 = ♣, 3 = ♠. Rouge si couleur < 2.
colonne    : liste [cachees, visibles] (deux listes de cartes).
etat       : liste [pioche, defausse, colonnes, fondations, parametres,
                    coups, recyclages_faits, annulations_faites]
parametres : liste [cartes_par_pioche, recyclages_max, annulations_max, aide]
             (None = illimité)
Partout, le dessus d'une pile est le DERNIER élément de la liste.
"""

import random
import json
import os

# ----------------------------------------------------------------------
# Variables globales (utilisées comme des constantes)
# ----------------------------------------------------------------------
SYMBOLES = ["♥", "♦", "♣", "♠"]
NOMS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "V", "D", "R"]
COULEURS = True        # mettre False si le terminal affiche mal les couleurs
FICHIER = "solitaire_sauvegarde.json"
MAX_COUPS_AUTO = 500   # nombre maximal de coups joués d'affilée par l'ordinateur

# Indices dans la liste etat
PIOCHE = 0
DEFAUSSE = 1
COLONNES = 2
FONDATIONS = 3
PARAM = 4
COUPS = 5
RECYCLES = 6
ANNULES = 7

# Indices dans une colonne
CACHEES = 0
VISIBLES = 1

# Indices dans la liste des paramètres
NB_PIOCHE = 0
MAX_RECYCLES = 1
MAX_ANNUL = 2
AIDE = 3

# Mémo des commandes, affiché à droite du plateau à chaque tour
MEMO = ["COMMANDES",
        "p         piocher",
        "d 3       défausse -> colonne 3",
        "d f       défausse -> fondation",
        "f 5       colonne 5 -> fondation",
        "r 1 4     fondation 1 -> colonne 4",
        "c 2 6     colonne 2 -> colonne 6",
        "c 2 6 3   (3 = nombre de cartes)",
        "a aide    j ordinateur",
        "u annuler   s sauver",
        "q quitter   ? règles"]

NIVEAUX = [["Facile", [1, None, None, True]],
           ["Moyen", [1, 3, 5, True]],
           ["Difficile", [3, 2, 0, False]]]


# ----------------------------------------------------------------------
# Affichage
# ----------------------------------------------------------------------
def texte_carte(carte):
    """FONCTION : (12, 0) devient "D♥", écrit en rouge pour ♥ et ♦."""
    texte = NOMS[carte[0]] + SYMBOLES[carte[1]]
    if COULEURS and carte[1] < 2:
        return "\033[31m" + texte + "\033[0m"
    return texte


def case(carte):
    """FONCTION : texte de la carte complété par des espaces (5 caractères)."""
    return texte_carte(carte) + " " * (4 - len(NOMS[carte[0]]))


def afficher(etat):
    """PROCEDURE : affiche tout le plateau."""
    print("\n" + "=" * 40)
    pioche = "vide"
    if len(etat[PIOCHE]) > 0:
        pioche = "[##] x" + str(len(etat[PIOCHE]))
    defausse = "vide"
    if len(etat[DEFAUSSE]) > 0:
        defausse = texte_carte(etat[DEFAUSSE][-1]) + " x" + str(len(etat[DEFAUSSE]))
    print("Pioche :", pioche, "    Défausse :", defausse)

    ligne = "Fondations :"
    for f in range(4):
        pile = etat[FONDATIONS][f]
        if len(pile) > 0:
            ligne = ligne + "   F" + str(f + 1) + ":" + texte_carte(pile[-1])
        else:
            ligne = ligne + "   F" + str(f + 1) + ":" + SYMBOLES[f] + "-"
    print(ligne)

    # Les colonnes sont écrites ligne par ligne dans la liste lignes,
    # puis chaque ligne est affichée avec, à droite, une ligne du mémo des commandes.
    lignes = ["C1   C2   C3   C4   C5   C6   C7   "]
    hauteur = 1
    for col in etat[COLONNES]:
        if len(col[CACHEES]) + len(col[VISIBLES]) > hauteur:
            hauteur = len(col[CACHEES]) + len(col[VISIBLES])
    for n in range(hauteur):
        ligne = ""
        for col in etat[COLONNES]:
            nb = len(col[CACHEES])
            if n < nb:
                ligne = ligne + "##   "
            elif n < nb + len(col[VISIBLES]):
                ligne = ligne + case(col[VISIBLES][n - nb])
            elif n == 0:
                ligne = ligne + "[ ]  "
            else:
                ligne = ligne + "     "
        lignes.append(ligne)
    while len(lignes) < len(MEMO):           # plateau plus court que le mémo
        lignes.append(" " * 35)
    print()
    for n in range(len(lignes)):
        if n < len(MEMO):
            print(lignes[n] + "  | " + MEMO[n])
        else:
            print(lignes[n])
    print("\nCoups joués :", etat[COUPS])


def afficher_commandes():
    """PROCEDURE : affiche les commandes et les règles."""
    print("""
COMMANDES
  p              piocher (ou retourner la défausse quand la pioche est vide)
  d <n>          défausse -> colonne n          ex. : d 3
  d f            défausse -> fondation
  f <n>          colonne n -> fondation         ex. : f 5
  r <f> <n>      fondation f -> colonne n       ex. : r 1 4   (1:♥ 2:♦ 3:♣ 4:♠)
  c <a> <b> [k]  colonne a -> colonne b         ex. : c 2 6   ou   c 2 6 3
                 (k = nombre de cartes ; sans k, le programme le trouve)
  a              aide : coups possibles et conseil
  j [k]          l'ordinateur joue à ta place (k coups, ou jusqu'au bout)
  u              annuler le dernier coup
  s              sauvegarder        q   quitter        ?   cette aide

RÈGLES
  - Colonnes : ordre décroissant, couleurs alternées (Dame noire sur Roi rouge).
  - Seul un Roi peut aller sur une colonne vide.
  - Fondations : une par couleur, de l'As au Roi.
  - On gagne quand les 52 cartes sont dans les fondations.""")


# ----------------------------------------------------------------------
# Création d'une partie et outils sur l'état
# ----------------------------------------------------------------------
def nouvelle_partie(parametres):
    """FONCTION : mélange les 52 cartes, distribue les 7 colonnes, renvoie l'état."""
    paquet = []
    for couleur in range(4):
        for valeur in range(1, 14):
            paquet.append((valeur, couleur))
    random.shuffle(paquet)
    colonnes = []
    for i in range(7):
        cachees = []
        for j in range(i):              # la colonne i reçoit i cartes cachées
            cachees.append(paquet.pop())
        colonnes.append([cachees, [paquet.pop()]])
    return [paquet, [], colonnes, [[], [], [], []], parametres, 0, 0, 0]


def copier(etat):
    """FONCTION : copie indépendante de l'état (pour annuler et pour tester un coup)."""
    colonnes = []
    for col in etat[COLONNES]:
        colonnes.append([col[CACHEES][:], col[VISIBLES][:]])
    fondations = []
    for pile in etat[FONDATIONS]:
        fondations.append(pile[:])
    return [etat[PIOCHE][:], etat[DEFAUSSE][:], colonnes, fondations,
            etat[PARAM], etat[COUPS], etat[RECYCLES], etat[ANNULES]]


def compter(etat, quoi):
    """FONCTION : nombre de cartes en fondation, de cartes cachées ou de colonnes vides."""
    total = 0
    if quoi == "fondation":
        for pile in etat[FONDATIONS]:
            total = total + len(pile)
    for col in etat[COLONNES]:
        if quoi == "cachees":
            total = total + len(col[CACHEES])
        elif quoi == "vides" and len(col[VISIBLES]) == 0:
            total = total + 1
    return total


def gagnee(etat):
    """FONCTION : vrai si les 52 cartes sont dans les fondations."""
    return compter(etat, "fondation") == 52


# ----------------------------------------------------------------------
# Règles du jeu
# ----------------------------------------------------------------------
def est_rouge(carte):
    """FONCTION : les coeurs (0) et les carreaux (1) sont rouges."""
    return carte[1] < 2


def sur_fondation(etat, carte):
    """FONCTION : la carte suit la dernière de sa fondation (l'As si elle est vide)."""
    return carte[0] == len(etat[FONDATIONS][carte[1]]) + 1


def sur_colonne(col, carte):
    """FONCTION : couleur opposée et valeur juste en dessous ; colonne vide : un Roi."""
    if len(col[VISIBLES]) == 0:
        return carte[0] == 13
    dessus = col[VISIBLES][-1]
    return est_rouge(dessus) != est_rouge(carte) and carte[0] == dessus[0] - 1


def nb_a_deplacer(visibles, col):
    """FONCTION : combien de cartes du dessus de visibles peuvent aller sur col (None si aucune)."""
    for k in range(1, len(visibles) + 1):
        if sur_colonne(col, visibles[-k]):
            return k
    return None


def lire_numero(texte, maxi):
    """FONCTION : "3" donne l'indice 2 ; None si ce n'est pas un nombre de 1 à maxi."""
    if texte.isdigit() and 1 <= int(texte) <= maxi:
        return int(texte) - 1
    return None


# ----------------------------------------------------------------------
# Les coups : chaque fonction renvoie un tuple (réussi, message)
# ----------------------------------------------------------------------
def piocher(etat):
    """FONCTION : retourne 1 ou 3 cartes ; recycle la défausse si la pioche est vide."""
    if len(etat[PIOCHE]) == 0:
        limite = etat[PARAM][MAX_RECYCLES]
        if len(etat[DEFAUSSE]) == 0:
            return (False, "Il n'y a plus aucune carte à piocher.")
        if limite is not None and etat[RECYCLES] >= limite:
            return (False, "Vous avez épuisé vos recyclages de la pioche.")
        etat[PIOCHE] = etat[DEFAUSSE][::-1]      # on retourne le tas
        etat[DEFAUSSE] = []
        etat[RECYCLES] = etat[RECYCLES] + 1
    for k in range(min(etat[PARAM][NB_PIOCHE], len(etat[PIOCHE]))):
        etat[DEFAUSSE].append(etat[PIOCHE].pop())
    return (True, "Vous piochez.")


def executer(etat, mots):
    """
    FONCTION : joue la commande (liste de mots) et renvoie (réussi, message).
    Tous les déplacements se font en deux étapes :
      1) trouver la pile de départ et la destination ("f" ou un numéro de colonne)
      2) vérifier la règle, puis déplacer les cartes
    """
    action = mots[0]
    if action == "p" and len(mots) == 1:
        return piocher(etat)

    # 1) Pile de départ et destination
    col_depart = None      # colonne de départ (pour retourner sa carte cachée)
    i_depart = None        # son indice (pour refuser c 3 3)
    n = 1                  # nombre de cartes à déplacer
    if action == "d" and len(mots) == 2:
        depart = etat[DEFAUSSE]
        destination = mots[1]
    elif action == "r" and len(mots) == 3:
        f = lire_numero(mots[1], 4)
        if f is None:
            return (False, "La fondation " + mots[1] + " n'existe pas (1 à 4).")
        depart = etat[FONDATIONS][f]
        destination = mots[2]
    elif (action == "f" and len(mots) == 2) or (action == "c" and 3 <= len(mots) <= 4):
        i_depart = lire_numero(mots[1], 7)
        if i_depart is None:
            return (False, "La colonne " + mots[1] + " n'existe pas (1 à 7).")
        col_depart = etat[COLONNES][i_depart]
        depart = col_depart[VISIBLES]
        destination = "f"
        if action == "c":
            destination = mots[2]
            n = None                       # le programme trouvera combien
            if len(mots) == 4:
                if not mots[3].isdigit():
                    return (False, "Le nombre de cartes doit être un entier.")
                n = int(mots[3])
    else:
        return (False, "Commande incorrecte. Tapez ? pour la liste des commandes.")
    if len(depart) == 0:
        return (False, "Il n'y a aucune carte à prendre ici.")

    # 2) Vérifier la règle et déplacer
    if destination == "f":
        carte = depart[-1]
        if not sur_fondation(etat, carte):
            return (False, "Interdit : " + texte_carte(carte) + " ne peut pas monter en fondation.")
        etat[FONDATIONS][carte[1]].append(depart.pop())
        message = texte_carte(carte) + " monte en fondation."
    else:
        j = lire_numero(destination, 7)
        if j is None:
            return (False, "La colonne " + destination + " n'existe pas (1 à 7).")
        if j == i_depart:
            return (False, "La colonne de départ et d'arrivée sont identiques.")
        arrivee = etat[COLONNES][j]
        if n is None:
            n = nb_a_deplacer(depart, arrivee)
        if n is None or n < 1 or n > len(depart) or not sur_colonne(arrivee, depart[-n]):
            return (False, "Interdit : impossible de poser ces cartes sur la colonne " + str(j + 1) + ".")
        groupe = depart[len(depart) - n:]          # les n cartes du dessus
        for k in range(n):
            depart.pop()
        arrivee[VISIBLES].extend(groupe)
        message = texte_carte(groupe[0]) + " va sur la colonne " + str(j + 1)
        if n > 1:
            message = message + " (" + str(n) + " cartes)"
        message = message + "."

    # Si une colonne n'a plus de carte visible, on retourne sa carte cachée
    if col_depart is not None and len(col_depart[VISIBLES]) == 0 and len(col_depart[CACHEES]) > 0:
        col_depart[VISIBLES].append(col_depart[CACHEES].pop())
    return (True, message)


# ----------------------------------------------------------------------
# Aide : coups possibles, score et tri
# ----------------------------------------------------------------------
def score(commande, avant, apres):
    """
    FONCTION : note un coup en comparant le plateau avant et après.
      0 piocher, -1 redescendre d'une fondation, 1 poser sur une colonne,
      2 monter en fondation, +3 si une carte cachée est retournée,
      sinon +1 si une colonne est vidée (place pour un Roi).
    """
    if commande == "p":
        return 0
    if commande[0] == "r":
        return -1
    note = 1
    if compter(apres, "fondation") > compter(avant, "fondation"):
        note = 2
    if compter(apres, "cachees") < compter(avant, "cachees"):
        note = note + 3
    elif compter(apres, "vides") > compter(avant, "vides"):
        note = note + 1
    return note


def coups_possibles(etat, avec_retours):
    """
    FONCTION : liste des coups permis, sous la forme [score, commande, message].
    Méthode : on écrit toutes les commandes imaginables, on essaie chacune sur
    une COPIE du plateau, et on garde celles qui réussissent.
    """
    commandes = ["p", "d f"]
    for i in range(1, 8):
        commandes.append("d " + str(i))
        commandes.append("f " + str(i))
        for j in range(1, 8):
            # Déplacer une colonne sans carte cachée vers une colonne vide ne sert à rien
            inutile = len(etat[COLONNES][j - 1][VISIBLES]) == 0 and len(etat[COLONNES][i - 1][CACHEES]) == 0
            if i != j and not inutile:
                commandes.append("c " + str(i) + " " + str(j))
        if avec_retours:
            for f in range(1, 5):
                commandes.append("r " + str(f) + " " + str(i))
    coups = []
    for commande in commandes:
        essai = copier(etat)
        reussi, message = executer(essai, commande.split())
        if reussi:
            coups.append([score(commande, etat, essai), commande, message])
    return coups


def trier(coups):
    """PROCEDURE : tri par insertion, du meilleur score au moins bon."""
    for i in range(1, len(coups)):
        coup = coups[i]
        j = i - 1
        while j >= 0 and coups[j][0] < coup[0]:
            coups[j + 1] = coups[j]
            j = j - 1
        coups[j + 1] = coup


def afficher_aide(etat):
    """PROCEDURE : affiche les coups possibles et conseille le meilleur."""
    coups = coups_possibles(etat, True)
    if len(coups) == 0:
        print("Aucun coup possible : la partie est bloquée.")
        return
    trier(coups)
    print("\nCoups possibles :")
    for coup in coups:
        print("  " + coup[1] + " " * (8 - len(coup[1])) + coup[2])
    if coups[0][0] >= 0:
        print("★ Conseil :", coups[0][1])


# ----------------------------------------------------------------------
# L'ordinateur joue (algorithme glouton, écrit en récursif)
# ----------------------------------------------------------------------
def jouer_ordinateur(etat, restant, vus):
    """
    FONCTION RÉCURSIVE : l'ordinateur joue le meilleur coup utile, puis
    recommence sur le nouveau plateau. Renvoie le nombre de coups joués.
      cas d'arrêt : partie gagnée, restant = 0, aucun coup utile,
                    ou plateau déjà vu (il tournerait en rond)
      cas récursif : 1 coup joué + les coups joués ensuite
    """
    if gagnee(etat) or restant == 0:
        return 0
    cle = str(etat[:4])               # le plateau écrit sous forme de texte
    if cle in vus:
        print("L'ordinateur tourne en rond : il s'arrête.")
        return 0
    vus.append(cle)
    utiles = []
    for coup in coups_possibles(etat, False):
        # utile = piocher, jouer la défausse, ou un coup de score >= 2
        if coup[0] >= 2 or coup[1][0] == "p" or coup[1][0] == "d":
            utiles.append(coup)
    if len(utiles) == 0:
        print("L'ordinateur est bloqué : plus aucun coup utile.")
        return 0
    trier(utiles)
    executer(etat, utiles[0][1].split())
    etat[COUPS] = etat[COUPS] + 1
    print("  ordinateur :", utiles[0][2])
    return 1 + jouer_ordinateur(etat, restant - 1, vus)


# ----------------------------------------------------------------------
# Sauvegarde et saisie
# ----------------------------------------------------------------------
def sauvegarder(etat):
    """PROCEDURE : écrit l'état dans un fichier JSON."""
    fichier = open(FICHIER, "w", encoding="utf-8")
    json.dump(etat, fichier)
    fichier.close()
    print("Partie sauvegardée dans", FICHIER)


def charger():
    """FONCTION : renvoie l'état sauvegardé, ou None s'il n'y en a pas (ou s'il est abîmé)."""
    if not os.path.exists(FICHIER):
        return None
    fichier = open(FICHIER, "r", encoding="utf-8")
    try:
        etat = json.load(fichier)
    except ValueError:
        etat = None
    fichier.close()
    if etat is None or len(etat) != 8 or len(etat[COLONNES]) != 7:
        return None
    return etat


def saisir(question):
    """FONCTION : lit une ligne et renvoie la liste de ses mots, en minuscules.
    Ctrl+C ou Ctrl+D quittent proprement au lieu de faire planter le programme."""
    try:
        return input(question).lower().split()
    except (EOFError, KeyboardInterrupt):
        print("\nÀ bientôt !")
        exit()


def demander_entier(question, mini, maxi, vide_permis):
    """FONCTION : redemande tant que la réponse n'est pas un entier entre mini et maxi."""
    while True:
        mots = saisir(question)
        if len(mots) == 0 and vide_permis:
            return None
        if len(mots) == 1 and mots[0].isdigit() and mini <= int(mots[0]) <= maxi:
            return int(mots[0])
        print("Valeur invalide.")


def texte_limite(valeur):
    """FONCTION : None devient "illimité", sinon le nombre en texte."""
    if valeur is None:
        return "illimité"
    return str(valeur)


def choisir_niveau():
    """FONCTION : affiche les niveaux et renvoie la liste des paramètres choisis."""
    print("\nNiveau de difficulté :")
    for i in range(len(NIVEAUX)):
        p = NIVEAUX[i][1]
        aide = "non"
        if p[AIDE]:
            aide = "oui"
        print("  " + str(i + 1) + ") " + NIVEAUX[i][0] + " : pioche " + str(p[NB_PIOCHE])
              + ", recyclages " + texte_limite(p[MAX_RECYCLES])
              + ", annulations " + texte_limite(p[MAX_ANNUL]) + ", aide " + aide)
    print("  4) Personnalisé")
    choix = demander_entier("> ", 1, 4, False)
    if choix <= 3:
        return NIVEAUX[choix - 1][1][:]        # une copie, pour ne pas modifier NIVEAUX
    nb_pioche = 0
    while nb_pioche != 1 and nb_pioche != 3:
        nb_pioche = demander_entier("Cartes retournées à chaque pioche (1 ou 3) : ", 1, 3, False)
    recyclages = demander_entier("Recyclages de la pioche (vide = illimité) : ", 0, 99, True)
    annulations = demander_entier("Annulations (vide = illimité, 0 = aucune) : ", 0, 99, True)
    aide = saisir("Activer l'aide et l'ordinateur (o/n) ? ") != ["n"]
    return [nb_pioche, recyclages, annulations, aide]


# ----------------------------------------------------------------------
# Boucle de jeu et menu
# ----------------------------------------------------------------------
def jouer(etat):
    """PROCEDURE : boucle de jeu, une commande par saisie."""
    historique = []        # pile des plateaux précédents (pour annuler)
    afficher(etat)
    while not gagnee(etat):
        mots = saisir("\nCommande (? = aide) > ")
        if len(mots) == 0:
            print("Tapez une commande (? pour l'aide).")
        elif mots == ["?"]:
            afficher_commandes()
        elif mots == ["s"]:
            sauvegarder(etat)
        elif mots == ["q"]:
            if saisir("Sauvegarder avant de quitter (o/n) ? ") == ["o"]:
                sauvegarder(etat)
            return
        elif mots == ["u"]:
            limite = etat[PARAM][MAX_ANNUL]
            if len(historique) == 0:
                print("Rien à annuler.")
            elif limite is not None and etat[ANNULES] >= limite:
                print("Plus d'annulations disponibles à ce niveau.")
            else:
                annulations = etat[ANNULES] + 1
                etat = historique.pop()
                etat[ANNULES] = annulations     # le compteur, lui, n'est pas annulé
                afficher(etat)
        elif mots[0] == "a" or mots[0] == "j":
            if not etat[PARAM][AIDE]:
                print("L'aide et l'ordinateur sont désactivés à ce niveau.")
            elif mots == ["a"]:
                afficher_aide(etat)
            elif len(mots) == 1 or (len(mots) == 2 and mots[1].isdigit()):
                maximum = MAX_COUPS_AUTO
                if len(mots) == 2:
                    maximum = min(int(mots[1]), MAX_COUPS_AUTO)
                avant = copier(etat)
                if jouer_ordinateur(etat, maximum, []) > 0:
                    historique.append(avant)
                afficher(etat)
            else:
                print("Usage : a   ou   j   ou   j <nombre de coups>")
        else:
            avant = copier(etat)
            reussi, message = executer(etat, mots)
            print(message)
            if reussi:
                etat[COUPS] = etat[COUPS] + 1
                historique.append(avant)
                afficher(etat)
                if not gagnee(etat) and len(coups_possibles(etat, False)) == 0:
                    print("Plus aucun coup possible : partie bloquée (u pour annuler, q pour quitter).")
    print("\n*** BRAVO, vous avez gagné en", etat[COUPS], "coups ! ***")


def menu_principal():
    """PROCEDURE : menu de départ."""
    while True:
        print("\n===== SOLITAIRE =====")
        print("1) Nouvelle partie\n2) Reprendre la partie sauvegardée\n3) Commandes et règles\n4) Quitter")
        choix = demander_entier("> ", 1, 4, False)
        if choix == 1:
            jouer(nouvelle_partie(choisir_niveau()))
        elif choix == 2:
            etat = charger()
            if etat is None:
                print("Aucune sauvegarde valide trouvée.")
            else:
                jouer(etat)
        elif choix == 3:
            afficher_commandes()
        else:
            print("À bientôt !")
            return


# Programme principal
if __name__ == "__main__":
    os.system("")      # active les couleurs dans le terminal Windows
    menu_principal()
