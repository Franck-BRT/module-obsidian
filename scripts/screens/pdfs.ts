import { writeFileSync } from 'fs'
import { setLocale } from '../../src/i18n'
import { buildPdf } from '../../src/store/pdf'
import { b12Tasks } from '../../src/views/demo/demoContent'
import { flattenTasks } from '../../src/store/TaskTreeOps'
import { receptionDocument } from '../../src/views/reserves/receptionDocument'
import { statusReportPdf } from '../../src/views/dashboard/statusReportPdf'
import { projectMetrics } from '../../src/store/Metrics'
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES } from '../../src/types'
import { reserveSummary } from '../../src/store/reserve'
import { criticalPath } from '../../src/store/criticalPath'
import { addFigures, hasBudget, projectBudget } from '../../src/store/budget'
setLocale('fr')
const day = '2026-10-05'
const roots = b12Tasks(day)
const tasks = flattenTasks(roots).map((f) => f.task)
const out = process.argv[2]
writeFileSync(`${out}/pv.pdf`, buildPdf(receptionDocument(tasks.filter((t) => t.type === 'reserve'), { project: 'Démo — Bâtiment B12', date: day })))
const metrics = projectMetrics({ tasks, statuses: DEFAULT_STATUSES, priorities: DEFAULT_PRIORITIES, today: day, topRisks: 99 })
const lots = projectBudget(roots).lots.filter((lot) => hasBudget(lot.task))
writeFileSync(
  `${out}/report.pdf`,
  statusReportPdf({
    title: 'Démo — Bâtiment B12',
    today: day,
    metrics,
    decisions: { recent: [], pending: [] },
    lateDocuments: [],
    reserves: reserveSummary(tasks, day),
    critical: criticalPath(roots, DEFAULT_STATUSES),
    budget: { lots: lots.map((l) => ({ title: l.task.title, figures: l.figures })), total: addFigures(lots.map((l) => l.figures)) }
  })
)
