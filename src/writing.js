/**
 * The tools that change a site, and the ones that start one.
 *
 * Each change names the version the agent read, so nothing is written over an edit the person
 * made in the app meanwhile: the backend refuses a stale one, and the answer says to read again.
 * Each write answers with the new version, for the next change, and with notes on how the
 * section's type reads what was written, which was the measured difference between an agent's
 * mistakes going unseen and being fixed.
 *
 * A section's stored data is replaced whole by a write, so a change keeps every field it doesn't
 * make, the ones the library doesn't know included.
 */

import yaml from 'js-yaml'
import { AgentError } from './backend.js'
import { uuidv7 } from './ids.js'
import { howItReads } from './reading.js'
import { readSection } from './section.js'
import { pagesInOrder, pick } from './site.js'
import { mapSectionRefs, mintPageId, pageRefIndex, pageRefPages, storedPageRef, unresolvedRefs, withAssetIdentity } from './links.js'

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A document put in a stored rich-text field, keeping the field's other languages. */
function withLanguage(stored, doc, language) {
  if (isPlainObject(stored) && stored.type === 'doc') return doc
  if (isPlainObject(stored)) return { ...stored, [language]: doc }
  return language ? { [language]: doc } : doc
}

/** A short text field put in one language, keeping the others. */
function withLanguageText(stored, text, language) {
  if (isPlainObject(stored)) return { ...stored, [language]: text }
  return language ? { [language]: text } : text
}

/**
 * A change merged over what is stored: maps merge key by key, any other value replaces, and a key
 * given as `null` is removed. So `{ colors: { primary: '#8a4b2a' } }` changes one colour and keeps
 * the rest of a theme.
 */
function mergeOver(stored, change) {
  if (!isPlainObject(change)) return change
  const out = isPlainObject(stored) ? { ...stored } : {}
  for (const [key, value] of Object.entries(change)) {
    if (value === null) delete out[key]
    else out[key] = isPlainObject(value) ? mergeOver(out[key], value) : value
  }
  return out
}

/** The section an agent wrote, merged over the one stored: what it wrote, and every field it didn't touch. */
function mergeSection(stored, written, language) {
  const next = { ...(stored ?? {}) }
  next.type = written.type
  if (written.params) next.params = written.params
  else delete next.params
  if (written.hidden) next.hidden = true
  else delete next.hidden
  if (written.stable_id) next.stable_id = written.stable_id
  next.content = withLanguage(stored?.content, written.content, language)
  return next
}

function resultOf(answer, index = 0) {
  const results = Array.isArray(answer?.results) ? answer.results : null
  return results ? results[index] ?? {} : answer ?? {}
}

/** What to say when a change was refused because what it changes moved on. */
function staleWords(err, what) {
  if (err instanceof AgentError && err.status === 409) {
    return `${what} changed since you read it, in the app or by another write. Read it again, then make your change to it as it stands. Nothing was written.`
  }
  return null
}

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * @param {object} ctx - what the reading tools share: the client, and how a site, its read,
 *   its language and its foundation's schema are found
 */
export function writingTools(ctx) {
  const { client, siteNamed, siteRead, languageFor, schemaOf, refuse } = ctx

  async function notesFor(site, section) {
    const { schema } = await schemaOf(site).catch(() => ({ schema: null }))
    return howItReads(section, schema?.[section.type] ?? null)
  }

  const withNotes = (text, notes) => (notes.length ? `${text}\nNotes, from how its type reads it:\n${notes.map((n) => `- ${n}`).join('\n')}` : text)

  async function typesOf(site) {
    const { schema } = await schemaOf(site).catch(() => ({ schema: null }))
    return schema ? Object.keys(schema).filter((k) => !k.startsWith('_')) : null
  }

  /**
   * A section an agent wrote, as it is stored: its links to pages by their ids, its pictures with
   * their identity, and notes on what was written and does nothing, a link to no page among them.
   * `extra` names pages the same write makes, so a link to one resolves.
   */
  async function prepare(site, read, markdown, { types, extra = [] } = {}) {
    const { section, notes } = readSection(markdown, { types: types ?? (await typesOf(site)) })
    const pages = pageRefPages(pagesInOrder(read.body.pages, { language: read.defaultLanguage, defaultLanguage: read.defaultLanguage }))
    const index = pageRefIndex([...pages, ...extra])
    const dead = unresolvedRefs(section, index).map(
      (ref) => `The link ${ref} names no page of this site, so it goes nowhere. Link a page by its route: page:/ for the home page, page:hours for /hours, and #id after it for a section.`,
    )
    const stored = mapSectionRefs(section, (ref) => storedPageRef(ref, index))
    withAssetIdentity(stored.content)
    return { section: stored, written: [...notes, ...dead] }
  }

  async function pageAt(site, read, route, language) {
    const want = ctx.normalizeRoute(route)
    const pages = pagesInOrder(read.body.pages, { language, defaultLanguage: read.defaultLanguage })
    const page = pages.find((p) => p.route === want)
    if (!page) refuse(`The site has no page at ${want}. Its pages: ${pages.map((p) => p.route).join(', ')}.`)
    return { page, pages, want }
  }

  async function sectionOn(site, pageUuid, sectionId) {
    const body = await client.page(site.uuid, pageUuid)
    const row = (body?.sections ?? []).find((s) => s.item_uuid === sectionId || String(s.item_id) === String(sectionId))
    return { row, rows: body?.sections ?? [] }
  }

  const siteProp = { type: 'string', description: "The site's name or id" }
  const languageProp = { type: 'string', description: "One of the site's languages; the default one if left out" }

  return [
    {
      name: 'write_section',
      description: "Replace one section of a page with new Markdown: frontmatter naming its type, then its content. Give the section's id and the version read_page answered. Answers with its new version, and notes on what its type will and won't show.",
      inputSchema: {
        type: 'object',
        properties: {
          site: siteProp,
          route: { type: 'string', description: "The page's route" },
          section: { type: 'string', description: "The section's id, as read_page gave it" },
          version: { type: 'string', description: 'The version read_page gave the section' },
          markdown: { type: 'string', description: 'The whole section: frontmatter naming its type, then its content' },
          language: languageProp,
        },
        required: ['site', 'route', 'section', 'version', 'markdown'],
        additionalProperties: false,
      },
      run: async ({ site: ref, route, section: sectionId, version, markdown, language }) => {
        const site = await siteNamed(ref)
        const read = await siteRead(site)
        const lang = languageFor(language, read)
        const { page, want } = await pageAt(site, read, route, lang)
        const { row } = await sectionOn(site, page.uuid, sectionId)
        if (!row) refuse(`The page at ${want} has no section ${sectionId}. read_page lists its sections and their ids.`)
        const { section, written } = await prepare(site, read, markdown)
        const data = mergeSection(row.data, section, lang)
        let answer
        try {
          answer = await client.write(site.uuid, { kind: 'update', item_id: row.item_id, if_unmodified_since: version, data })
        } catch (err) {
          const words = staleWords(err, `The section ${sectionId}`)
          if (words) refuse(words)
          throw err
        }
        const next = resultOf(answer).item_updated_at ?? '(not given)'
        return withNotes(`Written: the ${section.type} section ${sectionId} of ${want}. Its version is now ${next}.${written.length ? `\n${written.join('\n')}` : ''}`, await notesFor(site, section))
      },
    },
    {
      name: 'add_section',
      description: 'Add a section to a page, written as Markdown with frontmatter naming its type: last on the page, after a section, or inside one. Answers with its id and version, and notes on what its type will show.',
      inputSchema: {
        type: 'object',
        properties: {
          site: siteProp,
          route: { type: 'string', description: "The page's route" },
          markdown: { type: 'string', description: 'The section: frontmatter naming its type, then its content' },
          after: { type: 'string', description: "The id of the section it follows; last on the page if left out" },
          inside: { type: 'string', description: "The id of a section it goes inside, as one of that section's own" },
          language: languageProp,
        },
        required: ['site', 'route', 'markdown'],
        additionalProperties: false,
      },
      run: async ({ site: ref, route, markdown, after, inside, language }) => {
        const site = await siteNamed(ref)
        const read = await siteRead(site)
        const lang = languageFor(language, read)
        const { page, want } = await pageAt(site, read, route, lang)
        const { section, written } = await prepare(site, read, markdown)
        let parent = page.uuid
        let position = 'last'
        if (inside || after) {
          const { rows } = await sectionOn(site, page.uuid, inside ?? after)
          const find = (id) => rows.find((s) => s.item_uuid === id || String(s.item_id) === String(id))
          if (inside) {
            const host = find(inside)
            if (!host) refuse(`The page at ${want} has no section ${inside} to go inside.`)
            parent = host.item_uuid
          }
          if (after) {
            const sibling = find(after)
            if (!sibling) refuse(`The page at ${want} has no section ${after} to follow.`)
            position = { after: sibling.item_id }
          }
        }
        const data = mergeSection(null, section, lang)
        const answer = await client.write(site.uuid, {
          kind: 'create',
          section_id: read.body.page_sections_section_id,
          parent_item_uuid: parent,
          position,
          data,
        })
        const r = resultOf(answer)
        return withNotes(`Added: a ${section.type} section to ${want}, id ${r.item_uuid ?? r.item_id}, version ${r.item_updated_at ?? '(not given)'}.${written.length ? `\n${written.join('\n')}` : ''}`, await notesFor(site, section))
      },
    },
    {
      name: 'remove_section',
      description:
        "Remove one section from a page, with the sections inside it, or one section of a layout area (the header or the footer). Give its id and the version read_page, or read_layout, answered.",
      inputSchema: {
        type: 'object',
        properties: {
          site: siteProp,
          route: { type: 'string', description: "The page's route, for a section of a page" },
          area: { type: 'string', description: 'The layout area (header or footer), for a section of the layout instead' },
          section: { type: 'string', description: "The section's id" },
          version: { type: 'string', description: 'The version read_page or read_layout gave it' },
        },
        required: ['site', 'section', 'version'],
        additionalProperties: false,
      },
      run: async ({ site: ref, route, area, section: sectionId, version }) => {
        const site = await siteNamed(ref)
        const read = await siteRead(site)
        if (!route === !area) refuse('Give route for a section of a page, or area for a section of the layout.')
        let row
        let want
        if (area) {
          row = ((await client.layouts(site.uuid))?.sections ?? []).find(
            (s) => s.data?.area === area && (s.item_uuid === sectionId || String(s.item_id) === String(sectionId)),
          )
          want = `the ${area}`
          if (!row) refuse(`The ${area} has no section ${sectionId}: read_layout lists its sections.`)
        } else {
          const at = await pageAt(site, read, route, read.defaultLanguage)
          want = at.want
          ;({ row } = await sectionOn(site, at.page.uuid, sectionId))
          if (!row) refuse(`The page at ${want} has no section ${sectionId}.`)
        }
        try {
          await client.write(site.uuid, { kind: 'delete', item_id: row.item_id, if_unmodified_since: version })
        } catch (err) {
          const words = staleWords(err, `The section ${sectionId}`)
          if (words) refuse(words)
          throw err
        }
        return `Removed: the ${row.data?.type ?? ''} section ${sectionId} from ${want}.`
      },
    },
    {
      name: 'add_page',
      description: "Add a page at a new route, with its title and its sections, all at once. The route's last segment is lowercase words joined by dashes; its parent route must exist.",
      inputSchema: {
        type: 'object',
        properties: {
          site: siteProp,
          route: { type: 'string', description: 'The new page\'s route, such as /events or /about/team' },
          title: { type: 'string', description: "The page's title, as menus show it" },
          sections: { type: 'array', items: { type: 'string' }, description: 'Its sections, in order, each as Markdown with frontmatter naming its type' },
          language: languageProp,
        },
        required: ['site', 'route', 'title', 'sections'],
        additionalProperties: false,
      },
      run: async ({ site: ref, route, title, sections = [], language }) => {
        const site = await siteNamed(ref)
        const read = await siteRead(site)
        const lang = languageFor(language, read)
        const want = ctx.normalizeRoute(route)
        const pages = pagesInOrder(read.body.pages, { language: lang, defaultLanguage: read.defaultLanguage })
        if (pages.some((p) => p.route === want)) refuse(`The site already has a page at ${want}. read_page shows it.`)
        // The home page is the site's index page: its route is /, and its slug is `home`.
        const isHome = want === '/'
        const segments = want.split('/').filter(Boolean)
        const segment = isHome ? 'home' : segments.pop()
        if (!segment || !SEGMENT.test(segment)) refuse('A route\'s last segment is lowercase words joined by dashes, such as /opening-hours.')
        const parentRoute = segments.length ? `/${segments.join('/')}` : null
        const parent = parentRoute ? pages.find((p) => p.route === parentRoute) : null
        if (parentRoute && !parent) refuse(`The site has no page at ${parentRoute} to put ${want} under. Add that page first.`)
        const types = await typesOf(site)
        // The new page gets an id, as an editor gives one, so a link can name it and outlive a rename.
        const pageId = mintPageId()
        const parsed = []
        for (const [i, md] of sections.entries()) {
          try {
            parsed.push(await prepare(site, read, md, { types, extra: [{ id: pageId, route: want, dynamic: false }] }))
          } catch (err) {
            refuse(`Section ${i + 1}: ${err.message}`)
          }
        }
        const pageUuid = uuidv7()
        const sample = read.body.pages?.[0]?.data
        const batch = [
          {
            kind: 'create',
            section_id: read.body.pages_section_id,
            uuid: pageUuid,
            ...(parent ? { parent_item_uuid: parent.uuid } : {}),
            position: 'last',
            data: {
              mode: 'regular',
              slug: withLanguageText(sample?.slug, segment, lang),
              title: withLanguageText(sample?.title, title, lang),
              stable_id: pageId,
              ...(isHome ? { is_index: true } : {}),
            },
          },
          ...parsed.map(({ section }) => ({
            kind: 'create',
            section_id: read.body.page_sections_section_id,
            parent_item_uuid: pageUuid,
            position: 'last',
            data: mergeSection(null, section, lang),
          })),
        ]
        const answer = await client.write(site.uuid, { batch })
        const ids = parsed.map((_, i) => resultOf(answer, i + 1)).map((r, i) => `${i + 1}. ${parsed[i].section.type}: id ${r.item_uuid ?? r.item_id}, version ${r.item_updated_at ?? '(not given)'}`)
        const notes = (await Promise.all(parsed.map(async ({ section, written }) => [...written, ...(await notesFor(site, section))]))).flatMap((n, i) => n.map((x) => `Section ${i + 1}: ${x}`))
        return withNotes([`Added: the page ${want}, "${title}", with ${parsed.length} section${parsed.length === 1 ? '' : 's'}:`, ...ids].join('\n'), notes)
      },
    },
    {
      name: 'set_layout',
      description:
        "Write a section of the site's header or footer, shown on every page, as Markdown with frontmatter naming its type. An area can hold several sections, such as a notice above the header: read_layout lists each with its id and version. To change one, give its version, and its id when the area has several. To add one, give add: first (before the area's others) or last.",
      inputSchema: {
        type: 'object',
        properties: {
          site: siteProp,
          area: { type: 'string', description: 'The layout area: header or footer' },
          markdown: { type: 'string', description: 'The section: frontmatter naming its type, then its content' },
          section: { type: 'string', description: 'The id read_layout gave the section to change, when the area has several' },
          add: { type: 'string', enum: ['first', 'last'], description: "Add a section to the area: first, before its others, or last, after them" },
          version: { type: 'string', description: 'The version read_layout gave the section to change' },
          language: languageProp,
        },
        required: ['site', 'area', 'markdown'],
        additionalProperties: false,
      },
      run: async ({ site: ref, area, markdown, section: sectionId, add, version, language }) => {
        const site = await siteNamed(ref)
        const read = await siteRead(site)
        const lang = languageFor(language, read)
        if (sectionId && add) refuse('Give section to change one of the area, or add to add one, not both.')
        const { section, written } = await prepare(site, read, markdown)
        const layouts = await client.layouts(site.uuid)
        const rows = (layouts?.sections ?? []).filter((s) => s.data?.area === area && (s.data?.layout_name ?? 'default') === 'default')
        let row = null
        if (sectionId) {
          row = rows.find((s) => s.item_uuid === sectionId || String(s.item_id) === String(sectionId))
          if (!row) refuse(`The ${area} has no section ${sectionId}: read_layout lists its sections.`)
        } else if (!add) {
          if (rows.length > 1) {
            const listed = rows.map((s) => `${s.data?.type ?? 'a section'}, id ${s.item_uuid ?? s.item_id}`).join('; ')
            refuse(`The ${area} has ${rows.length} sections (${listed}): give the id of the one to change, or add: first or last to add another.`)
          }
          row = rows[0] ?? null
        }
        let answer
        if (row) {
          if (!version) refuse(`The site has a ${area} already: give the version read_layout answered for it.`)
          try {
            answer = await client.write(site.uuid, { kind: 'update', item_id: row.item_id, if_unmodified_since: version, data: { ...mergeSection(row.data, section, lang), area, layout_name: row.data?.layout_name ?? 'default' } })
          } catch (err) {
            const words = staleWords(err, `The ${area}`)
            if (words) refuse(words)
            throw err
          }
        } else {
          // A new section goes first or last in its area; the backend takes no position before
          // another section (measured 2026-11-22: `{ before }` is refused, `first` and `last` taken).
          answer = await client.write(site.uuid, {
            kind: 'create',
            section_id: read.body.layout_sections_section_id,
            position: add === 'first' ? 'first' : 'last',
            data: { ...mergeSection(null, section, lang), area, layout_name: 'default' },
          })
        }
        const r = resultOf(answer)
        const what = row
          ? `Written: ${rows.length > 1 ? `a section of the ${area}` : `the ${area}`}, a ${section.type}.`
          : rows.length
            ? `Added: a ${section.type} to the ${area}, ${add === 'first' ? 'before' : 'after'} its other sections, id ${r.item_uuid ?? r.item_id}.`
            : `Written: the ${area}, a ${section.type}, id ${r.item_uuid ?? r.item_id}.`
        return withNotes(`${what} Its version is now ${r.item_updated_at ?? '(not given)'}.${written.length ? `\n${written.join('\n')}` : ''}`, await notesFor(site, section))
      },
    },
    {
      name: 'read_theme',
      description: "The site's theme as YAML: its colours, contexts, fonts and appearance, with the version set_theme names.",
      inputSchema: { type: 'object', properties: { site: siteProp }, required: ['site'], additionalProperties: false },
      run: async ({ site: ref }) => {
        const site = await siteNamed(ref)
        const { body } = await siteRead(site)
        const theme = body.settings_data?.theme ?? {}
        return `The theme of ${site.name} (version ${body.settings_item_updated_at ?? 'none yet'}):\n\n${yaml.dump(theme, { lineWidth: -1, noRefs: true }).trimEnd() || '{}'}`
      },
    },
    {
      name: 'set_theme',
      description: "Change the site's theme: give only what changes, as YAML in the shape read_theme answers, such as colors: { primary: '#8a4b2a' }. The rest stays; a key given as null is removed. Give the version read_theme answered.",
      inputSchema: {
        type: 'object',
        properties: {
          site: siteProp,
          theme: { type: 'string', description: 'What changes in the theme, as YAML' },
          version: { type: 'string', description: 'The version read_theme gave' },
        },
        required: ['site', 'theme'],
        additionalProperties: false,
      },
      run: async ({ site: ref, theme, version }) => {
        const site = await siteNamed(ref)
        const { body } = await siteRead(site)
        let parsed
        try {
          parsed = yaml.load(String(theme ?? ''), { schema: yaml.CORE_SCHEMA })
        } catch (err) {
          refuse(`The theme is not valid YAML: ${String(err.message).split('\n')[0]}`)
        }
        if (!isPlainObject(parsed)) refuse('The theme is a map, such as colors: { primary: "#3b82f6" }.')
        const data = { ...(body.settings_data ?? {}), theme: mergeOver(body.settings_data?.theme, parsed) }
        if (body.settings_item_id == null) {
          await client.write(site.uuid, { kind: 'create', section_id: body.settings_section_id, position: 'last', data })
          return 'Written: the theme.'
        }
        if (!version) refuse('Give the version read_theme answered, so nothing is written over a change made meanwhile.')
        try {
          const r = resultOf(await client.write(site.uuid, { kind: 'update', item_id: body.settings_item_id, if_unmodified_since: version, data }))
          return `Written: the theme. Its version is now ${r.item_updated_at ?? '(not given)'}.`
        } catch (err) {
          const words = staleWords(err, 'The theme')
          if (words) refuse(words)
          throw err
        }
      },
    },
    {
      name: 'set_site_info',
      description: "Change the site's name or its description, as people and search engines read them.",
      inputSchema: {
        type: 'object',
        properties: { site: siteProp, name: { type: 'string' }, description: { type: 'string' } },
        required: ['site'],
        additionalProperties: false,
      },
      run: async ({ site: ref, name, description }) => {
        const site = await siteNamed(ref)
        const { body } = await siteRead(site)
        if (name === undefined && description === undefined) refuse('Give a name, a description, or both.')
        // Read and written in one call, changing only the fields given: what the person changed
        // meanwhile in the others stays.
        const data = { ...(body.info_data ?? {}) }
        if (name !== undefined) data.name = name
        if (description !== undefined) data.description = description
        try {
          await client.write(site.uuid, { kind: 'update', item_id: body.info_item_id, if_unmodified_since: body.info_item_updated_at, data })
        } catch (err) {
          const words = staleWords(err, "The site's name and description")
          if (words) refuse(words)
          throw err
        }
        ctx.forgetSites()
        return `Written: ${[name !== undefined && `the name, "${name}"`, description !== undefined && 'the description'].filter(Boolean).join(' and ')}.`
      },
    },
    {
      name: 'list_looks',
      description: 'The looks a new site can start from: the foundations behind the templates the person may use, each with its templates and their previews.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const body = await client.templates()
        const cards = Array.isArray(body?.templates) ? body.templates : Array.isArray(body) ? body : []
        if (!cards.length) return 'No templates are offered to the person, so there is no look to start from.'
        const byFoundation = new Map()
        for (const c of cards) {
          const key = c.foundation ?? '(no foundation)'
          if (!byFoundation.has(key)) byFoundation.set(key, [])
          byFoundation.get(key).push(c)
        }
        const lines = ['Looks a site can start from, by foundation:']
        for (const [foundation, list] of byFoundation) {
          lines.push(`- ${foundation}`)
          for (const c of list) {
            // A preview served by the backend is named by its path: say it whole, so it can be shown.
            const preview = c.preview_url ? (/^[a-z]+:\/\//i.test(c.preview_url) ? c.preview_url : `${client.origin ?? ''}${c.preview_url}`) : null
            lines.push(`  - "${pick(c.title ?? c.name, null) ?? '(untitled)'}" — template ${c.uuid}${preview ? ` — preview ${preview}` : ''}`)
          }
        }
        lines.push('', 'look_vocabulary shows what a look offers; create_site starts a site wearing one.')
        return lines.join('\n')
      },
    },
    {
      name: 'look_vocabulary',
      description: "What a look offers: its foundation's section types, and its template's pages as examples. Give a template's id or title from list_looks.",
      inputSchema: { type: 'object', properties: { look: { type: 'string', description: "A template's id or title" } }, required: ['look'], additionalProperties: false },
      run: async ({ look }) => {
        const template = await ctx.templateNamed(look)
        const site = { uuid: template.uuid, name: pick(template.title ?? template.name, null) ?? template.uuid }
        const { text } = await ctx.vocabularyOf(site)
        const { body, defaultLanguage } = await siteRead(site)
        const pages = pagesInOrder(body.pages, { language: defaultLanguage, defaultLanguage })
        const outline = await Promise.all(
          pages.map(async (p) => {
            const rows = (await client.page(site.uuid, p.uuid).catch(() => null))?.sections ?? []
            return `- ${p.route}: ${rows.filter((r) => !r.parent_item_uuid).map((r) => r.data?.type).filter(Boolean).join(', ') || '(no sections)'}`
          }),
        )
        return `${text}\n\nIts template "${site.name}" uses them like this (read_page with the template's id ${site.uuid} shows a page whole):\n${outline.join('\n')}`
      },
    },
    {
      name: 'create_site',
      description: "Start a new site wearing a look: its foundation, theme and extensions, with none of its template's pages, in the person's languages. Then write its pages, header and footer.",
      inputSchema: {
        type: 'object',
        properties: {
          look: { type: 'string', description: "A template's id or title, from list_looks" },
          name: { type: 'string', description: "The new site's name" },
          languages: { type: 'array', items: { type: 'string' }, description: "The site's languages, such as [\"en\", \"fr\"]" },
          default_language: { type: 'string', description: 'Its main language' },
        },
        required: ['look', 'name'],
        additionalProperties: false,
      },
      run: async ({ look, name, languages, default_language: defaultLanguage }) => {
        const template = await ctx.templateNamed(look)
        const body = { template_uuid: template.uuid, name }
        if (Array.isArray(languages) && languages.length) body.languages = languages
        if (defaultLanguage) body.default_language = defaultLanguage
        const made = await client.siteFromLook(body)
        ctx.forgetSites()
        return `Made: "${made?.name ?? name}", id ${made?.site_uuid}, wearing ${template.foundation ?? 'its look'}. It has no pages yet: add_page writes the home page at /, set_layout its header and footer, and foundation_vocabulary lists the section types.`
      },
    },
  ]
}
