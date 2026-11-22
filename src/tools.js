/**
 * The tools an agent calls to work on a person's sites.
 *
 * Each tool has a name, a description a model reads to choose it, the inputs it takes, and `run`,
 * which answers in short text: a model reasons over text, and every word costs it. The answers
 * follow what agents were measured to need:
 *
 * - each names the next step in the tools' own terms, never a command or a screen;
 * - whatever a tool can write, a tool can read;
 * - a refusal says what to do instead.
 *
 * `agentTools` takes a client of the backend (`agentClient`). In a project, whose files are the
 * site's copy, it leaves out the tools whose work the files already do.
 */

import { AgentError } from './backend.js'
import { SectionError, writeSection } from './section.js'
import { languagesOf, pagesInOrder, pick, pickDocument, changedSince } from './site.js'
import { vocabularyText } from './vocabulary.js'

/** A refusal said to the agent: the message is the whole answer. */
export class ToolRefusal extends Error {}

const day = (iso) => (iso ? String(iso).slice(0, 16).replace('T', ' ') : null)
const short = (uuid) => (uuid ? String(uuid).slice(-12) : '')
const normalizeRoute = (route) => {
  const r = String(route ?? '').trim()
  if (!r || r === '/') return '/'
  return `/${r.replace(/^\/+|\/+$/g, '')}`
}

/** `@scope/name@version`, as a site names its foundation. */
function parseFoundation(ref) {
  const m = /^@([^/]+)\/([^@]+)@(.+)$/.exec(String(ref ?? ''))
  return m ? { scope: m[1], name: m[2], version: m[3] } : null
}

/** What to tell the agent when the backend refused. */
function refusalWords(err, what) {
  if (err instanceof ToolRefusal || err instanceof SectionError) return err.message
  if (err instanceof AgentError) {
    if (err.signInAgain) {
      return `${err.message} The person signs in to Uniweb again on this computer, then asks again. Nothing was changed.`
    }
    if (err.status === 404) return `${what} was not found among what the person can reach. list_sites shows their sites.`
    if (err.status === 409) return `${what} is in another workspace than this session's. ${err.problem?.detail ?? ''}`.trim()
    if (err.status === 403) return `The person may not do that on this site. ${err.problem?.detail ?? ''}`.trim()
    return `The backend refused: ${err.message}`
  }
  return `It failed: ${err?.message ?? err}`
}

/**
 * The tools.
 *
 * @param {object} options
 * @param {ReturnType<import('./backend.js').agentClient>} options.client
 * @param {boolean} [options.project] - true where a project's files are the site's copy
 * @returns {Array<{ name: string, description: string, inputSchema: object, run: (args: object) => Promise<string> }>}
 */
export function agentTools({ client, project = false }) {
  let sitesCache = null

  async function sites({ fresh = false } = {}) {
    if (!sitesCache || fresh) sitesCache = await client.sites()
    return sitesCache
  }

  /** A site the agent named: by its id, the end of it, or its name. */
  async function siteNamed(ref) {
    const want = String(ref ?? '').trim()
    if (!want) throw new ToolRefusal('Name the site: its name, or its id from list_sites.')
    for (const fresh of [false, true]) {
      const all = await sites({ fresh })
      const lower = want.toLowerCase()
      const hits = all.filter((s) => s.uuid === want || s.uuid.endsWith(lower) || String(s.name ?? '').toLowerCase() === lower)
      if (hits.length === 1) return hits[0]
      if (hits.length > 1) {
        throw new ToolRefusal(`"${want}" names ${hits.length} sites: ${hits.map((s) => `${s.name} (${s.uuid})`).join(', ')}. Name it by its id.`)
      }
    }
    throw new ToolRefusal(`No site "${want}" among the sites the person can reach. list_sites shows them.`)
  }

  /** A site's props, pages and languages. */
  async function siteRead(site) {
    const body = await client.site(site.uuid)
    const { languages, defaultLanguage } = languagesOf(body.settings_data)
    return { body, languages, defaultLanguage }
  }

  function languageFor(asked, { languages, defaultLanguage }) {
    if (!asked) return defaultLanguage
    if (languages.length && !languages.includes(asked)) {
      throw new ToolRefusal(`The site is not in ${asked}. Its languages: ${languages.join(', ')}.`)
    }
    return asked
  }

  /** A list of sections, in their order, nested under their parents, as Markdown. */
  function sectionsText(sections, language, label = (i, s) => `Section ${i}`) {
    const byParent = new Map()
    for (const s of sections ?? []) {
      const p = s.parent_item_uuid ?? null
      if (!byParent.has(p)) byParent.set(p, [])
      byParent.get(p).push(s)
    }
    for (const g of byParent.values()) g.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    const out = []
    let n = 0
    const visit = (parent, depth) => {
      for (const s of byParent.get(parent) ?? []) {
        n += 1
        const d = s.data ?? {}
        const inside = depth > 0 ? ` (inside the section above)` : ''
        out.push(`## ${label(n, s)}: ${d.type ?? '(no type)'}${inside}`)
        out.push(`id: ${s.item_uuid} · version: ${s.updated_at}`)
        out.push('')
        try {
          out.push(writeSection({ ...d, content: pickDocument(d.content, language) }).trimEnd())
        } catch (err) {
          out.push(`(This section can't be shown as Markdown: ${err.message})`)
        }
        out.push('')
        visit(s.item_uuid, depth + 1)
      }
    }
    visit(null, 0)
    return out.join('\n').trimEnd()
  }

  const tools = [
    {
      name: 'list_sites',
      description: 'The sites the person can work on in this workspace: each one\'s name, id, whether it is live and where, and when it last changed. Start here.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      run: async () => {
        const all = await sites({ fresh: true })
        const session = await client.session()
        const where = session?.workspace?.handle ?? session?.workspace?.name ?? 'the personal workspace'
        if (!all.length) return `No sites in ${where} yet.`
        const lines = all.map((s) => {
          const live = s.deployment?.status === 'published'
          const address = s.deployment?.visitor_url ?? s.deployment?.published_url ?? null
          return `- ${s.name || '(unnamed)'} — id ${s.uuid} — ${live ? `live at ${address ?? '(no address)'}` : 'not published'}${s.updated_at ? ` — changed ${day(s.updated_at)}` : ''}`
        })
        return [`Sites in ${where}:`, ...lines, '', 'site_overview shows one site at a glance.'].join('\n')
      },
    },
    {
      name: 'site_overview',
      description: 'One site at a glance: its foundation and languages, whether it is live, what changed since it was last published, what a publish is waiting on, and its pages by route.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string', description: 'The site\'s name or id' } },
        required: ['site'],
        additionalProperties: false,
      },
      run: async ({ site: ref }) => {
        const site = await siteNamed(ref)
        const [{ body, languages, defaultLanguage }, status, pending] = await Promise.all([
          siteRead(site),
          client.status(site.uuid).catch(() => null),
          client.pendingRequest(site.uuid).catch(() => null),
        ])
        const info = body.info_data ?? {}
        const pages = pagesInOrder(body.pages, { language: defaultLanguage, defaultLanguage })
        const lines = [`${info.name ?? site.name} (id ${site.uuid})`]
        if (info.description) lines.push(pick(info.description, defaultLanguage))
        lines.push(`Foundation: ${info.foundation ?? '(none)'}. Languages: ${languages.length ? languages.join(', ') : defaultLanguage ?? '(not set)'}.`)
        if (status?.published) {
          lines.push(`Live at ${status.visitor_url ?? status.last_published_url ?? '(no address)'}, last published ${day(status.last_published_at)}.`)
          if (status.draft_dirty) lines.push('It has changes that are not live yet.')
        } else {
          lines.push('Not published yet.')
        }
        const waiting = Array.isArray(pending?.pending) ? pending.pending : []
        if (waiting.length) {
          lines.push('A publish is waiting on the person:')
          for (const p of waiting) lines.push(`- ${p.detail ?? p.kind ?? 'something to settle'} (they settle it in Uniweb's app, in a browser)`)
        }
        lines.push('', 'Pages:')
        for (const p of pages) lines.push(`${'  '.repeat(p.depth)}- ${p.route} — ${p.title ?? '(untitled)'}${p.hidden ? ' (hidden from menus)' : ''}`)
        if (status?.published && status.last_published_at) {
          const changed = changedSince(pages, status.last_published_at)
          if (changed.length) lines.push('', `Pages changed since the last publish: ${changed.map((p) => p.route).join(', ')}.`)
        }
        lines.push('', project ? 'The project\'s files hold its pages.' : 'read_page shows a page\'s sections; read_layout its header and footer; foundation_vocabulary the section types it is made with.')
        return lines.join('\n')
      },
    },
    {
      name: 'foundation_vocabulary',
      description: 'The section types a site is made with: what each is for, the content it reads and its settings, and how a section is written. Read it before writing sections.',
      inputSchema: {
        type: 'object',
        properties: { site: { type: 'string', description: 'The site\'s name or id' } },
        required: ['site'],
        additionalProperties: false,
      },
      run: async ({ site: ref }) => {
        const site = await siteNamed(ref)
        const { body } = await siteRead(site)
        const ref2 = body.info_data?.foundation
        const f = parseFoundation(ref2)
        if (!f) return `The site names no foundation (${ref2 ?? 'none'}), so it has no vocabulary to read.`
        const schema = await client.call(
          `/agent/sites/${encodeURIComponent(site.uuid)}/foundations/${encodeURIComponent(f.scope)}/${encodeURIComponent(f.name)}/${encodeURIComponent(f.version)}/schema`,
        )
        return vocabularyText({ ref: ref2, schema: schema?.schema, info: schema?.info })
      },
    },
  ]

  if (!project) {
    tools.push(
      {
        name: 'read_page',
        description: 'A page\'s sections, in order, each as Markdown with frontmatter naming its type, with the id and version a change to it names.',
        inputSchema: {
          type: 'object',
          properties: {
            site: { type: 'string', description: 'The site\'s name or id' },
            route: { type: 'string', description: 'The page\'s route, as site_overview lists it: / or /about' },
            language: { type: 'string', description: 'One of the site\'s languages; the default one if left out' },
          },
          required: ['site', 'route'],
          additionalProperties: false,
        },
        run: async ({ site: ref, route, language }) => {
          const site = await siteNamed(ref)
          const read = await siteRead(site)
          const lang = languageFor(language, read)
          const want = normalizeRoute(route)
          const pages = pagesInOrder(read.body.pages, { language: lang, defaultLanguage: read.defaultLanguage })
          const page = pages.find((p) => p.route === want)
          if (!page) throw new ToolRefusal(`The site has no page at ${want}. Its pages: ${pages.map((p) => p.route).join(', ')}.`)
          const body = await client.page(site.uuid, page.uuid)
          const sections = body?.sections ?? []
          const head = `${page.title ?? want} (${want})${lang ? `, in ${lang}` : ''}: ${sections.length} section${sections.length === 1 ? '' : 's'}.`
          if (!sections.length) return `${head}\nThe page has no sections.`
          return `${head}\n\n${sectionsText(sections, lang)}`
        },
      },
      {
        name: 'read_layout',
        description: 'The site\'s header and footer, and any other layout area: each written once and shown on every page, as Markdown, with its id and version.',
        inputSchema: {
          type: 'object',
          properties: {
            site: { type: 'string', description: 'The site\'s name or id' },
            language: { type: 'string', description: 'One of the site\'s languages; the default one if left out' },
          },
          required: ['site'],
          additionalProperties: false,
        },
        run: async ({ site: ref, language }) => {
          const site = await siteNamed(ref)
          const read = await siteRead(site)
          const lang = languageFor(language, read)
          const body = await client.layouts(site.uuid)
          const sections = body?.sections ?? []
          if (!sections.length) return 'The site has no layout areas yet: no header, no footer.'
          return sectionsText(sections, lang, (i, s) => {
            const d = s.data ?? {}
            return `The ${d.area ?? 'layout area'}${d.layout_name && d.layout_name !== 'default' ? ` of the layout ${d.layout_name}` : ''}`
          })
        },
      },
    )
  }

  // Every answer and every refusal is text; nothing a tool throws reaches the host as an error
  // the model can't read.
  return tools.map((t) => ({
    ...t,
    run: async (args) => {
      try {
        return { text: await t.run(args ?? {}) }
      } catch (err) {
        return { text: refusalWords(err, args?.site ? `The site "${args.site}"` : 'It'), isError: true }
      }
    },
  }))
}

/** What a host shows a model about these tools, before it reads any of them. */
export const AGENT_INSTRUCTIONS = `These tools work on a person's Uniweb websites, as that person. Start with list_sites, then site_overview. A site is composed from its foundation's vocabulary of section types: read foundation_vocabulary before writing sections. Pages are read section by section, each section as Markdown with frontmatter naming its type. Publishing makes changes live: do it only when the person asks.`
