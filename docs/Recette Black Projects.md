---
type: recette
module: Black Projects
version: 2.13.0
date_recette:
testeur:
---

# Recette — Black Projects 2.13.0

Plan de test manuel pour le fork. Les **628 tests automatisés** couvrent la logique
(ordonnancement, récurrence, sérialisation, traductions) ; ils ne couvrent **ni le rendu,
ni les interactions**. Tout ce qui suit ne peut se vérifier que dans un vrai coffre.

> [!warning] Testez sur un coffre de test, pas sur vos vrais projets
> Plusieurs cas demandent d'éditer du frontmatter à la main ou de provoquer des
> erreurs. Dupliquez un coffre, ou créez-en un vide avec deux ou trois projets jouets.

**Convention**
`✅` = conforme · `❌` = anomalie, notez ce que vous avez vu dans la ligne « Constaté »
Les tests marqués **[R]** sont des **régressions** : ils vérifient que le fork n'a rien
cassé de ce qui marchait. Les **[N]** portent sur les **nouveautés**.

---

## 0. Installation et reprise des données

> **Nouveau en 2.8.0** (livré avec la 2.9.0) : le module change de nom **et de dossier** — `black-documents`
> devient `black-projects`. Cette fois la reprise des réglages est **automatique** :
> rien à recopier à la main.

- [ ] **[R]** Toute autre copie est désactivée : l'upstream **dotpm**, l'ancien **Black Documents**, et **dotpm FR** si tu l'avais installé
- [ ] Le dossier `<coffre>/.obsidian/plugins/black-projects/` contient bien `main.js`, `manifest.json`, `styles.css`
- [ ] **Black Projects** apparaît dans la liste des modules et s'active sans erreur
- [ ] La console développeur (`Ctrl/Cmd+Maj+I`) ne montre **aucune erreur rouge** au démarrage
- [ ] **[N]** Au premier démarrage, une notification annonce que les **réglages ont été repris** du dossier `black-documents`
- [ ] ✅ **Attendu** : statuts, priorités, champs personnalisés, langue et filtres sont **ceux d'avant**, sans avoir recopié quoi que ce soit
- [ ] Le fichier `data.json` est bien **écrit dans le nouveau dossier** (donc conservé au prochain lancement)
- [ ] Redémarrer une seconde fois : ✅ **Attendu** : **pas** de nouvelle notification de reprise
- [ ] **[N]** Modifier un réglage, redémarrer : ✅ **Attendu** : c'est ta modification qui subsiste,
      pas l'ancienne valeur du dossier `black-documents` *(une reprise ne doit jamais écraser un dossier déjà utilisé)*
- [ ] **[N]** Si l'upstream **dotpm** est encore installé : ✅ **Attendu** : ses réglages ne sont **pas** repris
- [ ] **[R]** Les tâches et projets écrits par une version précédente s'ouvrent tels quels
      *(le format de données n'a pas changé : `pm-project`, `pm-task`, `pm-collection`)*
- [ ] **Une fois les réglages repris**, l'ancien dossier de module est supprimé, pour que deux copies n'indexent pas le coffre
      ⚠️ dans cet ordre : la reprise lit le `data.json` de l'ancien dossier au premier démarrage
- [ ] Le nom **Black Projects** apparaît bien dans : la liste des modules, l'info-bulle du ruban,
      l'en-tête des réglages, et le préfixe des notifications
- [ ] **[R]** Les projets et tâches existants apparaissent — ils n'ont eu besoin d'aucune migration
- [ ] L'icône dans le ruban ouvre le tableau de bord

> [!info] Si les projets n'apparaissent pas
> Palette de commandes → **Reconstruire l'index des projets**. S'ils apparaissent alors,
> c'est un problème d'indexation au démarrage, pas de données : notez-le.

**Constaté :**

---

## 1. Les bases n'ont pas bougé [R]

À faire en premier : si ça casse ici, le reste n'a pas de sens.

### Vues

- [ ] La vue **Tableur** liste les tâches, le tri par colonne fonctionne
- [ ] La vue **Gantt** dessine les barres aux bonnes dates
- [ ] La vue **Tableau** (kanban) affiche les colonnes de statut, le glisser-déposer d'une carte change son statut
- [ ] La **vue d'ensemble** d'un projet affiche avancement, compteurs et jalons
- [ ] Le passage d'une vue à l'autre conserve le projet affiché

### Édition

- [ ] Créer une tâche : elle apparaît dans les trois vues
- [ ] Modifier titre, statut, priorité, échéance : les changements persistent après rechargement d'Obsidian
- [ ] Créer une sous-tâche : la hiérarchie s'affiche correctement
- [ ] Supprimer une tâche : sa note disparaît de `_tasks/`
- [ ] Archiver une tâche : elle part dans `_tasks/Archive/`
- [ ] Le filtre par statut / priorité / assigné / étiquette fonctionne
- [ ] Annuler (`Annuler la dernière action`) revient bien en arrière

**Constaté :**

---

## 2. Contenu libre dans une note de projet [N]

> **Ce qui était cassé** : le corps de la note projet était régénéré à chaque
> sauvegarde. Tout ce que vous y écriviez à la main disparaissait silencieusement.

- [ ] Ouvrir la **note du projet** (`Projets/<Nom>/<Nom>.md`) dans l'éditeur Obsidian
- [ ] Y ajouter à la main une section, par exemple :
      `## Compte-rendu réunion` suivi de quelques lignes
- [ ] Revenir dans la vue du projet et **créer une tâche** (ce qui force une sauvegarde du projet)
- [ ] Rouvrir la note du projet
- [ ] ✅ **Attendu** : la section `## Compte-rendu réunion` est **toujours là**, **une seule fois**
- [ ] ✅ **Attendu** : elle se trouve **au-dessus** de la section `## Tasks` générée
- [ ] Refaire une modification (changer un statut) et revérifier : toujours là, toujours en un seul exemplaire

Cas limite, plus subtil :

- [ ] Écrire à la main une section nommée exactement `## Tasks` contenant du texte libre (pas des cases à cocher)
- [ ] Forcer une sauvegarde
- [ ] ✅ **Attendu** : votre section est conservée ; seule la liste générée de cases à cocher est réécrite

**Constaté :**

---

## 3. Cycles de dépendances [N]

> **Ce qui était cassé** : les cycles étaient détectés puis jetés. Les tâches en boucle
> cessaient d'être planifiées, sans un mot.

L'interface refuse de créer un cycle, il faut donc le fabriquer à la main.

- [ ] Créer deux tâches **A** et **B**, avec dates de début et d'échéance
- [ ] Dans l'éditeur, faire dépendre **B de A** (`Ajouter une propriété` → `Dépend de`)
- [ ] Ouvrir la note de **A** dans l'éditeur Obsidian et ajouter à la main dans le frontmatter :
      `dependencies: ["<id de B>"]`
      (l'id de B se copie depuis son éditeur : `Plus d'actions` → `Copier l'identifiant`)
- [ ] Revenir dans Black Projects, ouvrir la tâche **A** et **l'enregistrer**
- [ ] ✅ **Attendu** : une notification annonce que des tâches dépendent les unes des autres en boucle, **en nommant A et B**
- [ ] ✅ **Attendu** : la console contient une ligne `[Black Projects] Dependency cycle` avec les identifiants
- [ ] Retirer la dépendance fautive, réenregistrer
- [ ] ✅ **Attendu** : plus aucune notification de cycle

> [!note] La replanification n'est pas déclenchée par toutes les actions
> Elle part de l'enregistrement d'une tâche dans l'éditeur, d'une édition de date dans
> le tableur, d'un glissement dans le Gantt, ou du passage d'une tâche à un statut
> terminal. Changer une priorité ou une étiquette ne la déclenche pas.

**Constaté :**

---

## 4. Jours ouvrés et jours fériés [N]

> **Nouveau, et désactivé par défaut** : l'activer déplacerait les dates de tous vos
> plans existants à la première replanification.

### Réglage

- [ ] `Réglages` → `Black Projects` → section **Planification**
- [ ] L'option **« Ignorer week-ends et jours fériés »** est présente et **désactivée**
- [ ] Juste en dessous : **« Semaine de travail »** avec sept boutons (Lun → Dim), Lun–Ven actifs
- [ ] Et **« Jours fériés »**, une zone de texte, une date par ligne

### Comportement, option désactivée

- [ ] Créer **A** finissant un **vendredi**, et **B** qui dépend de A
- [ ] ✅ **Attendu** : B démarre le **samedi** (comportement d'origine, inchangé)

### Comportement, option activée

- [ ] Activer « Ignorer week-ends et jours fériés »
- [ ] Déplacer la date de fin de A (dans le tableur) pour forcer une replanification
- [ ] ✅ **Attendu** : B démarre le **lundi**, plus le samedi
- [ ] Donner à B une durée de 3 jours ; ✅ **Attendu** : elle occupe **3 jours ouvrés**, week-end sauté
- [ ] Ajouter le lundi en question dans « Jours fériés » (format `AAAA-MM-JJ`), replanifier
- [ ] ✅ **Attendu** : B démarre le **mardi**
- [ ] Saisir une ligne invalide (`pas-une-date`) dans les jours fériés
- [ ] ✅ **Attendu** : la description du réglage signale l'entrée ignorée, rien ne casse
- [ ] Tenter de désactiver les **sept** jours de la semaine de travail
- [ ] ✅ **Attendu** : le dernier jour actif refuse de s'éteindre

### Ce qui ne doit PAS bouger

- [ ] Une date saisie **à la main** un dimanche reste au dimanche — l'option ne touche que les dates que l'ordonnanceur calcule

**Constaté :**

---

## 5. Tâches récurrentes [N]

> **Ce qui était cassé** : la récurrence était purement décorative. Le réglage était
> enregistré, un badge « R » s'affichait, mais aucune occurrence n'était jamais créée.

- [ ] Créer une tâche avec **début** et **échéance** (échéance **dans le futur**)
- [ ] Dans l'éditeur : `Ajouter une propriété` → **`Répétition`** → **`Hebdomadaire`**
- [ ] Enregistrer, puis passer la tâche à **Terminée**
- [ ] ✅ **Attendu** : une **nouvelle tâche** apparaît, même titre
- [ ] ✅ **Attendu** : ses dates sont décalées d'**une semaine exactement**
- [ ] ✅ **Attendu** : statut remis au premier statut ouvert, avancement à **0 %**, date de complétion vide
- [ ] ✅ **Attendu** : priorité, étiquettes, assignés et la récurrence elle-même sont **repris**
- [ ] ✅ **Attendu** : sa note existe dans `_tasks/`, avec un nom de fichier **distinct** de l'originale
      (suffixé par un identifiant — c'est voulu, deux occurrences ne peuvent pas partager un nom de fichier)

### Cas limites

- [ ] **Rouvrir** la tâche terminée (repasser à « À faire ») ; ✅ **Attendu** : **aucune** nouvelle occurrence
- [ ] Réenregistrer une tâche déjà terminée ; ✅ **Attendu** : **pas de doublon**
- [ ] Une tâche récurrente avec une **date de fin de série** dépassée ; ✅ **Attendu** : aucune occurrence créée
- [ ] Une tâche récurrente **avec sous-tâches** : ✅ **Attendu** : les sous-tâches suivent, remises à zéro, en conservant leur décalage par rapport au parent
- [ ] Une tâche dont l'échéance est **très ancienne** (plusieurs mois) : ✅ **Attendu** : la nouvelle occurrence tombe dans le **futur**, pas dans le passé, en restant sur le même jour de la semaine
- [ ] Une récurrence **mensuelle** sur le **31** : ✅ **Attendu** : la série revient au 31, elle ne dérive pas vers le 28

**Constaté :**

---

## 6. Dépendances typées et décalage [N]

> **Nouveau** : chaque lien signifiait « fin à début, exactement un jour après ».

- [ ] Créer **A** (dates connues) et **B** qui dépend de A
- [ ] Dans l'éditeur de B, sur la ligne de la dépendance : une **liste `FS/SS/FF/SF`** et un **champ numérique** sont visibles
- [ ] Survoler la liste : ✅ **Attendu** : l'infobulle dit « Fin à début », etc.
- [ ] Survoler le champ numérique : ✅ **Attendu** : « Décalage en jours ouvrés. Négatif pour chevaucher le prédécesseur. »

### Les quatre types

- [ ] **FS**, décalage `0` : B démarre le lendemain de la fin de A *(comportement d'origine)*
- [ ] **FS**, décalage `2` : B démarre **2 jours plus tard**
- [ ] **FS**, décalage `-2` : B **chevauche** A
- [ ] **SS** : B démarre **en même temps** que A
- [ ] **FF** : B **finit** en même temps que A — et **garde sa durée** (son début se décale aussi)
- [ ] **SF** : la **fin** de B est calée sur le **début** de A
- [ ] Deux dépendances aux contraintes différentes : ✅ **Attendu** : c'est la **plus contraignante** qui gagne

### Persistance

- [ ] Ouvrir la note de B : le frontmatter contient un bloc `dependencyOptions`
- [ ] Recharger Obsidian : type et décalage sont **conservés**
- [ ] Remettre le lien en **FS / 0** : ✅ **Attendu** : `dependencyOptions` **disparaît** du frontmatter
      *(une dépendance ordinaire ne doit rien écrire de plus)*
- [ ] **Supprimer** la dépendance : ✅ **Attendu** : son entrée disparaît aussi

**Constaté :**

---

## 7. Interface française [N]

- [ ] `Réglages` → `Black Projects` → **Général** → le réglage **« Langue »** existe
- [ ] Sur **« Comme Obsidian »**, avec Obsidian en français : l'interface est **en français**
- [ ] Forcer **English** : l'interface repasse en anglais (rouvrir les vues si besoin)
- [ ] Forcer **Français** avec Obsidian en anglais : l'interface reste **en français**

### Là où il faut vraiment regarder

- [ ] **Palette de commandes** : toutes les commandes Black Projects sont en français
- [ ] **[N]** Vue **Gantt** : le bouton de granularité dit **« Jour »**, pas « Day »
- [ ] **[N]** ✅ **Attendu** : les colonnes de semaine s'écrivent **S35**, **S36**… (pas W35)
- [ ] **[N]** Passer en granularité **Trimestre** : ✅ **Attendu** : **T3 2026**, pas Q3
- [ ] **[N]** Survoler un **jalon** dans le Gantt : ✅ **Attendu** : l'infobulle dit « (jalon) » et « Date : »
- [ ] **[N]** Carte d'un jalon dans le **Tableau** : ✅ **Attendu** : la pastille est **J**, pas M
- [ ] **[N]** Ouvrir la **page d'un projet** (clic sur son titre) : ✅ **Attendu** : tout l'encart de chiffres
      est en français — « 3 tâches terminées sur 12 », « 2 sous-projets », « 4 membres »,
      « tâches en retard », « passé / estimé »
- [ ] **[N]** Un champ personnalisé de type **liste** : ✅ **Attendu** : l'option vide dit « Aucun »
- [ ] **[N]** Une propriété vide dans l'éditeur de tâche : ✅ **Attendu** : « Définir une valeur »
- [ ] **[N]** Barre de sélection multiple : ✅ **Attendu** : le bouton dit **« Archiver »**
- [ ] **[N]** Ajouter un assigné inconnu : ✅ **Attendu** : « Ajouter « nom » » et « Créer la note de personne « nom » »
- [ ] **[N]** Section **Suivi du temps** d'une tâche : ✅ **Attendu** : le titre est en français
- [ ] **[N]** Bouton de création d'un projet : ✅ **Attendu** : « Créer le projet (Ctrl+S) »
- [ ] **[N]** Réglage **Langue → Français** sur un Obsidian en **anglais**
      ✅ **Attendu** : les **dates** passent aussi en français (« 6 mars » et non « Mar 6 »)
- [ ] **[N]** Réglage **Langue → Automatique** : ✅ **Attendu** : les dates suivent Obsidian
- [ ] **[N]** Dans la **recherche des réglages** d'Obsidian, taper **« jours ouvrés »**
      ✅ **Attendu** : les réglages de planification remontent
- [ ] **[N]** Chercher **« raccourci »**, **« dépendances »**, **« jours fériés »**, **« archivage »**
      ✅ **Attendu** : chacun trouve son réglage
- [ ] **[N]** Chercher **« kanban »** ou **« gantt »** : ✅ **Attendu** : ça marche aussi — les mots
      anglais restent volontairement dans la liste française
- [ ] **[N]** Sélectionner **plusieurs tâches** puis **Supprimer** : ✅ **Attendu** : la confirmation est en français,
      avec le bon accord (« 1 tâche » / « 3 tâches »)
- [ ] **[N]** Sélection multiple → **Archiver**, puis **Désarchiver** : ✅ **Attendu** : la notification compte en français
- [ ] **Éditeur de tâche** : tous les libellés de champs, y compris les propriétés à ajouter
- [ ] **Menu contextuel** d'une tâche (clic droit)
- [ ] **Barre d'actions groupées** (sélectionner plusieurs tâches dans le tableur)
- [ ] **En-têtes de colonnes** du tableur, **barre de filtres**
- [ ] **Contrôles du Gantt** (granularité, Tout déplier/replier) et **infobulle d'une barre**
- [ ] **Vue d'ensemble** d'un projet et **réglages du projet**
- [ ] **Fenêtres** : nouveau projet, import de notes, confirmations
- [ ] **Notifications** : archiver des tâches, un cycle, une erreur

### Pièges à vérifier

- [ ] **Aucun texte tronqué ni débordant** dans les boutons et libellés — le français est plus long que l'anglais
- [ ] **Pluriels corrects** : « 1 tâche » / « 2 tâches », et surtout **« 0 tâche »** au singulier (règle française)
- [ ] **Aucune clé brute** affichée du type `common.task` ou `settings.group.general`
- [ ] Nouvelle installation en français : les statuts par défaut sont **« À faire / En cours / Terminée »**
- [ ] Sur une installation **existante**, changer de langue **ne renomme pas** vos statuts — ce sont vos données

**Constaté :**

---

## 7bis. Recueils [N]

> **Nouveau en 2.5.0** : un recueil rassemble des tâches choisies dans plusieurs
> projets. Les tâches ne bougent pas — un recueil ne contient que des références.

### Création et affichage

- [ ] Palette de commandes → **« Créer un recueil »**, saisir un nom
- [ ] ✅ **Attendu** : le recueil s'ouvre, vide, avec un message invitant à y ajouter des tâches
- [ ] ✅ **Attendu** : la barre d'outils reste visible (nom + pastille) — on ne doit pas se retrouver coincé
- [ ] Une note est créée dans le dossier des projets, avec `pm-collection: true` dans son frontmatter
- [ ] Retour au tableau de bord : ✅ **Attendu** : une section **« Recueils »** sous la liste des projets
- [ ] Le compteur en haut mentionne le nombre de recueils

### Ajout et retrait à la main

- [ ] Dans un projet, clic droit sur une tâche → **« Ajouter à un recueil »** → choisir le recueil
- [ ] ✅ **Attendu** : une notification confirme l'ajout
- [ ] Ouvrir le recueil : ✅ **Attendu** : la tâche y est
- [ ] Ajouter une tâche d'un **deuxième projet** : ✅ **Attendu** : les deux coexistent dans la même vue
- [ ] ✅ **Attendu** : chaque tâche est rangée sous un **en-tête portant son projet d'origine**
- [ ] ✅ **Attendu** : **pas** de colonne « Projet » dans un recueil — l'en-tête le dit déjà
- [ ] Dans une vue **tous projets** (pas un recueil) : ✅ **Attendu** : la colonne « Projet » est **toujours là**
- [ ] Dans le recueil, clic droit → **« Retirer du recueil »** : ✅ **Attendu** : la tâche disparaît du recueil
- [ ] ✅ **Attendu** : la tâche est **toujours présente dans son projet d'origine**

### Les tâches restent chez elles

- [ ] Depuis le recueil, modifier le statut, l'échéance et le titre d'une tâche
- [ ] ✅ **Attendu** : la note de la tâche, dans `_tasks/` de son **projet d'origine**, porte les modifications
- [ ] ✅ **Attendu** : la tâche apparaît modifiée dans son projet
- [ ] ✅ **Attendu** : le frontmatter de la tâche ne mentionne **aucun** recueil — l'appartenance vit côté recueil
- [ ] Le Gantt et le tableau (kanban) du recueil fonctionnent aussi
- [ ] ✅ **Attendu** : **pas de bouton « + ajouter une tâche »** dans un recueil, ni dans la barre d'outils,
      ni en bas du tableau *(elle n'aurait pas de projet, et n'entrerait même pas dans le recueil)*

### Règle — création depuis une vue filtrée

> C'est le chemin principal : un recueil vide ne peut pas proposer d'étiquettes ni
> d'assignés à filtrer, puisqu'il ne contient aucune tâche. On part donc d'une vue
> qui en a.

- [ ] Poser une étiquette (ex. `comite`) sur trois tâches réparties dans deux projets
- [ ] Commande **« Ouvrir tous les projets dans une vue »**, puis filtrer sur cette étiquette
- [ ] Cliquer la pastille de portée → **« Enregistrer comme recueil… »**, saisir un nom
- [ ] ✅ **Attendu** : le recueil s'ouvre, contenant les trois tâches
- [ ] ✅ **Attendu** : sa pastille affiche **« Suit une règle »**
- [ ] Refaire l'opération depuis **un seul projet** filtré
- [ ] ✅ **Attendu** : `sources` dans la note du recueil ne liste que ce projet — la règle
      ne s'élargit pas silencieusement à tout le coffre

### Règle — ajustement depuis le recueil

- [ ] Dans un recueil **non vide**, changer les filtres puis pastille →
      **« Enregistrer les filtres actuels comme règle »**
- [ ] ✅ **Attendu** : la règle est remplacée par les nouveaux filtres
- [ ] Poser l'étiquette sur une **quatrième** tâche : ✅ **Attendu** : elle rejoint le recueil toute seule
- [ ] Retirer l'étiquette d'une tâche : ✅ **Attendu** : elle quitte le recueil

### Règle et retouches manuelles

- [ ] Sur une tâche que la règle attrape, **« Retirer du recueil »**
- [ ] ✅ **Attendu** : elle disparaît **et ne revient pas**, même si elle porte toujours l'étiquette
      *(une exclusion est enregistrée ; sans ça le retrait n'aurait aucun effet)*
- [ ] La rajouter par **« Ajouter à un recueil »** : ✅ **Attendu** : elle revient (l'exclusion est levée)
- [ ] Ajouter à la main une tâche **sans** l'étiquette : ✅ **Attendu** : elle reste, la règle ne la chasse pas
- [ ] Pastille → **« Effacer la règle »** : ✅ **Attendu** : seules les tâches ajoutées à la main subsistent

### Regroupement par projet [N]

> **Nouveau en 2.7.0** : dans un recueil, chaque tâche est rangée sous un en-tête
> portant le projet dont elle vient.

- [ ] Ouvrir un recueil contenant des tâches de **deux projets au moins**
- [ ] ✅ **Attendu** : un **en-tête par projet**, avec son icône, sa couleur et son nom
- [ ] Avec un projet dont l'icône est une **icône Lucide** (et pas un émoji) :
      ✅ **Attendu** : l'icône est **dessinée**, pas écrite en toutes lettres (`lucide-toolbox`)
- [ ] Avec un projet **sans icône** : ✅ **Attendu** : une **pastille de sa couleur**
- [ ] ✅ **Attendu** : l'en-tête indique le **nombre de tâches** qu'il rassemble (« 3 tâches »)
- [ ] Cliquer le **nom** du projet dans l'en-tête : ✅ **Attendu** : le projet s'ouvre
- [ ] Cliquer le **chevron** : ✅ **Attendu** : le bloc se replie, l'en-tête reste visible
      et son compteur continue d'annoncer les tâches repliées
- [ ] Fermer puis rouvrir le recueil : ✅ **Attendu** : le bloc est **toujours replié**
- [ ] Plier un projet dans un recueil, ouvrir **un autre recueil** contenant le même projet
      ✅ **Attendu** : il y est **déplié** — le pliage est mémorisé recueil par recueil
- [ ] Ajouter une tâche d'un **troisième** projet : ✅ **Attendu** : un nouvel en-tête apparaît
- [ ] Retirer la dernière tâche d'un projet : ✅ **Attendu** : son en-tête disparaît
- [ ] Ajouter une tâche **et sa sous-tâche** : ✅ **Attendu** : la sous-tâche reste sous son parent,
      dans le bloc du projet, avec son indentation
- [ ] **Filtrer** le recueil sur un statut qui ne laisse rien d'un projet
      ✅ **Attendu** : l'en-tête de ce projet disparaît aussi — pas de bloc vide
- [ ] **Trier** par échéance : ✅ **Attendu** : le tri s'applique **à l'intérieur** de chaque bloc
- [ ] Cocher la case « tout sélectionner » avec un bloc replié
      ✅ **Attendu** : les tâches repliées ne sont **pas** sélectionnées (comme des sous-tâches repliées)
- [ ] Naviguer au clavier (`j` / `k`) : ✅ **Attendu** : la sélection **saute** les en-têtes
- [ ] Vérifier dans un **projet normal** (pas un recueil) : ✅ **Attendu** : **aucun** en-tête de ce type
- [ ] Recueil avec **beaucoup** de tâches (50+) : ✅ **Attendu** : le défilement reste fluide et
      la barre de défilement ne saute pas

#### Gantt et Tableau [N]

> **Nouveau en 2.9.0** : les mêmes en-têtes pliables dans les trois vues.

- [ ] Basculer le recueil en vue **Gantt** : ✅ **Attendu** : un en-tête par projet, sur **sa propre ligne**,
      avec une bande discrète en travers de la frise
- [ ] ✅ **Attendu** : les barres restent **alignées** avec leurs libellés, en-têtes comprises
- [ ] Plier un projet dans le Gantt : ✅ **Attendu** : ses barres disparaissent, les lignes du dessous **remontent**
      et restent alignées
- [ ] Avec des **dépendances** entre tâches : ✅ **Attendu** : les flèches pointent toujours sur la bonne barre
- [ ] Avec un **jalon** : ✅ **Attendu** : son trait pointillé et son étiquette sont à la bonne date ;
      une fois son projet **plié**, le trait **disparaît** *(il ne montrerait plus rien)*
- [ ] Basculer en vue **Tableau** (kanban) : ✅ **Attendu** : les statuts sont nommés **une seule fois**, en haut,
      puis **une bande par projet** traversant toute la largeur
- [ ] ✅ **Attendu** : les colonnes d'une bande sont **alignées** avec les en-têtes de statut du haut
- [ ] Plier un projet dans le Tableau : ✅ **Attendu** : toute sa bande se referme
- [ ] **Glisser une carte** d'une colonne à l'autre **dans sa bande** : ✅ **Attendu** : le statut change
- [ ] **Glisser une carte dans la bande d'un autre projet**
      ✅ **Attendu** : seul le **statut** change, la carte **revient dans son projet** *(un déplacement entre
      projets déplace des fichiers : c'est trop pour un glisser-déposer)*
- [ ] **Cohérence entre vues** : plier un projet dans le tableur, passer au Gantt puis au Tableau
      ✅ **Attendu** : il y est **plié aussi** — c'est un seul recueil
- [ ] Dans un **projet normal** (pas un recueil), Gantt et Tableau : ✅ **Attendu** : **aucun** en-tête de ce type

### Pièges à vérifier

- [ ] Sur un recueil **non vide sans filtre actif**, la pastille propose une entrée **grisée** invitant à filtrer d'abord
      ✅ **Attendu** : impossible d'enregistrer un filtre vide comme règle *(ça attraperait tout le coffre)*
- [ ] Sur un recueil **vide**, la pastille explique quoi faire : ajouter des tâches depuis leur projet,
      ou filtrer une vue et l'enregistrer comme recueil
      ✅ **Attendu** : pas d'invitation à filtrer une vue qui n'a rien à filtrer
- [ ] Dans une vue **sans filtre actif**, la pastille de portée ne propose **pas** « Enregistrer comme recueil… »
- [ ] Ajouter au recueil **une tâche parente et l'une de ses sous-tâches**
      ✅ **Attendu** : la sous-tâche apparaît **une seule fois**, sous son parent — pas en double
- [ ] Ajouter **une sous-tâche seule**, sans son parent
      ✅ **Attendu** : elle s'affiche comme une ligne de premier niveau
- [ ] **Supprimer** une tâche membre depuis son projet
      ✅ **Attendu** : le recueil ne casse pas, la ligne disparaît simplement
- [ ] **Supprimer le recueil** (clic droit dans le tableau de bord)
      ✅ **Attendu** : confirmation demandée, puis ✅ **les tâches rassemblées sont intactes**
- [ ] Écrire du texte à la main dans le corps de la note du recueil, puis ajouter une tâche
      ✅ **Attendu** : le texte survit (même protection que les notes de projet)
- [ ] Ouvrir la note du recueil : ✅ **Attendu** : elle contient la **définition** (règle, `include`, `exclude`),
      et **pas** la liste des tâches actuellement retenues *(elle changerait sans arrêt)*

**Constaté :**

---

## 7ter. Lots [N]

> **Nouveau en 2.10.0** : un **lot** est un quatrième type de ticket. Il rassemble des
> tâches **dans** un projet — lot 1, lot 2 — sans en faire des sous-tâches.

### Création et remplissage

- [ ] Dans un projet, barre d'outils → **« + ajouter une tâche »**, puis champ **Type → « Lot »**, le nommer « Lot 1 »
- [ ] ✅ **Attendu** : la barre d'outils n'a **qu'un** bouton d'ajout — ni « + lot », ni « + jalon » séparés
- [ ] ✅ **Attendu** : une note est créée comme pour une tâche, avec `type: phase` dans son frontmatter
- [ ] ✅ **Attendu** : dans le tableur, le lot est un **en-tête sur toute la largeur**, pas une ligne de tâche
- [ ] Ouvrir une tâche existante : ✅ **Attendu** : le champ **« Lot »** est proposé (il n'apparaît que si le projet a des lots)
- [ ] Y choisir « Lot 1 » : ✅ **Attendu** : la tâche passe **sous l'en-tête**, **sans indentation**
- [ ] ✅ **Attendu** : son type **reste « Tâche »** — elle n'est pas devenue une sous-tâche
- [ ] Cliquer le **+** de l'en-tête du lot : ✅ **Attendu** : la nouvelle tâche est créée **dans le lot**
- [ ] Une tâche du lot qui a ses **propres sous-tâches** : ✅ **Attendu** : elles s'indentent sous elle, comme d'habitude
- [ ] Créer un **lot dans un lot** : ✅ **Attendu** : son en-tête est **décalé vers la droite**
- [ ] ✅ **Attendu** : les tâches du lot 1 sont décalées d'un cran, celles du lot 2 d'un cran de plus —
      l'imbrication se lit à l'indentation
- [ ] ✅ **Attendu** : une **sous-tâche** d'une tâche du lot 2 est décalée d'un cran encore
- [ ] Vue **Gantt** : ✅ **Attendu** : même escalier dans la colonne des libellés
- [ ] Vue **Tableau** : ✅ **Attendu** : la bande du lot 2 est décalée sous celle du lot 1
- [ ] Le **chevron** de l'en-tête plie le lot ; rouvrir le projet : ✅ **Attendu** : il est **toujours plié**

### Dates et avancement

- [ ] Laisser les dates du lot **vides**, dater ses tâches
      ✅ **Attendu** : l'en-tête annonce la **période couverte** (première date de début → dernière échéance)
- [ ] ✅ **Attendu** : le pourcentage de l'en-tête est la **moyenne** de ses tâches, une tâche terminée comptant pour 100
- [ ] Marquer une tâche **Terminé** : ✅ **Attendu** : le pourcentage du lot monte
- [ ] Vue **Gantt** : ✅ **Attendu** : le lot a une **barre récapitulative** (un crochet plat) qui couvre ses tâches
- [ ] Saisir des dates **sur le lot** (ex. janvier → février) alors que ses tâches vont jusqu'en mars
      ✅ **Attendu** : le crochet suit **les dates saisies**, et un **trait fin** dessous montre la période réelle
- [ ] ✅ **Attendu** : la partie qui **déborde** des dates annoncées est marquée à part (en rouge)
- [ ] Effacer les dates du lot : ✅ **Attendu** : on revient à la période calculée, sans marque de dépassement
- [ ] Un lot **vide** : ✅ **Attendu** : « 0 tâche », aucune barre, et rien qui plante

### Filtres et vues

- [ ] Filtrer sur une étiquette que porte **une seule** tâche du lot
      ✅ **Attendu** : l'en-tête du lot **reste**, avec cette tâche dessous — on voit toujours de quel lot elle est
- [ ] Filtrer sur quelque chose qu'**aucune** tâche du lot ne porte : ✅ **Attendu** : **l'en-tête disparaît aussi**
- [ ] ✅ **Attendu** : une tâche filtrée n'est **jamais sortie de son lot** pour être remontée à la racine
- [ ] Vue **Tableau** (kanban) : ✅ **Attendu** : les statuts sont nommés **une seule fois en haut**,
      puis **une bande par lot** qui traverse toutes les colonnes
- [ ] ✅ **Attendu** : les colonnes des bandes sont **alignées** avec les en-têtes du haut, y compris après
      un défilement horizontal
- [ ] ✅ **Attendu** : le nom du lot **reste visible** quand on fait défiler la planche vers la droite
- [ ] ✅ **Attendu** : la première bande, **« Hors lot »**, rassemble les tâches qui ne sont dans aucun lot
- [ ] ✅ **Attendu** : le lot **n'a pas de carte à lui**
- [ ] ✅ **Attendu** : le compteur d'une bande compte **tout le lot** ; celui d'un en-tête de statut, en haut,
      compte cette colonne **toutes bandes confondues**
- [ ] ✅ **Attendu** : une colonne **vide** d'une bande reste assez haute pour y déposer une carte
- [ ] Plier un lot dans le kanban : ✅ **Attendu** : **toute sa bande** se referme, l'en-tête restant visible
- [ ] **Glisser une carte vers une autre colonne de sa bande** : ✅ **Attendu** : seul le **statut** change
- [ ] **[N]** **Glisser une carte dans la bande d'un autre lot**
      ✅ **Attendu** : elle **change de lot** — et de statut si la colonne diffère aussi
- [ ] **[N]** **Glisser une carte dans la bande « Hors lot »** : ✅ **Attendu** : elle **quitte son lot**
- [ ] **[N]** Vérifier dans le **tableur** : ✅ **Attendu** : elle est bien sous le nouveau lot
- [ ] **[N]** Un **projet sans aucun lot** : ✅ **Attendu** : le kanban est **inchangé** — colonnes pleine hauteur,
      chacune avec son propre en-tête, aucune bande
- [ ] Cocher **« tout sélectionner »** dans le tableur : ✅ **Attendu** : les lots ne sont **pas** sélectionnés
- [ ] Naviguer au clavier (`j` / `k`) : ✅ **Attendu** : la sélection **saute** les en-têtes de lot

### Dépendances et suppression

- [ ] Faire dépendre une tâche **du lot** (dépendance vers le lot)
      ✅ **Attendu** : elle est repoussée après la **fin réelle** du lot
- [ ] Décaler une tâche **dans** le lot : ✅ **Attendu** : le lot n'est **jamais déplacé** par l'ordonnanceur,
      sa barre suit simplement ses tâches
- [ ] **Supprimer un lot** qui contient des tâches
      ✅ **Attendu** : la confirmation est **en français** et dit **combien de tâches** partent avec lui
- [ ] Refuser : ✅ **Attendu** : rien n'est supprimé
- [ ] Supprimer une **tâche** ordinaire : ✅ **Attendu** : la confirmation est aussi en français

**Constaté :**

---

## 7quater. Bibliothèque documentaire [N]

> **Nouveau en 2.13.0** : un cinquième type de ticket, **Document**. Une note qui porte un
> fichier (Word, PDF, plan), ses versions et ses visas. Elle vit à la fois dans le
> **plan** (tableur, Gantt, tableau) et dans la nouvelle vue **Bibliothèque**.

### Créer un document

- [ ] Déposer un PDF quelque part dans le coffre (hors projet), pour servir de matière
- [ ] **« + ajouter une tâche »** → **Type → « Document »**, le nommer « Plan de masse », échéance dans le passé
- [ ] ✅ **Attendu** : un panneau **« Document »** apparaît dans l'éditeur, sous le suivi du temps
- [ ] Remplir **Référence** (PL-001), **Indice** (A), **Émetteur**, **Destinataire**, **Phase**
- [ ] ✅ **Attendu** : la note de tâche contient un bloc `document:` dans son frontmatter, avec `type: document`
- [ ] Quatrième icône de vue → **Bibliothèque** : ✅ **Attendu** : le document y est, état **« Attendu »**
- [ ] ✅ **Attendu** : dans le **tableur**, la même tâche porte une pastille **D** grise
- [ ] ✅ **Attendu** : son échéance passée s'affiche **en rouge** dans la bibliothèque

### Déposer un fichier, et le versionner

- [ ] Panneau Document → bouton **↑** → choisir le PDF → **« Copier le fichier dans le projet »**,
      saisir une note (« première diffusion »)
- [ ] ✅ **Attendu** : le fichier est **copié** dans `<projet>/_docs/`, l'original reste où il était
- [ ] ✅ **Attendu** : l'état passe tout seul à **« Reçu »**, et le statut de la tâche suit
- [ ] ✅ **Attendu** : la version **v1** apparaît dans le panneau et dans la bibliothèque
- [ ] Déposer un **second** fichier sur le même document
- [ ] ✅ **Attendu** : le fichier courant **garde le même chemin** — un lien vers lui reste bon
- [ ] ✅ **Attendu** : l'ancien est déplacé dans `<projet>/_docs/_versions/` avec `-v1` dans son nom
- [ ] ✅ **Attendu** : **aucun fichier n'a été écrasé** — ouvrir les deux pour le vérifier
- [ ] Cliquer la pastille **v2** dans la bibliothèque → choisir **v1**
- [ ] ✅ **Attendu** : v1 redevient le fichier courant, **en tant que v3** — l'historique dit ce qui s'est passé
- [ ] Cliquer le nom du fichier : ✅ **Attendu** : un PDF s'ouvre dans un onglet ; un `.docx` part dans
      l'application système *(et sur mobile, un message dit que ce n'est pas possible)*
- [ ] **« Le référencer sur place »** sur un fichier hors du projet
      ✅ **Attendu** : il **n'est pas déplacé**, et la pastille porte une icône de lien
- [ ] Déposer ensuite une vraie version sur ce document
      ✅ **Attendu** : le fichier référencé **n'a pas bougé** — il n'appartenait pas au projet

### Cycle de vie et visas

- [ ] Ajouter deux **approbateurs** dans le panneau Document
- [ ] ✅ **Attendu** : la bibliothèque montre deux pastilles grises dans la colonne **Visas**
- [ ] Clic sur la première → **Viser** : ✅ **Attendu** : elle passe au vert, l'état reste **« En revue »**
- [ ] ✅ **Attendu** : le panneau indique **« En attente de … »** pour le second
- [ ] Viser avec le second : ✅ **Attendu** : l'état passe à **« Validé »** et **le statut de la tâche
      passe à terminé** *(l'avancement du projet en tient compte)*
- [ ] Clic droit sur la ligne → **« Remettre en revue »**
      ✅ **Attendu** : l'état revient à « En revue » et **les visas sont effacés** *(un visa signe une version)*
- [ ] Refaire viser l'un des deux, puis **Refuser** avec l'autre, avec un motif
      ✅ **Attendu** : l'état reste « En revue » — **un refus l'emporte**, et le motif se lit dans l'info-bulle
- [ ] Clic droit → **« Marquer obsolète »** : ✅ **Attendu** : l'état passe à Obsolète et le statut suit
      *(annulé, si votre palette a un statut d'abandon)*

### Relances et bordereau

- [ ] Avoir deux documents **attendus** dont la date est passée
- [ ] ✅ **Attendu** : la bibliothèque affiche une pastille rouge comptant les documents en retard
- [ ] **Palette de commandes → « Documents attendus »**
      ✅ **Attendu** : la liste s'ouvre, **du plus ancien au plus récent** ; en choisir un ouvre sa fiche
- [ ] Sans aucun retard : ✅ **Attendu** : la commande dit qu'il n'y a rien d'attendu
- [ ] Cocher deux documents dans la bibliothèque → **« Bordereau »**
- [ ] ✅ **Attendu** : une note est créée dans le dossier du projet, avec un tableau
      référence / titre / indice / version / date / destinataire
- [ ] ✅ **Attendu** : les lignes sont **triées par référence**
- [ ] Sans rien cocher : ✅ **Attendu** : un message demande d'en choisir au moins un

### Filtres, états et pièges

- [ ] Les **pastilles d'état** en haut de la bibliothèque filtrent la liste ; recliquer la même la libère
- [ ] La **barre de recherche** du projet filtre aussi la bibliothèque
- [ ] Un document **dans un lot** : ✅ **Attendu** : il apparaît dans la bande du lot sur le tableau
- [ ] **Supprimer le fichier** d'un document depuis l'explorateur Obsidian, revenir à la bibliothèque
      ✅ **Attendu** : la pastille dit **« Fichier introuvable »**, barrée — rien ne plante
- [ ] **Supprimer la tâche** d'un document : ✅ **Attendu** : la note part, **les fichiers restent**
      dans `_docs/` *(c'est voulu : ils vous appartiennent)*
- [ ] Éditer à la main le bloc `document:` d'une note (retirer des champs, écrire un état inconnu)
      ✅ **Attendu** : le document se relit sans erreur, l'état inconnu retombe sur **« Attendu »**
- [ ] Un projet **sans aucun document** : ✅ **Attendu** : la bibliothèque explique comment en créer un

**Constaté :**

---

## 8. Robustesse

- [ ] Créer deux tâches portant **exactement le même titre** dans un même projet
      ✅ **Attendu** : un message clair, pas une erreur silencieuse
- [ ] Renommer un projet : ses tâches suivent, les liens restent valides
- [ ] Déplacer un dossier de projet dans le coffre : le plugin s'y retrouve
- [ ] Éditer une note de tâche à la main puis revenir dans Black Projects : les modifications sont reprises
- [ ] Supprimer une note de tâche depuis l'explorateur Obsidian : le projet ne casse pas
- [ ] Sur un projet d'une **cinquantaine de tâches** : l'ouverture des vues reste fluide
- [ ] Fermer et rouvrir Obsidian : tout est retrouvé, aucune erreur en console

**Constaté :**

---

## 9. Limites connues — ne pas signaler comme bugs

Ce sont des manques identifiés, pas des régressions.

- [ ] *Vérifié* : sur **mobile ou tablette**, le glisser-déposer du kanban et du Gantt ne
      répond pas au doigt. Le module utilise le drag HTML5 et des événements souris ;
      aucun support tactile n'existe, ni dans le fork ni en amont.
- [ ] *Vérifié* : les **notifications d'échéance** ne sont que des bandeaux internes à
      Obsidian, vérifiés une fois par heure, et seulement si Obsidian est ouvert.
- [ ] *Vérifié* : la fenêtre d'**annulation** est limitée à 20 actions et se vide au rechargement.
- [ ] *Vérifié* : l'ordonnanceur n'a **ni chemin critique, ni marge, ni nivellement de charge**.
- [ ] *Vérifié* : on ne peut pas **glisser-déposer** une tâche dans un lot ; on passe par le champ
      **« Lot »** de son éditeur, ou par le **+** de l'en-tête du lot.
- [ ] *Vérifié* : la bibliothèque **ne lit pas l'intérieur** des fichiers : pas de recherche plein texte
      dans un PDF ni dans un Word, seulement dans les champs du document.
- [ ] *Vérifié* : le champ **« déposé par »** d'une version prend le premier membre de l'équipe du projet ;
      sans équipe renseignée, il reste vide.
- [ ] *Vérifié* : dans le tableur, un tri (par échéance, par statut…) **réordonne aussi les lots**
      entre eux, d'après les dates que le lot déclare — pas d'après la période de ses tâches.

---

## Bilan

| Section | État | Remarques |
| --- | --- | --- |
| 0. Installation | | |
| 1. Bases (régression) | | |
| 2. Contenu libre | | |
| 3. Cycles | | |
| 4. Jours ouvrés | | |
| 5. Récurrence | | |
| 6. Dépendances typées | | |
| 7. Français | | |
| 7bis. Recueils | | |
| 7ter. Lots | | |
| 7quater. Bibliothèque | | |
| 8. Robustesse | | |

**Anomalies bloquantes :**

**Anomalies mineures :**

**Verdict :**

---

## Pour la prochaine version

Dupliquez cette note, mettez à jour `version` dans le frontmatter, videz les cases et
les champs « Constaté ». Les sections 1 et 8 sont le **socle de non-régression** : à
repasser à chaque version, y compris après chaque fusion avec l'upstream. Les sections
2 à 7quater ne concernent que les nouveautés — elles deviennent à leur tour des tests de
non-régression pour les versions suivantes.
