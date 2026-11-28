import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DshSkillDetail, SkillDraft, SkillSourceState } from '../../../src/UI/contracts'
import SkillEditor from '../../../src/UI/view/components/SkillEditor'
import SkillSourceEditor from '../../../src/UI/view/components/SkillSourceEditor'

const draft: SkillDraft = {
  label: '演示技能',
  desc: '用于测试',
  text: '# 标题\n\n正文',
  model: true,
  user: false,
}

const detail: DshSkillDetail = {
  name: 'demo',
  description: '演示',
  source: 'project-dsh',
  provider: 'test',
  path: 'E:/repo/.dsh/skills/demo/SKILL.md',
  model: true,
  user: true,
  origin: 'workspace',
  content: '正文',
  raw: '---\nname: demo\n---\n\n正文',
  sha256: 'a'.repeat(64),
}

test('SkillEditor 静态渲染包含全部字段、脏标记与操作锚点', () => {
  const html = renderToStaticMarkup(createElement(SkillEditor, {
    name: 'demo',
    draft,
    dirty: true,
    onChange: () => {},
    onSave: () => {},
    onRevert: () => {},
  }))
  for (const field of ['name', 'label', 'desc', 'text', 'model', 'user']) {
    assert.match(html, new RegExp('data-skill-field="' + field + '"'))
  }
  assert.match(html, /data-skill-dirty="true"/)
  assert.match(html, /data-skill-save(?! [^>]*disabled)/)
  assert.match(html, /data-skill-revert(?! [^>]*disabled)/)
  assert.match(html, /readonly=""/)
})

test('SkillEditor 在未修改时禁用保存与还原', () => {
  const html = renderToStaticMarkup(createElement(SkillEditor, {
    name: 'demo',
    draft,
    dirty: false,
    onChange: () => {},
    onSave: () => {},
    onRevert: () => {},
  }))
  assert.match(html, /data-skill-dirty="false"/)
  assert.match(html, /data-skill-save[^>]*disabled/)
  assert.match(html, /data-skill-revert[^>]*disabled/)
})

test('SkillSourceEditor 渲染源工具栏、状态、文本与固定说明', () => {
  const state: SkillSourceState = { status: 'ready', name: 'demo', raw: detail.raw, sha256: detail.sha256 }
  const html = renderToStaticMarkup(createElement(SkillSourceEditor, {
    detail,
    state,
    onChange: () => {},
    onSave: () => {},
    onReload: () => {},
  }))
  assert.match(html, /data-dshsource-pane/)
  assert.match(html, /data-dshsource-status="ready"/)
  assert.match(html, /data-dshsource-reload/)
  assert.match(html, /data-dshsource-note/)
  assert.match(html, /保存后重开会话生效/)
  assert.match(html, /data-dshsource-save[^>]*disabled/)
  assert.doesNotMatch(html, /data-dshsource-conflict/)
})

test('SkillSourceEditor 在文本变化时允许保存', () => {
  const state: SkillSourceState = { status: 'ready', name: 'demo', raw: detail.raw + '\n修改', sha256: detail.sha256 }
  const html = renderToStaticMarkup(createElement(SkillSourceEditor, {
    detail,
    state,
    onChange: () => {},
    onSave: () => {},
    onReload: () => {},
  }))
  assert.match(html, /data-dshsource-save(?! [^>]*disabled)/)
})

test('SkillSourceEditor 冲突时显示 SHA 并禁止保存', () => {
  const state: SkillSourceState = {
    status: 'conflict',
    name: 'demo',
    raw: detail.raw,
    sha256: detail.sha256,
    conflictSha: 'b'.repeat(64),
    error: '源文件已变更',
  }
  const html = renderToStaticMarkup(createElement(SkillSourceEditor, {
    detail,
    state,
    onChange: () => {},
    onSave: () => {},
    onReload: () => {},
  }))
  assert.match(html, /data-dshsource-status="conflict"/)
  assert.match(html, new RegExp('data-dshsource-conflict="' + 'b'.repeat(64) + '"'))
  assert.match(html, /data-dshsource-save[^>]*disabled/)
})
