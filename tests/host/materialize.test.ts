import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { PromptMaterializer, SECTION_NAME, type PromptSectionLike } from '../../src/host/materialize'
import { globalPaths } from '../../src/host/paths'
import { emptyStore, saveStore } from '../../src/host/store'
import type { CustomPromptRecord, StoreDocument } from '../../src/shared/types'

class FakeSystemPrompt {
  readonly sections: PromptSectionLike[] = []
  readonly disposed: string[] = []

  section(section: PromptSectionLike): () => void {
    this.sections.push(section)
    return () => {
      const index = this.sections.indexOf(section)
      if (index >= 0) this.sections.splice(index, 1)
      this.disposed.push(section.text)
    }
  }

  getSectionOrder(): number {
    return 100
  }
}

function tempHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-csmm-mat-'))
}

function storeWith(customs: CustomPromptRecord[], active = true): StoreDocument {
  const doc = emptyStore()
  doc.groups.push({
    id: 'g1',
    name: 'daily',
    scope: { kind: 'global' },
    enabled: true,
    items: [],
  })
  if (active) doc.activeGroup['global:'] = 'g1'
  doc.customs.push(...customs)
  return doc
}

const custom: CustomPromptRecord = {
  id: 'c1',
  title: 'CSMM slice',
  scope: { kind: 'global' },
  text: 'MATERIALIZE-MARKER-ALPHA',
}

test('materializes enabled global customs into one section', () => {
  const home = tempHome()
  const prompt = new FakeSystemPrompt()
  saveStore(globalPaths(home), storeWith([custom]))

  const materializer = new PromptMaterializer(prompt, home)
  materializer.refresh()

  assert.equal(prompt.sections.length, 1)
  assert.equal(prompt.sections[0]!.name, SECTION_NAME)
  assert.match(prompt.sections[0]!.text, /MATERIALIZE-MARKER-ALPHA/)
  assert.equal(materializer.currentText(), prompt.sections[0]!.text)
})

test('refresh replaces the section and disposes the previous one', () => {
  const home = tempHome()
  const prompt = new FakeSystemPrompt()
  const paths = globalPaths(home)
  let doc = saveStore(paths, storeWith([custom]))
  const materializer = new PromptMaterializer(prompt, home)
  materializer.refresh()

  doc = { ...doc, customs: [{ ...custom, text: 'MATERIALIZE-MARKER-BETA' }] }
  saveStore(paths, doc, doc.revision)
  materializer.refresh()

  assert.equal(prompt.sections.length, 1)
  assert.match(prompt.sections[0]!.text, /BETA/)
  assert.equal(prompt.disposed.length, 1)
})

test('no effective group removes the section', () => {
  const home = tempHome()
  const prompt = new FakeSystemPrompt()
  const paths = globalPaths(home)
  let doc = saveStore(paths, storeWith([custom]))
  const materializer = new PromptMaterializer(prompt, home)
  materializer.refresh()
  assert.equal(prompt.sections.length, 1)

  doc = { ...doc, activeGroup: {} }
  saveStore(paths, doc, doc.revision)
  materializer.refresh()

  assert.equal(prompt.sections.length, 0)
  assert.equal(materializer.currentText(), '')
})

test('disabled or blank customs produce no section', () => {
  const home = tempHome()
  const prompt = new FakeSystemPrompt()
  saveStore(
    globalPaths(home),
    storeWith([{ ...custom, enabled: false }, { ...custom, id: 'c2', text: '   ' }]),
  )
  const materializer = new PromptMaterializer(prompt, home)
  materializer.refresh()
  assert.equal(prompt.sections.length, 0)
})
