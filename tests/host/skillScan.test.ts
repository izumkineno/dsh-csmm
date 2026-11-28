import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { parseSkillFrontmatter, scanSkillRoot } from '../../src/host/skillScan'

function write(root: string, name: string, file: string, text: string): void {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, file), text)
}

test('scanSkillRoot reads enabled and disabled skills, skips hidden and node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-scan-'))
  write(root, 'alpha', 'SKILL.md',
    '---\nname: alpha\ndescription: Alpha skill\nwhen-to-use: Use alpha\ndisable-model-invocation: true\n---\n# Alpha\n')
  write(root, 'beta', 'SKILL.md.disabled',
    '---\nname: beta\ndescription: Beta skill\nuser-invocable: false\n---\n')
  write(root, 'mismatch', 'SKILL.md',
    '---\nname: other\ndescription: Wrong name\n---\n')
  write(root, 'broken', 'SKILL.md', '# no frontmatter\n')
  write(root, '.hidden', 'SKILL.md', '---\nname: hidden\ndescription: nope\n---\n')
  write(path.join(root, 'node_modules'), 'dep', 'SKILL.md', '---\nname: dep\ndescription: nope\n---\n')
  fs.writeFileSync(path.join(root, 'loose.md'), '---\nname: loose\n---\n')

  const scan = scanSkillRoot({ root, scope: 'global' })
  assert.equal(scan.root.exists, true)
  assert.equal(scan.root.count, 4)
  assert.deepEqual(scan.skills.map((s) => s.name), ['alpha', 'beta', 'broken', 'mismatch'])
  assert.deepEqual(scan.errors, [])

  const alpha = scan.skills.find((s) => s.name === 'alpha')
  assert.equal(alpha?.enabled, true)
  assert.equal(alpha?.model, false)
  assert.equal(alpha?.user, true)
  assert.equal(alpha?.whenToUse, 'Use alpha')
  assert.equal(alpha?.rel, 'alpha/SKILL.md')

  const beta = scan.skills.find((s) => s.name === 'beta')
  assert.equal(beta?.enabled, false)
  assert.equal(beta?.user, false)
  assert.equal(beta?.file, 'SKILL.md.disabled')

  const mismatch = scan.skills.find((s) => s.name === 'mismatch')
  assert.match(mismatch?.notes.join('\n') ?? '', /不一致/)
  const broken = scan.skills.find((s) => s.name === 'broken')
  assert.match(broken?.notes.join('\n') ?? '', /缺少 frontmatter/)
  assert.match(broken?.notes.join('\n') ?? '', /缺少 description/)
})

test('scanSkillRoot prefers SKILL.md and notes a duplicate disabled file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-scan-dup-'))
  write(root, 'dup', 'SKILL.md', '---\nname: dup\ndescription: enabled\n---\n')
  write(root, 'dup', 'SKILL.md.disabled', '---\nname: dup\ndescription: disabled\n---\n')
  const scan = scanSkillRoot({ root, scope: 'workspace', wsId: 'ws-1' })
  assert.equal(scan.skills.length, 1)
  assert.equal(scan.skills[0].enabled, true)
  assert.equal(scan.skills[0].scope, 'workspace')
  assert.equal(scan.skills[0].wsId, 'ws-1')
  assert.match(scan.skills[0].notes.join('\n'), /同时存在/)
})

test('scanSkillRoot treats a missing root as empty without an error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-scan-missing-'))
  const scan = scanSkillRoot({ root: path.join(root, 'missing'), scope: 'global' })
  assert.equal(scan.root.exists, false)
  assert.equal(scan.root.count, 0)
  assert.deepEqual(scan.skills, [])
  assert.deepEqual(scan.errors, [])
})

test('parseSkillFrontmatter handles BOM, CRLF, quotes and block scalars', () => {
  const text = '\uFEFF---\r\nname: "quoted-name"\r\ndescription: >\r\n  folded\r\n  line\r\nwhen-to-use: |\r\n  first\r\n  second\r\n---\r\nbody'
  const parsed = parseSkillFrontmatter(text)
  assert.equal(parsed.error, undefined)
  assert.equal(parsed.data.name, 'quoted-name')
  assert.equal(parsed.data.description, 'folded line')
  assert.equal(parsed.data['when-to-use'], 'first\nsecond')
})

test('parseSkillFrontmatter reports missing and unclosed frontmatter', () => {
  const missing = parseSkillFrontmatter('# just markdown\n')
  assert.deepEqual(missing.data, {})
  assert.match(missing.error ?? '', /缺少 frontmatter/)

  const unclosed = parseSkillFrontmatter('---\nname: x\n')
  assert.deepEqual(unclosed.data, {})
  assert.match(unclosed.error ?? '', /未闭合/)
})
