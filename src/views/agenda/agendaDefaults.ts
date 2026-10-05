import { currentLocale } from '../../i18n'

/**
 * The agenda templates the plugin ships: written into the templates folder the first time
 * one is needed, then the reader's own — to change, copy or throw away. Each is a note: a
 * few properties, then the agenda as it will read, its blocks between double braces.
 */

export interface DefaultTemplate {
  /** Its note's name. */
  file: string
  name: string
  description: string
  meetingKind?: string
  horizon: number
  body: string
}

const FR: DefaultTemplate[] = [
  {
    file: 'Revue générale d’avancement',
    name: 'Revue générale d’avancement',
    description: 'Où en est le projet : avancement, jalons, lots, retards, risques majeurs et documents.',
    meetingKind: 'review',
    horizon: 21,
    body: `# Revue générale d’avancement — {{projet}}

**Date :** {{date}} {{heure}}
**Participants :**
{{participants}}

## 1. Ouverture (5 min)
- Objet de la revue, validation de l’ordre du jour
- Suite de la réunion précédente : {{réunion-précédente}}

{{actions-précédentes}}

## 2. Avancement global (10 min)
{{avancement}}

## 3. Jalons et chemin critique (10 min)
{{jalons}}

### Chemin critique
{{chemin-critique}}

## 4. Avancement par lot (15 min)
{{lots}}

## 5. Retards et décalages (15 min)
### Tickets en retard
{{retards}}

### Décalages par rapport à la référence
{{décalages}}

## 6. À venir dans les {{horizon}} prochains jours (10 min)
{{à-venir}}

## 7. Risques majeurs (10 min)
{{risques-critiques}}

## 8. Documents en retard (5 min)
{{documents-en-retard}}

## 9. Charge de l’équipe (5 min)
{{charge}}

## 10. Décisions à prendre
{{décisions-à-prendre}}

## 11. Questions diverses et prochaine réunion
-
`
  },
  {
    file: 'Revue des risques',
    name: 'Revue des risques',
    description: 'Le registre passé en revue : criticité, risques à revoir, parades, nouveaux risques.',
    horizon: 30,
    body: `# Revue des risques — {{projet}}

**Date :** {{date}} {{heure}}
**Participants :**
{{participants}}

## 1. Rappel de la revue précédente (5 min)
{{réunion-précédente}}

{{actions-précédentes}}

## 2. Vue d’ensemble du registre (5 min)
{{matrice-risques}}

## 3. Risques critiques et élevés (20 min)
Pour chacun : probabilité et impact toujours justes ? parade engagée ? responsable ?
{{risques-critiques}}

## 4. Risques à revoir avant {{horizon}} jours (15 min)
{{risques-à-revoir}}

## 5. Registre complet (pour mémoire)
{{risques}}

## 6. Nouveaux risques identifiés (10 min)
-

## 7. Risques à clore
-

## 8. Actions et décisions
-
`
  },
  {
    file: 'Revue documentaire',
    name: 'Revue documentaire',
    description: 'Documents en retard et relances, documents attendus, documents en cours de visa.',
    horizon: 21,
    body: `# Revue documentaire — {{projet}}

**Date :** {{date}} {{heure}}
**Participants :**
{{participants}}

## 1. Suite de la revue précédente (5 min)
{{réunion-précédente}}

{{actions-précédentes}}

## 2. Documents en retard et relances (15 min)
{{documents-en-retard}}

## 3. Documents attendus dans les {{horizon}} prochains jours (10 min)
{{documents-attendus}}

## 4. Documents reçus, en attente de visa (15 min)
{{visas-en-attente}}

## 5. Intervenants concernés
{{intervenants}}

## 6. Décisions et nouvelles échéances
-
`
  },
  {
    file: 'Réunion de chantier',
    name: 'Réunion de chantier',
    description:
      'Le point hebdomadaire de chantier : actions précédentes, avancement par lot, retards, documents, sécurité.',
    meetingKind: 'coordination',
    horizon: 14,
    body: `# Réunion de chantier — {{projet}}

**Date :** {{date}} {{heure}}
**Présents :**
{{participants}}

**Entreprises :**
{{intervenants}}

## 1. Compte rendu précédent
{{réunion-précédente}}

### Actions en cours
{{actions-précédentes}}

## 2. Avancement par lot
{{lots}}

## 3. Retards
{{retards}}

## 4. Travaux des {{horizon}} prochains jours
{{à-venir}}

## 5. Documents (plans, notes de calcul, PPSPS…)
### En retard
{{documents-en-retard}}

### Attendus prochainement
{{documents-attendus}}

## 6. Réserves
{{réserves}}

## 7. Hygiène et sécurité
-

## 8. Points divers
-

## 9. Prochaine réunion
-
`
  },
  {
    file: 'Comité de pilotage',
    name: 'Comité de pilotage',
    description: 'La synthèse pour la direction : état, jalons, décalages, risques majeurs, décisions attendues.',
    meetingKind: 'steering',
    horizon: 45,
    body: `# Comité de pilotage — {{projet}}

**Date :** {{date}} {{heure}}
**Participants :**
{{participants}}

## 1. Synthèse (5 min)
{{avancement}}

## 2. Jalons (10 min)
{{jalons}}

## 3. Décalages par rapport à la référence (10 min)
{{décalages}}

## 4. Risques majeurs (15 min)
{{matrice-risques}}

{{risques-critiques}}

## 5. Budget et ressources (10 min)
-

## 6. Décisions attendues du comité (15 min)
{{décisions-à-prendre}}

## 7. Relevé de décisions
{{décisions-récentes}}
-
`
  },
  {
    file: 'Point hebdomadaire d’équipe',
    name: 'Point hebdomadaire d’équipe',
    description: 'Le point court de l’équipe : ce qui est en retard, ce qui arrive, qui est chargé, ce qui bloque.',
    meetingKind: 'technical',
    horizon: 7,
    body: `# Point d’équipe — {{projet}} — {{date}}

## 1. En retard
{{retards}}

## 2. Cette semaine
{{à-venir}}

## 3. Jalons proches
{{jalons}}

## 4. Charge
{{charge}}

## 5. Blocages et besoins
-
`
  },
  {
    file: 'Réunion de lancement',
    name: 'Réunion de lancement',
    description:
      'Le lancement du projet : objectifs, intervenants, organisation, jalons, lots, risques et documents attendus.',
    horizon: 60,
    body: `# Réunion de lancement — {{projet}}

**Date :** {{date}} {{heure}}
**Participants :**
{{participants}}

## 1. Tour de table et rôles (10 min)
{{intervenants}}

## 2. Objectifs et périmètre (15 min)
-

## 3. Organisation et circuit de validation (10 min)
-

## 4. Planning : jalons et lots (15 min)
{{jalons}}

{{lots}}

## 5. Documents attendus (10 min)
{{documents-attendus}}

## 6. Risques identifiés (10 min)
{{risques}}

## 7. Prochaines étapes
-
`
  },
  {
    file: 'Revue de clôture',
    name: 'Revue de clôture',
    description: 'La fin du projet : bilan, jalons tenus ou non, documents à solder, risques, retour d’expérience.',
    horizon: 30,
    body: `# Revue de clôture — {{projet}}

**Date :** {{date}} {{heure}}
**Participants :**
{{participants}}

## 1. Bilan (10 min)
{{avancement}}

## 2. Jalons tenus et manqués (10 min)
{{jalons}}

## 3. Ce qui reste à solder
### Tickets ouverts en retard
{{retards}}

### Documents en retard
{{documents-en-retard}}

### Documents en attente de visa
{{documents-en-revue}}

## 4. Risques encore ouverts
{{risques}}

## 5. Retour d’expérience (20 min)
- Ce qui a bien fonctionné :
- Ce qui est à améliorer :
- À reprendre sur les prochains projets :
`
  }
]

const EN: DefaultTemplate[] = [
  {
    file: 'General progress review',
    name: 'General progress review',
    description: 'Where the project stands: progress, milestones, phases, delays, major risks and documents.',
    meetingKind: 'review',
    horizon: 21,
    body: `# General progress review — {{project}}

**Date:** {{date}} {{time}}
**Attendees:**
{{attendees}}

## 1. Opening (5 min)
- Purpose of the review, agenda approval
- Following up on the previous meeting: {{previous-meeting}}

{{previous-actions}}

## 2. Overall progress (10 min)
{{progress}}

## 3. Milestones and critical path (10 min)
{{milestones}}

### Critical path
{{critical-path}}

## 4. Progress by phase (15 min)
{{phases}}

## 5. Delays and slips (15 min)
### Late tickets
{{late}}

### Slips against the baseline
{{slips}}

## 6. Coming up in the next {{horizon}} days (10 min)
{{upcoming}}

## 7. Major risks (10 min)
{{critical-risks}}

## 8. Late documents (5 min)
{{late-documents}}

## 9. Team workload (5 min)
{{workload}}

## 10. Decisions to make
{{pending-decisions}}

## 11. Any other business and next meeting
-
`
  },
  {
    file: 'Risk review',
    name: 'Risk review',
    description: 'The register reviewed: criticality, risks to review, mitigations, new risks.',
    horizon: 30,
    body: `# Risk review — {{project}}

**Date:** {{date}} {{time}}
**Attendees:**
{{attendees}}

## 1. Previous review (5 min)
{{previous-meeting}}

{{previous-actions}}

## 2. The register at a glance (5 min)
{{risk-matrix}}

## 3. Critical and high risks (20 min)
For each: are probability and impact still right? Is the mitigation under way? Who owns it?
{{critical-risks}}

## 4. Risks to review within {{horizon}} days (15 min)
{{risks-to-review}}

## 5. Full register (for reference)
{{risks}}

## 6. New risks (10 min)
-

## 7. Risks to close
-

## 8. Actions and decisions
-
`
  },
  {
    file: 'Document review',
    name: 'Document review',
    description: 'Late documents and reminders, documents expected, documents awaiting approval.',
    horizon: 21,
    body: `# Document review — {{project}}

**Date:** {{date}} {{time}}
**Attendees:**
{{attendees}}

## 1. Previous review (5 min)
{{previous-meeting}}

{{previous-actions}}

## 2. Late documents and reminders (15 min)
{{late-documents}}

## 3. Documents expected in the next {{horizon}} days (10 min)
{{expected-documents}}

## 4. Documents received, awaiting approval (15 min)
{{pending-visas}}

## 5. Contacts concerned
{{contacts}}

## 6. Decisions and new deadlines
-
`
  },
  {
    file: 'Site meeting',
    name: 'Site meeting',
    description: 'The weekly site meeting: previous actions, progress by phase, delays, documents, safety.',
    meetingKind: 'coordination',
    horizon: 14,
    body: `# Site meeting — {{project}}

**Date:** {{date}} {{time}}
**Present:**
{{attendees}}

**Companies:**
{{contacts}}

## 1. Previous minutes
{{previous-meeting}}

### Open actions
{{previous-actions}}

## 2. Progress by phase
{{phases}}

## 3. Delays
{{late}}

## 4. Works in the next {{horizon}} days
{{upcoming}}

## 5. Documents
### Late
{{late-documents}}

### Expected soon
{{expected-documents}}

## 6. Snags
{{reserves}}

## 7. Health and safety
-

## 8. Any other business
-

## 9. Next meeting
-
`
  },
  {
    file: 'Steering committee',
    name: 'Steering committee',
    description: 'The summary for management: state, milestones, slips, major risks, decisions expected.',
    meetingKind: 'steering',
    horizon: 45,
    body: `# Steering committee — {{project}}

**Date:** {{date}} {{time}}
**Attendees:**
{{attendees}}

## 1. Summary (5 min)
{{progress}}

## 2. Milestones (10 min)
{{milestones}}

## 3. Slips against the baseline (10 min)
{{slips}}

## 4. Major risks (15 min)
{{risk-matrix}}

{{critical-risks}}

## 5. Budget and resources (10 min)
-

## 6. Decisions expected from the committee (15 min)
{{pending-decisions}}

## 7. Decisions taken
{{recent-decisions}}
-
`
  },
  {
    file: 'Weekly team meeting',
    name: 'Weekly team meeting',
    description: 'The short team meeting: what is late, what is coming, who is loaded, what is blocked.',
    meetingKind: 'technical',
    horizon: 7,
    body: `# Team meeting — {{project}} — {{date}}

## 1. Late
{{late}}

## 2. This week
{{upcoming}}

## 3. Milestones coming up
{{milestones}}

## 4. Workload
{{workload}}

## 5. Blockers and needs
-
`
  },
  {
    file: 'Kick-off meeting',
    name: 'Kick-off meeting',
    description:
      'The project kick-off: goals, contacts, organisation, milestones, phases, risks and documents expected.',
    horizon: 60,
    body: `# Kick-off meeting — {{project}}

**Date:** {{date}} {{time}}
**Attendees:**
{{attendees}}

## 1. Introductions and roles (10 min)
{{contacts}}

## 2. Goals and scope (15 min)
-

## 3. Organisation and approval workflow (10 min)
-

## 4. Schedule: milestones and phases (15 min)
{{milestones}}

{{phases}}

## 5. Documents expected (10 min)
{{expected-documents}}

## 6. Risks identified (10 min)
{{risks}}

## 7. Next steps
-
`
  },
  {
    file: 'Closing review',
    name: 'Closing review',
    description: 'The end of the project: results, milestones met or missed, what is left, risks, lessons learnt.',
    horizon: 30,
    body: `# Closing review — {{project}}

**Date:** {{date}} {{time}}
**Attendees:**
{{attendees}}

## 1. Results (10 min)
{{progress}}

## 2. Milestones met and missed (10 min)
{{milestones}}

## 3. What is left
### Late open tickets
{{late}}

### Late documents
{{late-documents}}

### Documents awaiting approval
{{documents-in-review}}

## 4. Risks still open
{{risks}}

## 5. Lessons learnt (20 min)
- What worked well:
- What to improve:
- What to carry over to the next projects:
`
  }
]

/** The templates shipped, in the reader's language. */
export function defaultTemplates(): DefaultTemplate[] {
  return currentLocale() === 'fr' ? FR : EN
}

/** A template's note as it is written: its properties, then its text. */
export function templateNote(
  template: Pick<DefaultTemplate, 'name' | 'description' | 'meetingKind' | 'horizon' | 'body'>
): string {
  const quote = (value: string): string => JSON.stringify(value)
  return [
    '---',
    `name: ${quote(template.name)}`,
    `description: ${quote(template.description)}`,
    ...(template.meetingKind ? [`meetingKind: ${quote(template.meetingKind)}`] : []),
    `horizon: ${template.horizon}`,
    '---',
    '',
    template.body
  ].join('\n')
}
