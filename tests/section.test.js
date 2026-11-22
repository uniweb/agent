import { describe, it, expect } from 'vitest'
import { readSection, writeSection, SectionError } from '../src/section.js'

const hero = `---
type: Hero
theme: dark
columns: 2
---
# Fresh bread, every morning

Baked before dawn on Rue Maple.

[See the menu](/menu)
`

describe('readSection', () => {
  it('reads the type, the settings as params, and the content as a document', () => {
    const { section, notes } = readSection(hero)
    expect(section.type).toBe('Hero')
    expect(section.params).toEqual({ theme: 'dark', columns: 2 })
    expect(section.content.type).toBe('doc')
    expect(JSON.stringify(section.content)).toContain('Fresh bread, every morning')
    expect(notes).toEqual([])
  })

  it('merges `props:` into the params, keeps `hidden: true` and an authored `id`', () => {
    const { section } = readSection('---\ntype: Hero\nid: welcome\nhidden: true\nprops:\n  columns: 3\n---\nHi\n')
    expect(section).toMatchObject({ type: 'Hero', stable_id: 'welcome', hidden: true, params: { columns: 3 } })
  })

  it('keeps a date as the text it was written as', () => {
    const { section } = readSection('---\ntype: Event\nstarts: 2026-12-01\n---\n')
    expect(section.params.starts).toBe('2026-12-01')
  })

  it('keeps `fetch:` in the params, as a site stores it', () => {
    const fetch = { query: 'team', as: 'team' }
    const { section } = readSection(writeSection({ type: 'Team', params: { fetch }, content: { type: 'doc', content: [] } }))
    expect(section.params.fetch).toEqual(fetch)
  })

  it('says what does nothing', () => {
    const { notes } = readSection('---\ntype: Hero\npreset: centered\n---\nHi\n')
    expect(notes.join(' ')).toMatch(/preset/)
  })

  it('refuses a section with no frontmatter, saying how one starts', () => {
    expect(() => readSection('# Just a heading\n')).toThrow(SectionError)
    expect(() => readSection('# Just a heading\n')).toThrow(/starts with frontmatter naming its type/)
  })

  it('refuses frontmatter with no type', () => {
    expect(() => readSection('---\ntheme: dark\n---\nHi\n')).toThrow(/names no `type:`/)
  })

  it('refuses a type the foundation lacks, naming the ones it has', () => {
    expect(() => readSection(hero, { types: ['Features', 'Footer'] })).toThrow(/no section type Hero\. It has: Features, Footer/)
  })

  it('refuses YAML that does not parse, with the usual cause', () => {
    expect(() => readSection('---\ntype: Hero\ntitle: Bread: baked daily\n---\n')).toThrow(/needs quotes/)
  })

  it('refuses `query:` and `data:`, pointing to `fetch:`', () => {
    expect(() => readSection('---\ntype: Team\nquery: team\n---\n')).toThrow(/fetch:/)
    expect(() => readSection('---\ntype: Team\ndata: team\n---\n')).toThrow(/fetch:/)
  })
})

describe('writeSection', () => {
  it('reads back as the same section', () => {
    const { section } = readSection(hero)
    expect(readSection(writeSection(section)).section).toEqual(section)
  })

  it('puts a param named like a frontmatter key under `props:`, so it reads back', () => {
    const section = { type: 'Card', params: { hidden: 'not a draft flag', size: 'lg' }, content: { type: 'doc', content: [] } }
    const md = writeSection(section)
    expect(md).toMatch(/props:/)
    expect(readSection(md).section.params).toEqual({ hidden: 'not a draft flag', size: 'lg' })
  })

  it('writes the type first', () => {
    const md = writeSection({ type: 'Hero', params: { theme: 'dark' }, content: { type: 'doc', content: [] } })
    expect(md.startsWith('---\ntype: Hero\n')).toBe(true)
  })
})
