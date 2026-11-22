/**
 * A site as an agent reasons about it: its pages by route, in their order, in one language.
 *
 * A site stores its pages as a tree, each with its slug and its place among its siblings. A
 * route is the slugs from the root, by the rule a site's sync uses (`@uniweb/build`'s
 * `buildRouteOf`): an index page takes its parent's route, a dynamic page's segment is its
 * parameter, and any other page's is its slug. `tests/same-as-the-build.test.js` holds the two
 * together.
 *
 * A field stored once per language is read in one: the language asked for, else the first one
 * stored, as the sync reads it.
 */

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The slug a page made from a `[...path]` directory stores: its route is `:path*`. */
const CATCH_ALL = '...path'

/**
 * One language's value of a field: the language asked for, else the first stored. A field that
 * isn't stored per language is returned as it is.
 */
export function pick(value, language) {
  if (!isPlainObject(value)) return value
  if (language && Object.hasOwn(value, language)) return value[language]
  const keys = Object.keys(value)
  return keys.length ? value[keys[0]] : undefined
}

/** A site's languages, from its settings: `{ languages, defaultLanguage }`. */
export function languagesOf(settings) {
  const languages = Array.isArray(settings?.languages) ? settings.languages.filter((l) => typeof l === 'string') : []
  const defaultLanguage =
    (typeof settings?.default_language === 'string' && settings.default_language) || languages[0] || null
  return { languages, defaultLanguage }
}

/**
 * The route of a page under its parent's route.
 *
 * @param {{ slug?: *, is_index?: boolean, is_dynamic?: boolean, param_name?: string }} page
 * @param {string} parentRoute - `/` at the top
 * @param {string|null} language
 */
export function routeOf(page, parentRoute, language) {
  if (page?.is_index) return parentRoute
  const slug = pick(page?.slug, language)
  const segment = page?.is_dynamic ? (slug === CATCH_ALL ? ':path*' : `:${page.param_name || slug}`) : slug
  return parentRoute === '/' ? `/${segment}` : `${parentRoute}/${segment}`
}

/** A page row's own fields: its stored `data`, over the few the row repeats beside it. */
function fieldsOf(row) {
  return { ...row, ...(isPlainObject(row?.data) ? row.data : {}) }
}

/**
 * A site's pages in their order, each with its route, from a site's `pages` rows.
 *
 * A row carries the page's place (`page_uuid`, `parent_page_uuid`, `order`, `updated_at`), its
 * stored `data` (`slug`, `title`, `is_index`, `is_dynamic`, `param_name`, `hidden`…), and `route`,
 * its route in the site's default language as the published site has it. That route is taken as
 * it is; another language's is made from `data` by the sync's rule.
 *
 * @param {Array<object>} rows
 * @param {{ language?: string|null, defaultLanguage?: string|null }} [options]
 * @returns {Array<{ uuid: string, route: string, title: *, hidden: boolean, depth: number, updatedAt: string|null, row: object }>}
 */
export function pagesInOrder(rows, { language = null, defaultLanguage = null } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const inDefault = !language || !defaultLanguage || language === defaultLanguage
  const children = new Map()
  for (const row of list) {
    const parent = row?.parent_page_uuid ?? null
    if (!children.has(parent)) children.set(parent, [])
    children.get(parent).push(row)
  }
  for (const group of children.values()) group.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  const entry = (row, parentRoute, depth) => {
    const f = fieldsOf(row)
    const route = inDefault && typeof row.route === 'string' ? row.route : routeOf(f, parentRoute, language)
    return {
      uuid: row.page_uuid,
      route,
      title: pick(f.title, language) ?? null,
      hidden: f.hidden === true,
      depth,
      updatedAt: row.updated_at ?? null,
      row,
    }
  }

  const known = new Set(list.map((r) => r.page_uuid))
  const out = []
  const visit = (parent, parentRoute, depth) => {
    for (const row of children.get(parent) ?? []) {
      const page = entry(row, parentRoute, depth)
      out.push(page)
      visit(row.page_uuid, page.route, depth + 1)
    }
  }
  visit(null, '/', 0)
  // A row whose parent isn't in the list still shows, at the top, rather than going missing.
  for (const [parent, group] of children) {
    if (parent !== null && !known.has(parent)) for (const row of group) out.push(entry(row, '/', 0))
  }
  return out
}

/**
 * What changed after a moment: the entries whose `updatedAt` is later.
 *
 * @param {Array<{ updatedAt: string|null }>} entries
 * @param {string|null} since - an ISO time; none means everything is new
 */
export function changedSince(entries, since) {
  const t = since ? Date.parse(since) : NaN
  return (entries ?? []).filter((e) => Number.isNaN(t) || (e?.updatedAt && Date.parse(e.updatedAt) > t))
}
