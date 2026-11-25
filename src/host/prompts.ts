import { tokenEstimate } from '../shared/resolve'
import type { PromptSectionView } from '../shared/types'

/** The minimal slice of the host `systemPrompt` service needed to read an assembly. */
export interface SystemPromptAssembler {
  assemble?: (context?: Record<string, unknown>) => Promise<{
    sections: Array<{ name: string; text: string }>
    contexts?: Array<{ name: string; text: string }>
    tools?: Array<{ name: string; description?: string; parameters?: unknown }>
  }>
}

/**
 * Read the host's registered prompt sections/contexts for an assembly context.
 * Passing the live agent (as dsh-context's sampler does) yields the same
 * agent-scoped presentation a real request gets, including tool instruction
 * sections; an empty context only sees global registrations.
 */
export async function listRegisteredPrompts(
  systemPrompt: SystemPromptAssembler,
  context: Record<string, unknown> = {},
): Promise<PromptSectionView[]> {
  if (!systemPrompt.assemble) return []
  const assembly = await systemPrompt.assemble(context)
  const out: PromptSectionView[] = []
  for (const section of assembly.sections ?? []) {
    // dsh-csmm's own materialized section is an internal, always-protected
    // section; it must not appear as a user-selectable host prompt.
    if (section.name.startsWith('dsh-csmm:')) continue
    out.push({
      name: section.name,
      text: section.text,
      tokens: tokenEstimate(section.text),
      kind: 'section',
    })
  }
  for (const entry of assembly.contexts ?? []) {
    out.push({
      name: entry.name,
      text: entry.text,
      tokens: tokenEstimate(entry.text),
      kind: 'context',
    })
  }
  for (const tool of assembly.tools ?? []) {
    const text = [
      tool.description ?? '',
      tool.parameters === undefined ? '' : JSON.stringify(tool.parameters, null, 2),
    ]
      .filter((part) => part.length > 0)
      .join('\n\n')
    out.push({
      name: `tool-schema:${tool.name}`,
      text,
      tokens: tokenEstimate(text),
      kind: 'tool',
    })
  }
  return out
}
