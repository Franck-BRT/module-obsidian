import { describe, expect, it } from 'vitest'
import { readMsProject, MsProjectError } from './msProject'
import { readPlanningSheet, readPredecessors, readSheetDate } from './planningSheet'
import { planCounts, planTasks } from './plan'

const MSPDI = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Project xmlns="http://schemas.microsoft.com/project">
  <Name>Bâtiment B12.xml</Name>
  <Title>Bâtiment B12</Title>
  <Tasks>
    <Task><UID>0</UID><ID>0</ID><Name>Bâtiment B12</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>
    <Task><UID>1</UID><ID>1</ID><Name>Gros œuvre</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary>
      <Start>2026-10-05T08:00:00</Start><Finish>2026-10-30T17:00:00</Finish></Task>
    <Task><UID>2</UID><ID>2</ID><Name>Ferraillage &amp; coffrage</Name><OutlineLevel>2</OutlineLevel>
      <Start>2026-10-05T08:00:00</Start><Finish>2026-10-09T17:00:00</Finish><PercentComplete>100</PercentComplete></Task>
    <Task><UID>3</UID><ID>3</ID><Name>Coulage</Name><OutlineLevel>2</OutlineLevel>
      <Start>2026-10-14T08:00:00</Start><Finish>2026-10-16T17:00:00</Finish><PercentComplete>20</PercentComplete>
      <Notes>Béton C30/37</Notes>
      <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>9600</LinkLag><LagFormat>7</LagFormat></PredecessorLink>
    </Task>
    <Task><UID>4</UID><ID>4</ID><Name>Radier coulé</Name><OutlineLevel>2</OutlineLevel><Milestone>1</Milestone>
      <Start>2026-10-16T17:00:00</Start><Finish>2026-10-16T17:00:00</Finish>
      <PredecessorLink><PredecessorUID>3</PredecessorUID><Type>0</Type></PredecessorLink>
      <PredecessorLink><PredecessorUID>99</PredecessorUID><Type>1</Type></PredecessorLink>
    </Task>
    <Task><UID>5</UID><ID>5</ID><Name>Réception</Name><OutlineLevel>1</OutlineLevel>
      <Start>2026-11-02T08:00:00</Start><Finish>2026-11-02T17:00:00</Finish></Task>
  </Tasks>
  <Resources><Resource><UID>1</UID><Name>Garonne Bâtiment</Name></Resource></Resources>
  <Assignments><Assignment><TaskUID>3</TaskUID><ResourceUID>1</ResourceUID></Assignment></Assignments>
</Project>`

describe('a planning from MS Project', () => {
  it('reads its outline, dates, progress, resources and links', () => {
    const plan = readMsProject(MSPDI)
    expect(plan.name).toBe('Bâtiment B12')
    expect(plan.lines.map((line) => [line.title, line.level])).toEqual([
      ['Gros œuvre', 1],
      ['Ferraillage & coffrage', 2],
      ['Coulage', 2],
      ['Radier coulé', 2],
      ['Réception', 1]
    ])
    const coulage = plan.lines[2]
    expect(coulage).toMatchObject({
      start: '2026-10-14',
      due: '2026-10-16',
      progress: 20,
      people: ['Garonne Bâtiment'],
      notes: 'Béton C30/37'
    })
    expect(coulage.links).toEqual([{ key: '2', type: 'FS', lag: 2 }])
    expect(plan.lines[3].links[0]).toEqual({ key: '3', type: 'FF', lag: 0 })
    expect(plan.warnings).toEqual([{ line: 'Radier coulé', kind: 'link', value: '99' }])
    expect(planCounts(plan)).toMatchObject({
      lots: 1,
      tasks: 3,
      milestones: 1,
      links: 3,
      people: 1,
      start: '2026-10-05',
      due: '2026-11-02'
    })
  })

  it('becomes tickets, a lot holding its lines, links to the new ids', () => {
    const roots = planTasks(readMsProject(MSPDI))
    expect(roots.map((task) => [task.title, task.type])).toEqual([
      ['Gros œuvre', 'phase'],
      ['Réception', 'task']
    ])
    const [ferraillage, coulage, radier] = roots[0].subtasks
    expect(ferraillage).toMatchObject({ status: 'done', progress: 100 })
    expect(coulage.dependencies).toEqual([ferraillage.id])
    expect(coulage.dependencyOptions).toEqual({ [ferraillage.id]: { type: 'FS', lag: 2 } })
    expect(radier).toMatchObject({ type: 'milestone', start: '', due: '2026-10-16', dependencies: [coulage.id] })
    expect(radier.dependencyOptions).toEqual({ [coulage.id]: { type: 'FF', lag: 0 } })
  })

  it('refuses what is not one', () => {
    expect(() => readMsProject('<Workbook/>')).toThrow(MsProjectError)
    expect(() => readMsProject('not xml <')).toThrow(MsProjectError)
  })
})

describe('a planning from a spreadsheet', () => {
  it('reads dates and predecessors as MS Project and people write them', () => {
    expect(readSheetDate('2026-10-05')).toBe('2026-10-05')
    expect(readSheetDate('lun. 05/10/26')).toBe('2026-10-05')
    expect(readSheetDate('5/10/2026 08:00')).toBe('2026-10-05')
    expect(readSheetDate('10/25/2026')).toBe('2026-10-25')
    expect(readSheetDate('5 oct. 2026')).toBe('2026-10-05')
    expect(readSheetDate('bientôt')).toBe('')
    expect(readPredecessors('3;5FD+2 j')).toEqual([
      { key: '3', type: 'FS', lag: 0 },
      { key: '5', type: 'FS', lag: 2 }
    ])
    expect(readPredecessors('7DD-1j, 2FF')).toEqual([
      { key: '7', type: 'SS', lag: -1 },
      { key: '2', type: 'FF', lag: 0 }
    ])
    expect(readPredecessors('4FS+1 sem')).toEqual([{ key: '4', type: 'FS', lag: 5 }])
  })

  it('finds its columns by name, its outline by level or WBS', () => {
    const plan = readPlanningSheet(
      [
        { name: 'Notes', rows: [['Rien ici']] },
        {
          name: 'Planning',
          rows: [
            ['Planning B12'],
            ['N°', 'EDT', 'Nom de la tâche', 'Durée', 'Début', 'Fin', 'Prédécesseurs', '% achevé', 'Noms ressources'],
            ['1', '1', 'Gros œuvre', '20 j', '05/10/2026', '30/10/2026', '', '0%', ''],
            ['2', '1.1', 'Coffrage', '5 j', '05/10/2026', '09/10/2026', '', '100%', 'Garonne Bâtiment'],
            [
              '3',
              '1.2',
              'Coulage',
              '3 j',
              '14/10/2026',
              '16/10/2026',
              '2FD+2 j',
              '20%',
              'Garonne Bâtiment;Paul Martin'
            ],
            ['4', '1.3', 'Radier coulé', '0 j', '16/10/2026', '16/10/2026', '3', '0%', ''],
            ['', '', '', '', '', '', '', '', '']
          ]
        }
      ],
      'B12.xlsx'
    )
    expect(plan?.name).toBe('B12')
    expect(plan?.lines.map((line) => [line.key, line.title, line.level, line.milestone])).toEqual([
      ['1', 'Gros œuvre', 1, false],
      ['2', 'Coffrage', 2, false],
      ['3', 'Coulage', 2, false],
      ['4', 'Radier coulé', 2, true]
    ])
    expect(plan?.lines[2]).toMatchObject({
      start: '2026-10-14',
      progress: 20,
      people: ['Garonne Bâtiment', 'Paul Martin']
    })
    expect(plan?.lines[2].links).toEqual([{ key: '2', type: 'FS', lag: 2 }])
    expect(planTasks(plan!)[0].subtasks).toHaveLength(3)
    expect(readPlanningSheet([{ name: 'x', rows: [['a', 'b']] }], 'x.xlsx')).toBeNull()
  })
})
