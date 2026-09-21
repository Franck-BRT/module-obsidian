import type PMPlugin from '../../main'
import type { Requirement } from '../../store/requirements/Requirement'
import { DERIVE_KINDS, derivedFrom } from '../../store/requirements/reqDerive'
import { NewRequirementModal } from './NewRequirementModal'

/**
 * Starting a requirement from one that already exists.
 *
 * Asked through the same form a blank one goes through, because the same two things are
 * being decided — where it is filed and what it is called — with the relation to the
 * original added. The identifier it will be minted is on screen before anything is
 * written, and the category can be changed there: a system requirement broken down into
 * an electrical one is filed under ELEC and numbered accordingly.
 *
 * What opening the new requirement means is left to the caller: the library wants it
 * opened beside itself, an editor wants to be replaced by it.
 */
export function deriveRequirement(plugin: PMPlugin, source: Requirement, onCreated: (path: string) => void): void {
  new NewRequirementModal(
    plugin.app,
    plugin,
    source.category,
    (draft) => {
      void (async () => {
        const created = await plugin.requirements.create(
          derivedFrom(source, {
            category: draft.category,
            title: draft.title,
            kind: draft.kind ?? DERIVE_KINDS[0],
            by: plugin.settings.globalTeamMembers[0] ?? '',
            // Whatever this vault calls a requirement nobody has agreed to yet, never the
            // standing of the one it came from.
            status: plugin.settings.requirements.statuses[0]?.id ?? ''
          })
        )
        if (created?.filePath) onCreated(created.filePath)
      })()
    },
    source
  ).open()
}
