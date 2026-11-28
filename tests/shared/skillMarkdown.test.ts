import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_SKILL_TEXT_BYTES,
  buildWorkspaceSkillFromDsh,
  byteLengthUtf8,
  normalizeSkillName,
  parseSkillMarkdown,
  selectSkillSources,
} from '../../src/shared/skillMarkdown'
import type { DshSkillDetail } from '../../src/shared/types'

test('normalizeSkillName lowercases and folds illegal runs', () => {
  assert.equal(normalizeSkillName('  My Skill!!  '), 'my-skill')
  assert.equal(normalizeSkillName('a/b c'), 'a-b-c')
  assert.equal(normalizeSkillName('--x--'), 'x')
  assert.equal(normalizeSkillName(''), '')
})

test('parseSkillMarkdown reads quoted fields, flags and body', () => {
  const raw = [
    '---',
    'name: "Demo Skill"',
    "description: 'A demo skill'",
    'when-to-use: when testing',
    'disable-model-invocation: true',
    'user-invocable: false',
    '---',
    '',
    '# Body',
    '',
    'text',
  ].join('\n')
  const parsed = parseSkillMarkdown(raw, 'fallback')
  assert.equal(parsed.name, 'demo-skill')
  assert.equal(parsed.description, 'A demo skill')
  assert.equal(parsed.whenToUse, 'when testing')
  assert.equal(parsed.model, false)
  assert.equal(parsed.user, false)
  assert.equal(parsed.text, '# Body\n\ntext')
  assert.equal(parsed.frontmatterPresent, true)
  assert.deepEqual(parsed.warnings, [])
})

test('parseSkillMarkdown falls back to name, first paragraph and open flags', () => {
  const parsed = parseSkillMarkdown('Hello world.\n\nSecond paragraph.', 'My Skill')
  assert.equal(parsed.name, 'my-skill')
  assert.equal(parsed.description, 'Hello world.')
  assert.equal(parsed.model, true)
  assert.equal(parsed.user, true)
  assert.equal(parsed.text, 'Hello world.\n\nSecond paragraph.')
  assert.equal(parsed.frontmatterPresent, false)
  assert.deepEqual(parsed.warnings, [])
})

test('parseSkillMarkdown handles CRLF and an unclosed frontmatter', () => {
  const crlf = '---\r\nname: crlf\r\ndescription: ok\r\n---\r\n\r\nbody\r\n'
  const parsed = parseSkillMarkdown(crlf, 'x')
  assert.equal(parsed.name, 'crlf')
  assert.equal(parsed.text, 'body\n')

  const unclosed = '---\nname: broken\nbody'
  const fallback = parseSkillMarkdown(unclosed, 'wasm')
  assert.equal(fallback.frontmatterPresent, false)
  assert.equal(fallback.name, 'wasm')
  assert.equal(fallback.text, unclosed)
  assert.ok(fallback.warnings.some((warning) => warning.includes('未闭合')))
})

test('selectSkillSources prefers a top-level SKILL.md and reports ambiguous directories', () => {
  const selection = selectSkillSources([
    { path: 'alpha/extra.md', size: 5 },
    { path: 'alpha/SKILL.md', size: 10 },
    { path: 'beta/one.md', size: 20 },
    { path: 'gamma/a.md', size: 1 },
    { path: 'gamma/b.md', size: 2 },
    { path: 'flat.md', size: 3 },
    { path: 'bundle.zip', size: 4 },
  ])
  assert.deepEqual(
    selection.picked.map((entry) => [entry.path, entry.fallbackName]),
    [
      ['flat.md', 'flat'],
      ['alpha/SKILL.md', 'alpha'],
      ['beta/one.md', 'one'],
    ],
  )
  assert.deepEqual(
    selection.rejected.map((entry) => entry.path).sort(),
    ['bundle.zip', 'gamma/a.md', 'gamma/b.md'],
  )
  assert.ok(selection.rejected.find((entry) => entry.path === 'bundle.zip')?.reason.includes('zip'))
  assert.ok(
    selection.rejected
      .filter((entry) => entry.path.startsWith('gamma/'))
      .every((entry) => entry.reason.includes('多个 Markdown')),
  )
})

test('selectSkillSources rejects oversized files and normalizes Windows paths', () => {
  const selection = selectSkillSources([
    { path: 'big.md', size: MAX_SKILL_TEXT_BYTES + 1 },
    { path: '.\\tools\\SKILL.md', size: 12 },
  ])
  assert.deepEqual(
    selection.picked.map((entry) => [entry.path, entry.fallbackName]),
    [['tools/SKILL.md', 'tools']],
  )
  assert.equal(selection.rejected[0]?.path, 'big.md')
  assert.ok(selection.rejected[0]?.reason.includes(String(MAX_SKILL_TEXT_BYTES)))
})

test('buildWorkspaceSkillFromDsh maps fields and recomputes UTF-8 bytes', () => {
  const content = '# 技能\n\n正文'
  const detail: DshSkillDetail = {
    name: 'demo',
    description: 'demo skill',
    whenToUse: 'when demoing',
    source: 'user-dsh',
    provider: 'runtime',
    model: false,
    user: true,
    origin: 'global',
    rootPriority: 4,
    rootLabel: '用户 .dsh',
    canDisable: true,
    policy: 'on',
    policyFrom: 'default',
    disabled: false,
    content,
    raw: '---\nname: demo\n---\n# 技能',
    sha256: 'abc',
  }
  const record = buildWorkspaceSkillFromDsh(detail, 'ws1')
  assert.equal(record.name, 'demo')
  assert.equal(record.label, 'demo')
  assert.equal(record.scope, 'workspace')
  assert.equal(record.wsId, 'ws1')
  assert.equal(record.bytes, byteLengthUtf8(content))
  assert.equal(record.bytes > content.length, true)
  assert.equal(record.model, false)
  assert.equal(record.user, true)
  assert.equal(record.desc, 'demo skill')
  assert.equal(record.whenToUse, 'when demoing')
  assert.equal(record.text, content)
  assert.equal(record.enabled, true)
})
