import { describe, it, expect } from 'vitest'
import { agentTools } from '../src/tools.js'
import { AgentError } from '../src/backend.js'
import { uuidv7 } from '../src/ids.js'

const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

/** A client shaped as the agent routes answer, keeping every write it is sent. */
function fakeClient({ write, layouts } = {}) {
  const writes = []
  const site = {
    info_item_id: 10,
    info_item_updated_at: 'info-v1',
    info_data: { name: 'Maple & Rye', description: 'A bakery', foundation: '@acme/bakery@1.2.0', tags: ['food'] },
    settings_item_id: 11,
    settings_item_updated_at: 'settings-v1',
    settings_data: { default_language: 'en', languages: ['en', 'fr'], theme: { colors: { primary: '#aa5500' } }, build: { prerender: true } },
    pages_section_id: 21,
    page_sections_section_id: 22,
    layout_sections_section_id: 23,
    settings_section_id: 20,
    pages: [
      { page_uuid: 'p-home', item_id: 1, order: 1, parent_page_uuid: null, route: '/', data: { mode: 'regular', slug: { en: 'home' }, title: { en: 'Home' }, is_index: true } },
      { page_uuid: 'p-about', item_id: 2, order: 2, parent_page_uuid: null, route: '/about', data: { mode: 'regular', slug: { en: 'about' }, title: { en: 'About' } } },
    ],
  }
  const rows = [
    { item_uuid: 's-hero', item_id: 101, order: 1, parent_item_uuid: null, updated_at: 'hero-v1', data: { type: 'Hero', params: { theme: 'dark' }, stable_id: 'hero', extra: 'kept', content: { en: doc('Fresh bread'), fr: doc('Pain frais') } } },
    { item_uuid: 's-grid', item_id: 102, order: 2, parent_item_uuid: null, updated_at: 'grid-v1', data: { type: 'Grid', content: { en: doc('Our breads') } } },
  ]
  const client = {
    writes,
    session: async () => ({ token: 't', workspace: null }),
    sites: async () => [{ uuid: 'site-maple', name: 'Maple & Rye' }],
    site: async () => site,
    status: async () => ({ published: false }),
    pendingRequest: async () => ({ pending: [] }),
    page: async () => ({ sections: rows }),
    layouts: async () => layouts ?? ({ sections: [{ item_uuid: 'l-footer', item_id: 201, updated_at: 'footer-v1', data: { area: 'footer', layout_name: 'default', type: 'Footer', content: { en: doc('© Maple') } } }] }),
    call: async () => ({ schema: { Hero: { content: { title: 'Headline [1]' } }, Grid: {}, Footer: { content: { links: 'Links' } }, Header: {}, AlertBar: {}, Testimonials: { content: { items: { label: 'Quotes [2-6]', content: { title: 'Who' } } } } } }),
    templates: async () => ({
      templates: [
        { uuid: 't-launch', title: 'Product Launch', foundation: '@std/marketing@1.0.0', preview_url: 'https://p/launch.png' },
        { uuid: 't-agency', title: 'Digital Agency', foundation: '@std/marketing@1.0.0' },
        { uuid: 't-spa', title: 'Day Spa', foundation: '@std/shopfront@0.4.5' },
      ],
    }),
    siteFromLook: async (body) => (writes.push({ fromLook: body }), { site_uuid: 'site-new', name: body.name }),
    write: async (siteId, body) => {
      writes.push(body)
      if (write) return write(body)
      if (body.batch) return { results: body.batch.map((op, i) => ({ item_id: 900 + i, item_uuid: op.uuid ?? `new-${i}`, item_updated_at: `v-${i}` })) }
      return { item_id: body.item_id ?? 900, item_uuid: 'new-0', item_updated_at: 'v-next' }
    },
  }
  return client
}

const toolsOf = (client) => Object.fromEntries(agentTools({ client }).map((t) => [t.name, t]))

describe('write_section', () => {
  it('replaces what was written, keeps what was not, and names the version read', async () => {
    const client = fakeClient()
    const { text, isError } = await toolsOf(client).write_section.run({
      site: 'Maple & Rye',
      route: '/',
      section: 's-hero',
      version: 'hero-v1',
      markdown: '---\ntype: Hero\ntheme: light\n---\n# Bread at dawn\n',
    })
    expect(isError).toBeUndefined()
    const [op] = client.writes
    expect(op).toMatchObject({ kind: 'update', item_id: 101, if_unmodified_since: 'hero-v1' })
    expect(op.data).toMatchObject({ type: 'Hero', params: { theme: 'light' }, stable_id: 'hero', extra: 'kept' })
    expect(op.data.content.fr).toEqual(doc('Pain frais'))
    expect(JSON.stringify(op.data.content.en)).toMatch(/Bread at dawn/)
    expect(text).toMatch(/Written: the Hero section s-hero of \/\. Its version is now v-next\./)
  })

  it('says what its type will not show', async () => {
    const client = fakeClient()
    const { text } = await toolsOf(client).write_section.run({ site: 'Maple & Rye', route: '/', section: 's-hero', version: 'hero-v1', markdown: '---\ntype: Hero\n---\nNo headline here.\n' })
    expect(text).toMatch(/Notes, from how its type reads it:\n- Hero needs at least 1 of “Headline”; it has 0\./)
  })

  it('refuses a stale copy in words, writing nothing', async () => {
    const client = fakeClient({ write: () => { throw new AgentError('POST', { status: 409 }) } })
    const r = await toolsOf(client).write_section.run({ site: 'Maple & Rye', route: '/', section: 's-hero', version: 'old', markdown: '---\ntype: Hero\n---\n# x\n' })
    expect(r.isError).toBe(true)
    expect(r.text).toMatch(/changed since you read it.*Read it again.*Nothing was written/s)
  })

  it('refuses a type the foundation lacks before writing', async () => {
    const client = fakeClient()
    const r = await toolsOf(client).write_section.run({ site: 'Maple & Rye', route: '/', section: 's-hero', version: 'hero-v1', markdown: '---\ntype: Carousel\n---\n# x\n' })
    expect(r.text).toMatch(/no section type Carousel/)
    expect(client.writes).toHaveLength(0)
  })
})

describe('links and pictures, as stored', () => {
  const hash = 'c3ee7f0d40cacb2c7190f04084a9d1e8c2c3518752a8a8b6d82339b494bb3342'
  const withIds = (client) => {
    const read = client.site
    client.site = async () => {
      const s = await read()
      return { ...s, pages: s.pages.map((p) => ({ ...p, data: { ...p.data, stable_id: p.page_uuid === 'p-about' ? 'a1b2c3d4' : 'home-word' } })) }
    }
    return client
  }

  it("stores a route as its page's id, notes a link to no page, and gives a picture its identity", async () => {
    const client = withIds(fakeClient())
    const { text } = await toolsOf(client).write_section.run({
      site: 'Maple & Rye',
      route: '/',
      section: 's-hero',
      version: 'hero-v1',
      markdown: `---\ntype: Hero\n---\n# Bread\n\n[About us](page:about) [Our bakes](page:home#bakes)\n\n![Counter](/static/asset/dist/${hash}/base.webp)\n`,
    })
    const stored = JSON.stringify(client.writes[0].data.content.en)
    expect(stored).toContain('"href":"page:a1b2c3d4"')
    expect(stored).toContain(`"assetId":"${hash}"`)
    expect(stored).toContain('"assetExt":"webp"')
    expect(text).toMatch(/The link page:home#bakes names no page of this site/)
  })

  it('gives a new page an id, and stores a link to it by that id', async () => {
    const client = fakeClient()
    await toolsOf(client).add_page.run({ site: 'Maple & Rye', route: '/hours', title: 'Hours', sections: ['---\ntype: Hero\n---\n# Hours\n\n[Back home](page:/) [Here](page:hours#open)\n'] })
    const [page, section] = client.writes[0].batch
    expect(page.data.stable_id).toMatch(/^(?=[0-9a-f]*[0-9])[0-9a-f]{8}$/)
    expect(JSON.stringify(section.data.content)).toContain(`"href":"page:${page.data.stable_id}#open"`)
  })
})

describe('add_section and remove_section', () => {
  it('adds a section last on its page, after another, or inside one', async () => {
    const client = fakeClient()
    const tools = toolsOf(client)
    await tools.add_section.run({ site: 'Maple & Rye', route: '/about', markdown: '---\ntype: Grid\n---\n# Team\n' })
    await tools.add_section.run({ site: 'Maple & Rye', route: '/', markdown: '---\ntype: Grid\n---\n# More\n', after: 's-hero' })
    await tools.add_section.run({ site: 'Maple & Rye', route: '/', markdown: '---\ntype: Hero\n---\n# Card\n', inside: 's-grid' })
    expect(client.writes[0]).toMatchObject({ kind: 'create', section_id: 22, parent_item_uuid: 'p-about', position: 'last' })
    expect(client.writes[0].data.content).toHaveProperty('en')
    expect(client.writes[1]).toMatchObject({ parent_item_uuid: 'p-home', position: { after: 101 } })
    expect(client.writes[2]).toMatchObject({ parent_item_uuid: 's-grid', position: 'last' })
  })

  it('removes a section by its id and version', async () => {
    const client = fakeClient()
    const { text } = await toolsOf(client).remove_section.run({ site: 'Maple & Rye', route: '/', section: 's-grid', version: 'grid-v1' })
    expect(client.writes[0]).toEqual({ kind: 'delete', item_id: 102, if_unmodified_since: 'grid-v1' })
    expect(text).toMatch(/Removed: the Grid section s-grid from \//)
  })
})

describe('add_page', () => {
  it('adds a page and its sections in one batch, the sections naming the new page', async () => {
    const client = fakeClient()
    const { text } = await toolsOf(client).add_page.run({
      site: 'Maple & Rye',
      route: '/about/team',
      title: 'Our team',
      sections: ['---\ntype: Hero\n---\n# The bakers\n', '---\ntype: Grid\n---\n# Who we are\n'],
    })
    const { batch } = client.writes[0]
    expect(batch).toHaveLength(3)
    expect(batch[0]).toMatchObject({ kind: 'create', section_id: 21, parent_item_uuid: 'p-about', data: { mode: 'regular', slug: { en: 'team' }, title: { en: 'Our team' } } })
    expect(batch[0].uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(batch[1]).toMatchObject({ kind: 'create', section_id: 22, parent_item_uuid: batch[0].uuid })
    expect(batch[2].parent_item_uuid).toBe(batch[0].uuid)
    expect(text).toMatch(/Added: the page \/about\/team, "Our team", with 2 sections/)
  })

  it('makes the home page the index page', async () => {
    const client = fakeClient()
    const empty = { ...(await client.site()), pages: [] }
    client.site = async () => empty
    await toolsOf(client).add_page.run({ site: 'Maple & Rye', route: '/', title: 'Home', sections: ['---\ntype: Hero\n---\n# Hi\n'] })
    // A slug is held per language, as the site's content model declares it.
    expect(client.writes[0].batch[0].data).toMatchObject({ slug: { en: 'home' }, title: { en: 'Home' }, is_index: true })
  })

  it('refuses a page that exists, a segment that is not a word, and a missing parent', async () => {
    const tools = toolsOf(fakeClient())
    expect((await tools.add_page.run({ site: 'Maple & Rye', route: '/about', title: 'x', sections: [] })).text).toMatch(/already has a page at \/about/)
    expect((await tools.add_page.run({ site: 'Maple & Rye', route: '/Our Team', title: 'x', sections: [] })).text).toMatch(/lowercase words joined by dashes/)
    expect((await tools.add_page.run({ site: 'Maple & Rye', route: '/shop/cakes', title: 'x', sections: [] })).text).toMatch(/no page at \/shop to put/)
  })
})

describe('the layout, the theme and the site', () => {
  it('updates the footer that exists, with its version, and creates a header that does not', async () => {
    const client = fakeClient()
    const tools = toolsOf(client)
    expect((await tools.set_layout.run({ site: 'Maple & Rye', area: 'footer', markdown: '---\ntype: Footer\n---\n[Instagram](https://i)\n' })).text).toMatch(/give the version read_layout answered/)
    await tools.set_layout.run({ site: 'Maple & Rye', area: 'footer', version: 'footer-v1', markdown: '---\ntype: Footer\n---\n[Instagram](https://i)\n' })
    await tools.set_layout.run({ site: 'Maple & Rye', area: 'header', markdown: '---\ntype: Header\n---\n[Menu](/menu)\n' })
    expect(client.writes[0]).toMatchObject({ kind: 'update', item_id: 201, if_unmodified_since: 'footer-v1', data: { area: 'footer', layout_name: 'default', type: 'Footer' } })
    expect(client.writes[1]).toMatchObject({ kind: 'create', section_id: 23, data: { area: 'header', layout_name: 'default', type: 'Header' } })
  })

  it('keeps several sections in one area: adds a notice first, changes one by its id, and asks which when it is not told', async () => {
    const twoInHeader = {
      sections: [
        { item_uuid: 'l-alert', item_id: 301, order: 0, updated_at: 'alert-v1', data: { area: 'header', layout_name: 'default', type: 'AlertBar', content: { en: doc('Closed on Monday') } } },
        { item_uuid: 'l-header', item_id: 302, order: 1, updated_at: 'header-v1', data: { area: 'header', layout_name: 'default', type: 'Header', content: { en: doc('Maple & Rye') } } },
      ],
    }
    const client = fakeClient({ layouts: twoInHeader })
    const tools = toolsOf(client)
    const notice = '---\ntype: AlertBar\n---\n# Open on Sunday from May\n'
    expect((await tools.set_layout.run({ site: 'Maple & Rye', area: 'header', version: 'header-v1', markdown: notice })).text).toMatch(/The header has 2 sections \(AlertBar, id l-alert; Header, id l-header\): give the id/)
    expect(client.writes).toHaveLength(0)
    await tools.set_layout.run({ site: 'Maple & Rye', area: 'header', section: 'l-alert', version: 'alert-v1', markdown: notice })
    expect(client.writes[0]).toMatchObject({ kind: 'update', item_id: 301, if_unmodified_since: 'alert-v1', data: { area: 'header', type: 'AlertBar' } })
    const added = await tools.set_layout.run({ site: 'Maple & Rye', area: 'header', add: 'first', markdown: notice })
    expect(client.writes[1]).toMatchObject({ kind: 'create', section_id: 23, position: 'first', data: { area: 'header', layout_name: 'default', type: 'AlertBar' } })
    expect(added.text).toMatch(/Added: a AlertBar to the header, before its other sections/)
    expect((await tools.read_layout.run({ site: 'Maple & Rye' })).text).toMatch(/The header, section 1 of 2[\s\S]*The header, section 2 of 2/)
    await tools.remove_section.run({ site: 'Maple & Rye', area: 'header', section: 'l-alert', version: 'alert-v1' })
    expect(client.writes[2]).toMatchObject({ kind: 'delete', item_id: 301, if_unmodified_since: 'alert-v1' })
    expect((await tools.remove_section.run({ site: 'Maple & Rye', section: 'l-alert', version: 'alert-v1' })).text).toMatch(/Give route for a section of a page, or area/)
  })

  it('reads the theme as YAML with its version, and replaces it whole, keeping the other settings', async () => {
    const client = fakeClient()
    const tools = toolsOf(client)
    expect((await tools.read_theme.run({ site: 'Maple & Rye' })).text).toMatch(/version settings-v1[\s\S]*primary: '#aa5500'/)
    await tools.set_theme.run({ site: 'Maple & Rye', version: 'settings-v1', theme: "colors:\n  primary: '#224488'\n" })
    expect(client.writes[0]).toMatchObject({ kind: 'update', item_id: 11, if_unmodified_since: 'settings-v1', data: { theme: { colors: { primary: '#224488' } }, build: { prerender: true }, default_language: 'en' } })
  })

  it('changes only what the theme change names, and removes a key given as null', async () => {
    const client = fakeClient()
    const stored = await client.site()
    stored.settings_data.theme = { colors: { primary: '#aa5500', accent: '#00ff00' }, fonts: { body: 'Inter' }, vars: { gap: '2rem' } }
    await toolsOf(client).set_theme.run({ site: 'Maple & Rye', version: 'settings-v1', theme: "colors:\n  primary: '#224488'\n  accent: null\n" })
    expect(client.writes[0].data.theme).toEqual({ colors: { primary: '#224488' }, fonts: { body: 'Inter' }, vars: { gap: '2rem' } })
  })

  it("changes the site's name and keeps its other info", async () => {
    const client = fakeClient()
    await toolsOf(client).set_site_info.run({ site: 'Maple & Rye', name: 'Maple & Rye Bakery' })
    expect(client.writes[0]).toMatchObject({ kind: 'update', item_id: 10, if_unmodified_since: 'info-v1', data: { name: 'Maple & Rye Bakery', foundation: '@acme/bakery@1.2.0', tags: ['food'] } })
  })
})

describe('starting a site from a look', () => {
  it('lists the looks by foundation, with their templates', async () => {
    const { text } = await toolsOf(fakeClient()).list_looks.run({})
    expect(text).toMatch(/- @std\/marketing@1\.0\.0\n {2}- "Product Launch" — template t-launch — preview https:\/\/p\/launch\.png\n {2}- "Digital Agency"/)
    expect(text).toMatch(/- @std\/shopfront@0\.4\.5/)
  })

  it("makes a site wearing a look, in the person's languages", async () => {
    const client = fakeClient()
    const { text } = await toolsOf(client).create_site.run({ look: 'day spa', name: 'Calm Waters', languages: ['fr', 'en'], default_language: 'fr' })
    expect(client.writes[0].fromLook).toEqual({ template_uuid: 't-spa', name: 'Calm Waters', languages: ['fr', 'en'], default_language: 'fr' })
    expect(text).toMatch(/Made: "Calm Waters", id site-new, wearing @std\/shopfront@0\.4\.5/)
  })
})

describe('uuidv7', () => {
  it('is a version 7 UUID that sorts by time', () => {
    const a = uuidv7(Date.parse('2026-11-21T00:00:00Z'))
    const b = uuidv7(Date.parse('2026-11-22T00:00:00Z'))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(a < b).toBe(true)
  })
})
