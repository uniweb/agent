/**
 * A section an agent writes is stored as a site's build would store the same file.
 *
 * Every section file of the starter templates (each `.md` beside a `page.yml`, and each layout
 * area), read by `readSection` and by the build's own reader (`processMarkdownFile`, which the sync
 * push uses too), gives the same section: its type, draft state, authored id, params and content.
 * Files that name records (`fetch:`, `query:`) are left out: `readSection` keeps `fetch:` as
 * written, where the build normalizes it.
 *
 * This reads the build from its checkout beside this one, so it runs in the framework's workspace.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSection } from '../src/section.js'

const here = dirname(fileURLToPath(import.meta.url))
const FRAMEWORK = resolve(here, '../..')
const TEMPLATES = join(FRAMEWORK, 'templates')
const COLLECTOR = join(FRAMEWORK, 'build/src/site/content-collector.js')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

// A template's site is the directory holding its `pages/`: its `site.yml` is written at scaffold
// time, from `site.yml.hbs`.
function siteRootOf(file) {
  for (let d = dirname(file); d !== dirname(d); d = dirname(d)) {
    if (existsSync(join(d, 'site.yml')) || existsSync(join(d, 'site.yml.hbs'))) return d
  }
  return null
}

const sectionFiles = existsSync(TEMPLATES)
  ? walk(TEMPLATES).filter((f) => {
      if (!f.endsWith('.md')) return false
      const inPage = f.includes('/site/pages/') && existsSync(join(dirname(f), 'page.yml'))
      const inLayout = f.includes('/site/layout/')
      if (!inPage && !inLayout) return false
      const text = readFileSync(f, 'utf8')
      if (!/^---\r?\n[\s\S]*?^type:/m.test(text)) return false
      return !/^(fetch|query|data):/m.test(text.split(/^---\s*$/m)[1] ?? '')
    })
  : []

describe.skipIf(!existsSync(COLLECTOR) || sectionFiles.length === 0)('a section reads as the build reads it', () => {
  it(`covers the starter templates' section files (${sectionFiles.length})`, () => {
    expect(sectionFiles.length).toBeGreaterThan(50)
  })

  it.each(sectionFiles.map((f) => [relative(TEMPLATES, f), f]))('%s', async (_name, file) => {
    const { processMarkdownFile } = await import(COLLECTOR)
    const { section: built } = await processMarkdownFile(file, 'x', siteRootOf(file))
    const expected = { type: built.type }
    if (built.stableId) expected.stable_id = built.stableId
    if (built.hidden === true) expected.hidden = true
    if (Object.keys(built.params ?? {}).length > 0) expected.params = built.params
    expected.content = built.content

    const { section } = readSection(readFileSync(file, 'utf8'))
    expect(section).toEqual(expected)
  })
})
