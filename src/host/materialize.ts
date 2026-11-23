import os from 'node:os'
import path from 'node:path'
import type { CustomPromptRecord } from '../shared/types'
import { winningLayer } from '../shared/resolve'
import { globalPaths } from './paths'
import { loadStore } from './store'

/** The subset of the host `systemPrompt` service this slice needs. */
export interface PromptSectionLike {
  name: string
  order: number
  text: string
  interpolate?: boolean
}

export interface SystemPromptLike {
  section(section: PromptSectionLike): () => void
  getSectionOrder(name: string): number
}

export const SECTION_NAME = 'dsh-csmm:global-prompts'

/**
 * Materializes the effective global custom prompts into one system prompt
 * section. Registration is disposable and refreshed after every committed
 * store write; an empty result removes the section instead of leaving an
 * empty contribution behind.
 */
export class PromptMaterializer {
  private readonly systemPrompt: SystemPromptLike
  private readonly home: string
  private dispose: (() => void) | undefined
  private text = ''

  constructor(systemPrompt: SystemPromptLike, home = defaultHome()) {
    this.systemPrompt = systemPrompt
    this.home = home
  }

  refresh(): void {
    let next = ''
    try {
      const doc = loadStore(globalPaths(this.home))
      const layer = winningLayer(doc, { kind: 'global' })
      // Customs only apply together with an effective group, matching the UI.
      if (layer.group) next = renderCustoms(layer.customs)
    } catch {
      next = ''
    }
    if (next === this.text) return
    this.text = next
    this.dispose?.()
    this.dispose = undefined
    if (!next.trim()) return
    this.dispose = this.systemPrompt.section({
      name: SECTION_NAME,
      order: sectionOrder(this.systemPrompt),
      text: next,
      interpolate: false,
    })
  }

  disposeNow(): void {
    this.dispose?.()
    this.dispose = undefined
    this.text = ''
  }

  currentText(): string {
    return this.text
  }
}

export function renderCustoms(customs: readonly CustomPromptRecord[]): string {
  return customs
    .filter((c) => c.enabled !== false && c.text.trim() !== '')
    .map((c) => `## ${c.title.trim() || c.id}\n\n${c.text.trim()}`)
    .join('\n\n')
}

function sectionOrder(systemPrompt: SystemPromptLike): number {
  try {
    return systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 100
  } catch {
    return 9000
  }
}

function defaultHome(): string {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}
