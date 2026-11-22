import { describe, it, expect } from 'vitest'
import { agentTools } from '../src/tools.js'
import { AgentError } from '../src/backend.js'

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

/** A client whose answers are the shapes the backend's agent routes give. */
function fakeClient(overrides = {}) {
  const site = {
    info_data: { name: 'Maple & Rye', description: 'A bakery', foundation: '@acme/bakery@1.2.0' },
    settings_data: { default_language: 'en', languages: ['en', 'fr'] },
    pages: [
      { page_uuid: 'p-home', order: 1, parent_page_uuid: null, route: '/', updated_at: '2026-11-20T00:00:00Z', data: { slug: { en: 'home' }, title: { en: 'Home' }, is_index: true } },
      { page_uuid: 'p-hours', order: 2, parent_page_uuid: null, route: '/hours', updated_at: '2026-11-22T00:00:00Z', data: { slug: { en: 'hours', fr: 'horaires' }, title: { en: 'Hours', fr: 'Horaires' } } },
    ],
  }
  return {
    session: async () => ({ token: 't', workspace: { handle: '@acme' } }),
    sites: async () => [
      { uuid: '0000-site-maple', name: 'Maple & Rye', updated_at: '2026-11-22T00:00:00Z', deployment: { status: 'published', visitor_url: 'https://maple.example/' } },
      { uuid: '0000-site-draft', name: 'Draft', updated_at: '2026-11-01T00:00:00Z' },
    ],
    site: async () => site,
    status: async () => ({ published: true, last_published_at: '2026-11-21T00:00:00Z', draft_dirty: true, visitor_url: 'https://maple.example/' }),
    pendingRequest: async () => ({ pending: [{ kind: 'hosting_plan', detail: 'this site has no hosting plan yet' }] }),
    page: async () => ({
      sections: [
        { item_uuid: 's-1', order: 1, parent_item_uuid: null, updated_at: 'v1', data: { type: 'Hero', params: { theme: 'dark' }, content: { en: doc('Fresh bread'), fr: doc('Pain frais') } } },
        { item_uuid: 's-2', order: 2, parent_item_uuid: null, updated_at: 'v2', data: { type: 'Grid', content: { en: doc('Our breads') } } },
        { item_uuid: 's-3', order: 1, parent_item_uuid: 's-2', updated_at: 'v3', data: { type: 'Card', content: doc('Sourdough') } },
      ],
    }),
    layouts: async () => ({ sections: [{ item_uuid: 'l-1', order: 1, updated_at: 'v9', data: { area: 'footer', type: 'Footer', content: { en: doc('© Maple & Rye') } } }] }),
    call: async () => ({ schema: { Hero: { description: 'The opening' } }, info: { description: 'A bakery foundation' } }),
    ...overrides,
  }
}

const toolsOf = (client, options) => Object.fromEntries(agentTools({ client, ...options }).map((t) => [t.name, t]))

describe('agentTools', () => {
  it("lists the workspace's sites, live or not", async () => {
    const { text } = await toolsOf(fakeClient()).list_sites.run({})
    expect(text).toMatch(/Sites in @acme:/)
    expect(text).toMatch(/Maple & Rye — id 0000-site-maple — live at https:\/\/maple\.example\//)
    expect(text).toMatch(/Draft — id 0000-site-draft — not published/)
  })

  it('shows a site at a glance, saying what a publish waits on without its price', async () => {
    const { text, isError } = await toolsOf(fakeClient()).site_overview.run({ site: 'maple & rye' })
    expect(isError).toBeUndefined()
    expect(text).toMatch(/Foundation: @acme\/bakery@1\.2\.0\. Languages: en, fr\./)
    expect(text).toMatch(/changes that are not live yet/)
    expect(text).toMatch(/no hosting plan yet \(they settle it in Uniweb's app, in a browser\)/)
    expect(text).not.toMatch(/1900|19\.00/)
    expect(text).toMatch(/- \/hours — Hours/)
    expect(text).toMatch(/Pages changed since the last publish: \/hours\./)
  })

  it('names a site by the end of its id', async () => {
    const { text } = await toolsOf(fakeClient()).site_overview.run({ site: 'site-draft' })
    expect(text).toMatch(/^Maple & Rye|^Draft/m)
  })

  it("reads a page's sections as Markdown, nested, in the language asked for", async () => {
    const tools = toolsOf(fakeClient())
    const { text } = await tools.read_page.run({ site: 'Maple & Rye', route: 'hours' })
    expect(text).toMatch(/Hours \(\/hours\), in en: 3 sections\./)
    expect(text).toMatch(/## Section 1: Hero\nid: s-1 · version: v1\n\n---\ntype: Hero\ntheme: dark\n---\n\nFresh bread/)
    expect(text).toMatch(/## Section 3: Card \(inside the section above\)/)
    const fr = await tools.read_page.run({ site: 'Maple & Rye', route: '/horaires', language: 'fr' })
    expect(fr.text).toMatch(/Pain frais/)
  })

  it('refuses a page the site lacks, listing its pages, and a language it lacks', async () => {
    const tools = toolsOf(fakeClient())
    const missing = await tools.read_page.run({ site: 'Maple & Rye', route: '/menu' })
    expect(missing).toMatchObject({ isError: true })
    expect(missing.text).toMatch(/no page at \/menu\. Its pages: \/, \/hours/)
    const de = await tools.read_page.run({ site: 'Maple & Rye', route: '/', language: 'de' })
    expect(de.text).toMatch(/not in de\. Its languages: en, fr/)
  })

  it('reads the layout areas by their names', async () => {
    const { text } = await toolsOf(fakeClient()).read_layout.run({ site: 'Maple & Rye' })
    expect(text).toMatch(/## The footer: Footer\nid: l-1 · version: v9/)
    expect(text).toMatch(/© Maple & Rye/)
  })

  it("reads the foundation's vocabulary through the site", async () => {
    let asked = null
    const client = fakeClient({ call: async (path) => ((asked = path), { schema: { Hero: { description: 'The opening' } } }) })
    const { text } = await toolsOf(client).foundation_vocabulary.run({ site: 'Maple & Rye' })
    expect(asked).toBe('/agent/sites/0000-site-maple/foundations/acme/bakery/1.2.0/schema')
    expect(text).toMatch(/## Hero\n {2}The opening/)
  })

  it("in a project, leaves out what the project's files already do", () => {
    const names = Object.keys(toolsOf(fakeClient(), { project: true }))
    expect(names).toContain('site_overview')
    expect(names).not.toContain('read_page')
    expect(names).not.toContain('read_layout')
  })

  it('answers a refusal in words, and an ended sign-in with what the person does', async () => {
    const ended = fakeClient({ sites: async () => { throw new AgentError('The sign-in to Uniweb on this computer has ended.', { status: 401, signInAgain: true }) } })
    const r = await toolsOf(ended).list_sites.run({})
    expect(r).toMatchObject({ isError: true })
    expect(r.text).toMatch(/signs in to Uniweb again on this computer/)
    const gone = fakeClient({ site: async () => { throw new AgentError('GET', { status: 404 }) } })
    expect((await toolsOf(gone).site_overview.run({ site: 'Maple & Rye' })).text).toMatch(/not found among what the person can reach/)
  })
})
