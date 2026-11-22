import { describe, it, expect } from 'vitest'
import { pick, languagesOf, pagesInOrder, changedSince } from '../src/site.js'

describe('pick', () => {
  it('reads the language asked for, else the first stored, and a bare value as it is', () => {
    expect(pick({ en: 'About', fr: 'À propos' }, 'fr')).toBe('À propos')
    expect(pick({ en: 'About', fr: 'À propos' }, 'de')).toBe('About')
    expect(pick('About', 'fr')).toBe('About')
    expect(pick({}, 'en')).toBeUndefined()
  })
})

describe('languagesOf', () => {
  it("reads a site's languages and its default", () => {
    expect(languagesOf({ languages: ['en', 'fr'], default_language: 'fr' })).toEqual({ languages: ['en', 'fr'], defaultLanguage: 'fr' })
    expect(languagesOf({ languages: ['es'] })).toEqual({ languages: ['es'], defaultLanguage: 'es' })
    expect(languagesOf(null)).toEqual({ languages: [], defaultLanguage: null })
  })
})

describe('pagesInOrder', () => {
  const rows = [
    { page_uuid: 'about', parent_page_uuid: null, order: 2, slug: { en: 'about', fr: 'a-propos' }, title: { en: 'About' }, updated_at: '2026-11-20T00:00:00Z' },
    { page_uuid: 'home', parent_page_uuid: null, order: 1, slug: { en: 'home' }, title: { en: 'Home' }, is_index: true, updated_at: '2026-11-21T12:00:00Z' },
    { page_uuid: 'team', parent_page_uuid: 'about', order: 1, slug: { en: 'team' }, title: { en: 'Team' }, hidden: true, updated_at: '2026-11-19T00:00:00Z' },
    { page_uuid: 'post', parent_page_uuid: 'blog', order: 1, slug: 'post', is_dynamic: true, param_name: 'slug' },
    { page_uuid: 'blog', parent_page_uuid: null, order: 3, slug: 'blog' },
  ]

  it('gives each page its route, in the order the site keeps them', () => {
    const pages = pagesInOrder(rows, { language: 'en' })
    expect(pages.map((p) => [p.route, p.depth])).toEqual([
      ['/', 0],
      ['/about', 0],
      ['/about/team', 1],
      ['/blog', 0],
      ['/blog/:slug', 1],
    ])
    expect(pages.find((p) => p.uuid === 'team')).toMatchObject({ title: 'Team', hidden: true })
  })

  it('addresses a page in the language asked for', () => {
    expect(pagesInOrder(rows, { language: 'fr' }).find((p) => p.uuid === 'team').route).toBe('/a-propos/team')
  })

  it("reads a row's stored data, and takes the default language's route from the row", () => {
    const stored = [
      { page_uuid: 'blog', parent_page_uuid: null, order: 1, route: '/blog', data: { slug: { en: 'blog', fr: 'journal' }, title: { en: 'Blog', fr: 'Journal' } } },
      { page_uuid: 'post', parent_page_uuid: 'blog', order: 1, route: '/blog/:id', data: { slug: { en: 'post' }, is_dynamic: true, param_name: 'id' } },
    ]
    expect(pagesInOrder(stored, { language: 'en', defaultLanguage: 'en' }).map((p) => p.route)).toEqual(['/blog', '/blog/:id'])
    const fr = pagesInOrder(stored, { language: 'fr', defaultLanguage: 'en' })
    expect(fr.map((p) => [p.route, p.title])).toEqual([['/journal', 'Journal'], ['/journal/:id', null]])
  })

  it('shows a page whose parent is missing, rather than losing it', () => {
    expect(pagesInOrder([{ page_uuid: 'x', parent_page_uuid: 'gone', slug: 'x' }]).map((p) => p.route)).toEqual(['/x'])
  })
})

describe('changedSince', () => {
  it('keeps what changed after the moment, and everything when there was none', () => {
    const entries = [{ updatedAt: '2026-11-20T00:00:00Z' }, { updatedAt: '2026-11-22T00:00:00Z' }, { updatedAt: null }]
    expect(changedSince(entries, '2026-11-21T00:00:00Z')).toEqual([{ updatedAt: '2026-11-22T00:00:00Z' }])
    expect(changedSince(entries, null)).toHaveLength(3)
  })
})
