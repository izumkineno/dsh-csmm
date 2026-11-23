import { tokenEstimate } from '../shared/resolve'
import type { PromptSectionView } from '../shared/types'

/** The minimal slice of the host `systemPrompt` service needed to read an assembly. */
export interface SystemPromptAssembler {
  assemble?: (context?: Record<string, unknown>) => Promise<{
    sections: Array<{ name: string; text: string }>
  }>
}

/**
 * Read the host's registered prompt sections for the current (global) scope.
 * `assemble()` runs the same read-only presentation waterfall the host uses
 * when preparing a request, so this is the closest view of what DSH actually
 * injects. It does not expose the registry itself (0.2.2-rc.2 has no listing
 * API), only the assembled result.
 */
export async function listRegisteredPrompts(
  systemPrompt: SystemPromptAssembler,
): Promise<PromptSectionView[]> {
  if (!systemPrompt.assemble) return []
  const assembly = await systemPrompt.assemble({})
  return assembly.sections.map((section) => ({
    name: section.name,
    text: section.text,
    tokens: tokenEstimate(section.text),
  }))
}
