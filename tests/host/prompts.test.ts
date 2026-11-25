import assert from 'node:assert/strict'
import { test } from 'node:test'
import { listRegisteredPrompts } from '../../src/host/prompts'

test('prompt list excludes internal dsh-csmm sections', async () => {
  const out = await listRegisteredPrompts({
    assemble: async () => ({
      sections: [
        { name: 'dsh-csmm:prompts', text: 'internal' },
        { name: 'harness:identity', text: 'identity' },
      ],
      contexts: [{ name: 'context:file-reference', text: 'ctx' }],
      tools: [],
    }),
  })
  assert.deepEqual(
    out.map((item) => item.name),
    ['harness:identity', 'context:file-reference'],
  )
})
