---
type: recette
module: dotpm FR
version: 2.4.0
date_recette:
testeur:
---

# Recette — dotpm FR 2.4.0

Plan de test manuel pour le fork. Les **516 tests automatisés** couvrent la logique
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

- [ ] **[R]** L'ancien plugin **dotpm** est désactivé dans Obsidian avant d'activer celui-ci
- [ ] Le dossier `<coffre>/.obsidian/plugins/dotpm-fr/` contient bien `main.js`, `manifest.json`, `styles.css`
- [ ] **dotpm FR** apparaît dans la liste des modules et s'active sans erreur
- [ ] La console développeur (`Ctrl/Cmd+Maj+I`) ne montre **aucune erreur rouge** au démarrage
- [ ] Après avoir copié l'ancien `data.json`, les statuts, priorités et champs personnalisés sont bien ceux d'avant
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
- [ ] Revenir dans dotpm, ouvrir la tâche **A** et **l'enregistrer**
- [ ] ✅ **Attendu** : une notification annonce que des tâches dépendent les unes des autres en boucle, **en nommant A et B**
- [ ] ✅ **Attendu** : la console contient une ligne `[dotpm] Dependency cycle` avec les identifiants
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

- [ ] `Réglages` → `dotpm FR` → section **Planification**
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

- [ ] `Réglages` → `dotpm FR` → **Général** → le réglage **« Langue »** existe
- [ ] Sur **« Comme Obsidian »**, avec Obsidian en français : l'interface est **en français**
- [ ] Forcer **English** : l'interface repasse en anglais (rouvrir les vues si besoin)
- [ ] Forcer **Français** avec Obsidian en anglais : l'interface reste **en français**

### Là où il faut vraiment regarder

- [ ] **Palette de commandes** : toutes les commandes dotpm sont en français
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

## 8. Robustesse

- [ ] Créer deux tâches portant **exactement le même titre** dans un même projet
      ✅ **Attendu** : un message clair, pas une erreur silencieuse
- [ ] Renommer un projet : ses tâches suivent, les liens restent valides
- [ ] Déplacer un dossier de projet dans le coffre : le plugin s'y retrouve
- [ ] Éditer une note de tâche à la main puis revenir dans dotpm : les modifications sont reprises
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
| 8. Robustesse | | |

**Anomalies bloquantes :**

**Anomalies mineures :**

**Verdict :**

---

## Pour la prochaine version

Dupliquez cette note, mettez à jour `version` dans le frontmatter, videz les cases et
les champs « Constaté ». Les sections 1 et 8 sont le **socle de non-régression** : à
repasser à chaque version, y compris après chaque fusion avec l'upstream. Les sections
2 à 7 ne concernent que les nouveautés de la 2.4.0 — elles deviendront elles-mêmes
des tests de non-régression pour la suite.
