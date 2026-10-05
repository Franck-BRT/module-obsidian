import { makeDocument, makeTask, type Task, type TaskDecision, type TaskReserve } from '../../types'
import { para, type DocxDocument } from '../../store/docx'
import { addDays } from '../../store/Metrics'

/**
 * What the demonstration holds: two projects of a builder's year — a building under way
 * and a technical centre starting —, dated from today so that what it shows is always
 * true: work running late, a reminder left unanswered, a decision overdue, a meeting the
 * day after tomorrow, a calculation note to review that breaks the specification twice.
 * Every name is invented; every address ends in `.example`.
 */

export const DEMO_PREFIX = 'Démo — '
export const DEMO_B12 = `${DEMO_PREFIX}Bâtiment B12`
export const DEMO_C7 = `${DEMO_PREFIX}Centre technique C7`

export interface DemoContact {
  name: string
  kind: 'person' | 'company'
  company?: string
  role: string
  email?: string
  phone?: string
  lots?: string[]
  capacity?: number
}

export const DEMO_CONTACTS: DemoContact[] = [
  { name: 'Anne Leroy', kind: 'person', role: 'Cheffe de projet', email: 'anne.leroy@moe.example', capacity: 28 },
  { name: 'Paul Martin', kind: 'person', role: 'Conducteur d’opération', email: 'paul.martin@moe.example' },
  {
    name: 'Garonne Bâtiment',
    kind: 'company',
    role: 'Gros œuvre',
    email: 'contact@garonne-batiment.example',
    phone: '05 61 00 00 01',
    lots: ['Lot 02 Gros œuvre']
  },
  {
    name: 'Julien Garcia',
    kind: 'person',
    company: 'Garonne Bâtiment',
    role: 'Chef de chantier',
    email: 'j.garcia@garonne-batiment.example'
  },
  {
    name: 'Électricité Sud',
    kind: 'company',
    role: 'Électricité CFO / CFA',
    email: 'etudes@elec-sud.example',
    lots: ['Lot 08 Électricité']
  },
  {
    name: 'Terrassements du Lauragais',
    kind: 'company',
    role: 'Terrassements',
    email: 'chantiers@tp-lauragais.example',
    lots: ['Lot 01 Terrassements']
  },
  { name: 'Bureau Structure Ouest', kind: 'company', role: 'Bureau d’études structure', email: 'contact@bso.example' }
]

export interface DemoRequirement {
  id: string
  title: string
  text: string
}

/** Ids of their own, outside any numbering a reader keeps, so none of theirs is burnt. */
export const DEMO_REQUIREMENTS: DemoRequirement[] = [
  {
    id: 'DEMO-GO-001',
    title: 'Classe des bétons du radier',
    text: 'Les bétons du radier sont de classe de résistance C30/37 au minimum et de classe d’exposition XC2.'
  },
  {
    id: 'DEMO-GO-002',
    title: 'Enrobage des armatures du radier',
    text: 'L’enrobage nominal des armatures du radier est d’au moins 40 mm sur toutes les faces.'
  },
  {
    id: 'DEMO-GO-003',
    title: 'Charges d’exploitation des locaux techniques',
    text: 'Les planchers des locaux techniques sont dimensionnés pour une charge d’exploitation de 5 kN/m².'
  }
]

/** The specification the calculation note is read against. */
export function cctpDocument(): DocxDocument {
  return {
    title: 'CCTP Lot 02 — Gros œuvre',
    blocks: [
      para('Title', 'Cahier des clauses techniques particulières — Lot 02 Gros œuvre'),
      para('Meta', 'Opération : Bâtiment B12 — Démonstration Black Projects — Indice B'),
      para('Heading1', 'Article 1 — Objet'),
      para(
        'Normal',
        'Le présent CCTP définit les travaux de gros œuvre du bâtiment B12 : fondations, radier, voiles, poteaux, poutres et planchers.'
      ),
      para('Heading1', 'Article 3 — Bétons et armatures'),
      para('Heading2', 'Article 3.2 — Classes de béton'),
      para(
        'Normal',
        'Les bétons du radier et des fondations sont de classe de résistance C30/37 et de classe d’exposition XC2, conformément à la norme NF EN 206/CN. Les voiles et planchers sont en C25/30 XC1.'
      ),
      para('Heading2', 'Article 3.4 — Enrobages'),
      para(
        'Normal',
        'L’enrobage nominal des armatures est de 40 mm pour le radier et les fondations, de 30 mm pour les voiles et de 25 mm pour les planchers.'
      ),
      para('Heading1', 'Article 4 — Hypothèses de calcul'),
      para('Heading2', 'Article 4.1 — Charges d’exploitation'),
      para(
        'Normal',
        'Les charges d’exploitation à retenir sont : bureaux 2,5 kN/m², circulations 4 kN/m², locaux techniques 5 kN/m².'
      ),
      para('Heading2', 'Article 4.3 — Notes de calcul'),
      para(
        'Normal',
        'Chaque note de calcul rappelle les hypothèses retenues, les matériaux, les charges et les combinaisons. Elle est soumise au visa de la maîtrise d’œuvre avant toute exécution.'
      )
    ]
  }
}

/**
 * The contractor's calculation note: at issue B wrong twice and short of a justification
 * once; at issue C the concrete and the loads put right, the cover only in part.
 */
export function calculationNote(issue: string): DocxDocument {
  const second = issue !== 'B'
  return {
    title: `NDC-04 — Note de calcul du radier — indice ${issue}`,
    blocks: [
      para('Title', 'Note de calcul — Radier du bâtiment B12'),
      para('Meta', `Référence NDC-04 — Indice ${issue} — Bureau Structure Ouest pour Garonne Bâtiment`),
      para('Heading1', '1. Objet'),
      para('Normal', 'La présente note justifie le dimensionnement du radier général du bâtiment B12.'),
      para('Heading1', '2. Matériaux'),
      para('Heading2', '2.1 Béton'),
      para(
        'Normal',
        second
          ? 'Béton de classe C30/37, classe d’exposition XC2, Dmax 20 mm, conformément au CCTP.'
          : 'Béton de classe C25/30, classe d’exposition XC1, Dmax 20 mm.'
      ),
      para('Heading2', '2.2 Aciers'),
      para('Normal', 'Aciers à haute adhérence B500B.'),
      para('Heading2', '2.3 Enrobages'),
      para(
        'Normal',
        second
          ? 'Enrobage nominal retenu : 40 mm en sous-face, 35 mm en rive et sur les faces latérales des nervures.'
          : 'Enrobage nominal retenu : 30 mm en sous-face et en sous-face des nervures.'
      ),
      para('Heading1', '3. Hypothèses géotechniques'),
      para('Normal', 'Contrainte admissible du sol : 0,25 MPa d’après le rapport G2 AVP.'),
      para('Heading1', '4. Charges'),
      para(
        'Normal',
        second
          ? 'Charges permanentes : poids propre et superstructure. Charges d’exploitation : 2,5 kN/m² pour les bureaux, 5 kN/m² pour les locaux techniques.'
          : 'Charges permanentes : poids propre et superstructure. Charge d’exploitation : 2,5 kN/m² sur l’ensemble des planchers, locaux techniques compris.'
      ),
      para('Heading1', '5. Résultats'),
      para(
        'Normal',
        'Épaisseur du radier : 40 cm. Ferraillage : HA14 e = 15 cm dans les deux directions, nappes inférieure et supérieure.'
      )
    ]
  }
}

/** A statement of work in English, to try the translation on. */
export function englishSow(): DocxDocument {
  return {
    title: 'Statement of work — Site maintenance',
    blocks: [
      para('Title', 'Statement of work — Site maintenance of building B12'),
      para('Heading1', '1. Scope'),
      para(
        'Normal',
        'The contractor shall provide preventive and corrective maintenance of the technical installations of building B12 for a period of three years.'
      ),
      para('Heading1', '2. Deliverables'),
      para('Bullet', 'A maintenance plan, delivered within four weeks of the notice to proceed.'),
      para('Bullet', 'A monthly report on the interventions carried out and the faults found.'),
      para('Bullet', 'An updated inventory of the equipment at the end of each year.'),
      para('Heading1', '3. Response times'),
      para(
        'Normal',
        'A blocking fault shall be handled within four hours, any other fault within two working days. The contractor should propose a hotline available on working days from 8 am to 6 pm.'
      )
    ]
  }
}

const decision = (over: Partial<TaskDecision>): TaskDecision => ({
  state: 'decided',
  date: '',
  decidedBy: '',
  rationale: '',
  affects: [],
  ...over
})

const reserve = (over: Partial<TaskReserve>): TaskReserve => ({
  number: '',
  phase: 'reception',
  location: '',
  lot: 'Lot 01 Terrassements',
  severity: 'minor',
  state: 'open',
  raisedOn: '',
  declaredOn: '',
  liftedOn: '',
  photos: [],
  chases: [],
  ...over
})

/** The building's tickets, as of today: lots with their work, milestones, risks, decisions, meetings, documents. */
export function b12Tasks(today: string): Task[] {
  const d = (days: number): string => addDays(today, days)
  const done = { status: 'done', progress: 100 }
  return [
    makeTask({
      title: 'Lot 01 — Terrassements',
      type: 'phase',
      start: d(-45),
      due: d(-20),
      subtasks: [
        makeTask({
          title: 'Décapage',
          start: d(-45),
          due: d(-38),
          ...done,
          completed: d(-38),
          assignees: ['Paul Martin']
        }),
        makeTask({
          title: 'Fouilles en masse',
          start: d(-37),
          due: d(-24),
          ...done,
          completed: d(-22),
          timeEstimate: 30,
          assignees: ['Paul Martin']
        })
      ]
    }),
    makeTask({
      title: 'Lot 02 — Gros œuvre',
      type: 'phase',
      start: d(-18),
      due: d(50),
      subtasks: [
        makeTask({
          title: 'Coffrage du radier',
          start: d(-15),
          due: d(-3),
          status: 'in-progress',
          progress: 70,
          timeEstimate: 40,
          assignees: ['Paul Martin']
        }),
        makeTask({
          title: 'Ferraillage du radier',
          start: d(-5),
          due: d(6),
          status: 'in-progress',
          progress: 30,
          timeEstimate: 60,
          assignees: ['Garonne Bâtiment']
        }),
        makeTask({ title: 'Coulage du radier', start: d(7), due: d(11), assignees: ['Garonne Bâtiment'] }),
        makeTask({
          title: 'Voiles du rez-de-chaussée',
          start: d(14),
          due: d(35),
          timeEstimate: 120,
          assignees: ['Garonne Bâtiment']
        }),
        makeTask({
          title: 'Plancher haut du rez-de-chaussée',
          start: d(36),
          due: d(50),
          assignees: ['Garonne Bâtiment']
        }),
        makeTask({
          title: 'Suivi des bétonnages',
          start: d(1),
          due: d(12),
          timeEstimate: 24,
          assignees: ['Paul Martin']
        })
      ]
    }),
    makeTask({
      title: 'Lot 08 — Électricité',
      type: 'phase',
      start: d(-10),
      due: d(20),
      subtasks: [
        makeTask({
          title: 'Réservations électriques du radier',
          start: d(-10),
          due: d(-2),
          status: 'in-progress',
          progress: 50,
          timeEstimate: 16,
          assignees: ['Anne Leroy']
        }),
        makeTask({ title: 'Schéma unifilaire', start: d(3), due: d(15), assignees: ['Électricité Sud'] })
      ]
    }),
    makeTask({ title: 'Démarrage du chantier', type: 'milestone', start: '', due: d(-45), ...done, completed: d(-45) }),
    makeTask({ title: 'Réception des fonds de fouille', type: 'milestone', start: '', due: d(-20) }),
    makeTask({ title: 'Radier coulé', type: 'milestone', start: '', due: d(11) }),
    makeTask({ title: 'Hors d’eau', type: 'milestone', start: '', due: d(75) }),
    makeTask({
      title: 'Retard de livraison du béton (centrale en panne)',
      type: 'risk',
      start: '',
      due: d(5),
      assignees: ['Paul Martin'],
      risk: { probability: 3, impact: 4, mitigation: 'Seconde centrale agréée en secours' }
    }),
    makeTask({
      title: 'Accès chantier bloqué par les travaux de voirie',
      type: 'risk',
      start: '',
      assignees: ['Anne Leroy'],
      risk: { probability: 4, impact: 4, mitigation: '' }
    }),
    makeTask({
      title: 'Gel pendant le coulage du radier',
      type: 'risk',
      start: '',
      risk: { probability: 2, impact: 3, mitigation: 'Adjuvants antigel, bâches chauffantes' }
    }),
    makeTask({
      title: 'Pollution des terres excavées',
      type: 'risk',
      start: '',
      risk: { probability: 2, impact: 4, mitigation: 'Diagnostic de sol complémentaire' }
    }),
    makeTask({
      title: 'Seconde centrale à béton agréée en secours',
      type: 'decision',
      start: '',
      ...done,
      decision: decision({
        date: d(-17),
        decidedBy: 'Maîtrise d’œuvre',
        rationale: 'La centrale principale est tombée en panne deux fois le mois dernier.'
      })
    }),
    makeTask({
      title: 'Report de la réception des fonds de fouille d’une semaine',
      type: 'decision',
      start: '',
      ...done,
      decision: decision({ date: d(-8), decidedBy: 'COPIL', rationale: 'Purge d’une poche d’argile non prévue.' })
    }),
    makeTask({
      title: 'Choix du revêtement de façade',
      type: 'decision',
      start: '',
      due: d(-2),
      decision: decision({ state: 'proposed', decidedBy: 'Maîtrise d’ouvrage' })
    }),
    // The reserves of the excavation's handover, twenty days ago: one late and chased, one said lifted, one lifted.
    makeTask({
      title: 'Remblai insuffisamment compacté en pied de talus',
      type: 'reserve',
      start: '',
      due: d(-5),
      assignees: ['Terrassements du Lauragais'],
      reserve: reserve({
        number: 'R-001',
        location: 'Talus nord',
        severity: 'major',
        raisedOn: d(-20),
        chases: [d(-3)]
      })
    }),
    makeTask({
      title: 'Regard d’eaux pluviales non dégagé',
      type: 'reserve',
      start: '',
      due: d(5),
      assignees: ['Terrassements du Lauragais'],
      reserve: reserve({
        number: 'R-002',
        location: 'Angle sud-est',
        state: 'declared',
        raisedOn: d(-20),
        declaredOn: d(-1)
      })
    }),
    makeTask({
      title: 'Déblais excédentaires à évacuer',
      type: 'reserve',
      start: '',
      due: d(-6),
      status: 'done',
      progress: 100,
      completed: d(-8),
      assignees: ['Terrassements du Lauragais'],
      reserve: reserve({
        number: 'R-003',
        location: 'Zone de stockage ouest',
        state: 'lifted',
        raisedOn: d(-20),
        declaredOn: d(-10),
        liftedOn: d(-8)
      })
    }),
    makeTask({
      title: 'Fourreau d’attente oublié en fond de fouille',
      type: 'reserve',
      start: '',
      due: d(4),
      assignees: ['Garonne Bâtiment'],
      reserve: reserve({
        number: 'R-004',
        location: 'Fond de fouille, file C',
        lot: 'Lot 02 Gros œuvre',
        severity: 'blocking',
        raisedOn: d(-20)
      })
    }),
    makeTask({
      title: 'Réunion de chantier n°4',
      type: 'meeting',
      meetingKind: 'coordination',
      start: '',
      due: d(-7),
      startTime: '09:00',
      endTime: '11:00',
      ...done,
      assignees: ['Anne Leroy', 'Paul Martin', 'Julien Garcia'],
      subtasks: [
        makeTask({
          title: 'Fournir le plan de réservations',
          type: 'subtask',
          start: '',
          due: d(3),
          assignees: ['Julien Garcia']
        }),
        makeTask({
          title: 'Valider l’échantillon de façade',
          type: 'subtask',
          start: '',
          ...done,
          assignees: ['Anne Leroy']
        })
      ]
    }),
    makeTask({
      title: 'Réunion de chantier n°5',
      type: 'meeting',
      meetingKind: 'coordination',
      start: '',
      due: d(2),
      startTime: '09:00',
      endTime: '11:00',
      assignees: ['Anne Leroy', 'Paul Martin', 'Julien Garcia']
    }),
    makeTask({
      title: 'Plan de coffrage du radier',
      type: 'document',
      start: '',
      due: d(-14),
      document: makeDocument({ reference: 'PL-002', issue: 'B', issuer: 'Garonne Bâtiment', chases: [d(-10)] })
    }),
    makeTask({
      title: 'PPSPS électricité',
      type: 'document',
      start: '',
      due: d(10),
      document: makeDocument({ reference: 'PPSPS-08', issuer: 'Électricité Sud' })
    })
  ]
}

/** The calculation note to review, its file given once it is written. */
export function calculationTask(today: string, file: string): Task {
  return makeTask({
    title: 'Note de calcul du radier',
    type: 'document',
    start: '',
    due: addDays(today, -5),
    document: makeDocument({
      state: 'received',
      file,
      reference: 'NDC-04',
      issue: 'B',
      issuer: 'Bureau Structure Ouest',
      approvers: ['Anne Leroy', 'Paul Martin'],
      versions: [
        { version: 1, file, at: `${addDays(today, -4)}T09:00:00.000Z`, by: 'Paul Martin', note: 'Indice B reçu' }
      ]
    })
  })
}

/** A drawing received three weeks ago that nobody has signed yet: its visa is late. */
export function executionPlan(): DocxDocument {
  return {
    title: 'PEX-03 — Plan d’exécution des voiles du rez-de-chaussée — indice A',
    blocks: [
      para('Title', 'Plan d’exécution — Voiles du rez-de-chaussée'),
      para('Meta', 'Référence PEX-03 — Indice A — Garonne Bâtiment'),
      para(
        'Normal',
        'Voiles en béton C25/30 XC1, épaisseur 20 cm, enrobage 30 mm, armatures HA10 e = 20 cm en deux nappes.'
      )
    ]
  }
}

export function executionPlanTask(today: string, file: string): Task {
  return makeTask({
    title: 'Plan d’exécution des voiles',
    type: 'document',
    start: '',
    due: addDays(today, -21),
    document: makeDocument({
      state: 'received',
      file,
      reference: 'PEX-03',
      issue: 'A',
      issuer: 'Garonne Bâtiment',
      approvers: ['Paul Martin'],
      versions: [
        { version: 1, file, at: `${addDays(today, -20)}T09:00:00.000Z`, by: 'Paul Martin', note: 'Indice A reçu' }
      ]
    })
  })
}

/** The technical centre's tickets: work that, added to the building's, overloads the same people. */
export function c7Tasks(today: string): Task[] {
  const d = (days: number): string => addDays(today, days)
  return [
    makeTask({
      title: 'Études d’exécution CVC',
      start: d(3),
      due: d(14),
      timeEstimate: 50,
      assignees: ['Paul Martin']
    }),
    makeTask({ title: 'Revue de conception', start: d(7), due: d(25), assignees: ['Anne Leroy'] }),
    makeTask({ title: 'Consultation des entreprises', start: d(30), due: d(45), timeEstimate: 40 }),
    makeTask({ title: 'Lancement des études', type: 'milestone', start: '', due: d(3) })
  ]
}

/** The note that walks the reader through what to try, and where. */
export function demoGuide(): string {
  return `# Démonstration — ce qu’il y a à tester

Ce projet et le projet « ${DEMO_C7} » sont fictifs. La commande **« Supprimer le projet de démonstration »** retire tout ce qui a été créé : projets, intervenants, exigences et documents de la bibliothèque.

## Projet et tableau de bord
- [ ] Onglet **Tableau de bord** : l’état « En retard », les chiffres, la courbe, les lots, les jalons, la carte des risques.
- [ ] Bouton **PDF** du tableau de bord : le rapport d’état s’ouvre ; vérifier les deux pages.
- [ ] Onglet **Risques** : la matrice, un clic sur une case filtre la liste.
- [ ] Onglet **Décisions** : deux décisions prises, une à prendre en retard ; ouvrir une décision, ajouter ce qu’elle touche.
- [ ] Onglet **Plan de charge** : Paul Martin et Anne Leroy en rouge les semaines où le Centre technique C7 s’ajoute ; cliquer une case rouge.

## Réunions
- [ ] Ouvrir **Réunion de chantier n°5** → « Préparer l’ordre du jour » : retards, risques, actions de la réunion n°4, décisions à prendre.
- [ ] **Gérer les ordres du jour** : la réunion n°5 « à venir ».

## Documents et relances
- [ ] À l’ouverture d’Obsidian (ou commande **Relances restées sans réponse**) : Garonne Bâtiment, relancé il y a 10 jours pour le plan de coffrage ; la relance suivante est « Ferme ».
- [ ] Onglet **Documents** : la note de calcul NDC-04 indice B, reçue, en attente de deux visas.
- [ ] Sur la pastille d’Anne Leroy → **Fiche de visa assistée** : le CCTP est coché, les 3 exigences aussi ; « Analyser » doit trouver le béton C25/30 au lieu de C30/37 XC2, l’enrobage de 30 mm au lieu de 40, et la charge des locaux techniques.
- [ ] Valider : la fiche, son Word et son PDF dans « Visas », et l’avis dans le circuit.

## Délais de visa
- [ ] À l’ouverture d’Obsidian (ou commande **Visas en attente**) : le plan d’exécution PEX-03, reçu il y a 20 jours, a 5 jours de retard chez Paul Martin.
- [ ] Onglet **Documents** : sur les pastilles des viseurs, « J-11 » pour la note de calcul, le retard en rouge pour le plan d’exécution.
- [ ] Fiche du document : le **délai de visa** (15 jours par défaut, réglable par projet dans ses paramètres, ou par document) et la date d’échéance.
- [ ] Ordre du jour « Revue documentaire » : le bloc des visas en attente ; rapport d’état **PDF** : la section « Visas en attente ».

## Levée des observations (indice suivant)
- [ ] Dans la fiche du ticket « Note de calcul du radier », bouton **Déposer** : choisir **NDC-04 Note de calcul radier indice C** dans le dossier \`_inbox\` du projet, puis passer l’indice à **C**.
- [ ] **Fiche de visa assistée** de nouveau : les observations de l’indice B sont reprises ; le béton et les charges doivent ressortir « Levée », l’enrobage « Partiellement levée » (35 mm en rive).
- [ ] La fiche du ticket liste les fiches de visa par indice, avec les observations encore ouvertes.

## Réserves
- [ ] Onglet **Réserves** : quatre réserves de la réception des terrassements ; R-001 en retard (relancée il y a 3 jours), R-002 déclarée levée, R-003 levée, R-004 bloquante chez Garonne Bâtiment.
- [ ] Barre de saisie : taper une réserve, Entrée, puis une autre ; localisation, lot et entreprise restent remplis. Copier une capture d’écran, cliquer dans la barre et coller (Ctrl+V) : la photo part avec la réserve suivante.
- [ ] Cliquer l’état d’une réserve : À lever → Déclarée levée → Levée constatée (le ticket passe à « Terminé »).
- [ ] Regrouper **par lot** ou **par localisation** ; filtrer « En retard ».
- [ ] **Relancer** sur Terrassements du Lauragais : le mail liste R-001 puis R-002 ; la relance est notée.
- [ ] Ouvrir une réserve : la fiche Réserve, cliquer dans le cadre et coller une photo.
- [ ] **PV de réception** : le Word et le PDF dans le dossier « Réserves » du projet, les réserves par entreprise et les cadres de signature.
- [ ] Ordre du jour « Réunion de chantier » : le bloc des réserves ; rapport d’état **PDF** : la section « Réserves ».

## Bibliothèque et traduction
- [ ] Bibliothèque, dossier **Démo** : le CCTP et un *Statement of work* en anglais.
- [ ] Sélectionner le *Statement of work* → **Traduire** en français : la traduction arrive à côté.

## Intervenants
- [ ] Vue **Intervenants** : Garonne Bâtiment, ses documents dus, Julien Garcia ; la capacité d’Anne Leroy (28 h).
`
}
