/**
 * Links to a site's pages, and the pictures a site holds, as an agent reads and writes them.
 *
 * A store links a page by its id (`page:3f58142d`), which an editor mints, so a link survives the
 * page being renamed. A model reads a path better than a code, so an agent is shown each such link
 * by its page's route (`page:hours`, the home page `page:/`), and a route it writes is stored as the
 * page's id when the page has one: the rule a site's sync follows between the store and a project's
 * files (`@uniweb/build`'s `page-refs.js`), held to it by `tests/same-as-the-build.test.js`. An id
 * an author chose is a word (`home`), reads as well as a route, and is kept as written.
 *
 * A reference resolves as the runtime resolves it: by a page's id, else by its route. One that
 * resolves to nothing is a link to nowhere, and the agent is told.
 *
 * A picture uploaded to a site is stored with its asset's identity beside its address
 * (`assetId`, `assetExt`), which Markdown has no place for. A picture whose address is an uploaded
 * asset's gets them back when it is written.
 */

const PAGE_REF = /^page:([^#]*)(#.*)?$/
const routeKey = (route) => String(route).replace(/^\/+/, '').replace(/\/+$/, '')

/** An id an editor mints: eight or more hex characters with a digit among them. */
export function isCodeId(id) {
  return typeof id === 'string' && /^(?=[0-9a-f]*[0-9])[0-9a-f]{8,}$/.test(id)
}

/** A new page's id, in the shape an editor mints. */
export function mintPageId() {
  for (;;) {
    const bytes = new Uint8Array(4)
    globalThis.crypto.getRandomValues(bytes)
    const id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
    if (isCodeId(id)) return id
  }
}

/**
 * What a `page:` reference resolves to among a site's pages: a page's id, which wins over any
 * route, else its route.
 *
 * @param {Array<{ id: string|null, route: string, dynamic?: boolean }>} pages
 */
export function pageRefIndex(pages) {
  const byName = new Map()
  for (const page of pages) {
    if (page.id) byName.set(page.id, page)
    const key = routeKey(page.route)
    if (!byName.has(key)) byName.set(key, page)
  }
  return {
    resolve: (target) => (typeof target === 'string' ? (byName.get(target) ?? byName.get(routeKey(target))) : undefined),
  }
}

/** A written reference, as stored: `page:<code>` when the page it names has a code for its id. */
export function storedPageRef(ref, index) {
  const m = typeof ref === 'string' ? PAGE_REF.exec(ref) : null
  const page = m && index.resolve(m[1])
  return isCodeId(page?.id) ? `page:${page.id}${m[2] || ''}` : ref
}

/** A stored reference, as an agent reads it: by its page's route, where its id is a code. */
export function writtenPageRef(ref, index) {
  const m = typeof ref === 'string' ? PAGE_REF.exec(ref) : null
  const page = m && index.resolve(m[1])
  if (!page || page.dynamic || m[1] !== page.id || !isCodeId(page.id)) return ref
  const path = routeKey(page.route) || '/'
  return index.resolve(path) === page ? `page:${path}${m[2] || ''}` : ref
}

/** Each `href` in a document, on a node or a mark, through `map`. Mutates the document. */
function mapDoc(node, map) {
  if (!node || typeof node !== 'object') return
  if (typeof node.attrs?.href === 'string') node.attrs.href = map(node.attrs.href)
  for (const mark of node.marks || []) if (typeof mark?.attrs?.href === 'string') mark.attrs.href = map(mark.attrs.href)
  if (Array.isArray(node.content)) for (const child of node.content) mapDoc(child, map)
}

/** A params value, each string that is one `page:` reference through `map`. */
function mapValue(value, map) {
  if (typeof value === 'string') return PAGE_REF.test(value) ? map(value) : value
  if (Array.isArray(value)) return value.map((v) => mapValue(v, map))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapValue(v, map)]))
  return value
}

/**
 * A section, its references through `map`: in its content (one document) and its params.
 * Returns a new section; the one given is not changed.
 */
export function mapSectionRefs(section, map) {
  const out = structuredClone(section)
  if (out.content?.type === 'doc') mapDoc(out.content, map)
  if (out.params) out.params = mapValue(out.params, map)
  return out
}

/** The references in a section that name no page of the site. */
export function unresolvedRefs(section, index) {
  const missing = new Set()
  mapSectionRefs(section, (ref) => {
    const m = PAGE_REF.exec(ref)
    if (m && !index.resolve(m[1])) missing.add(ref)
    return ref
  })
  return [...missing]
}

/** The site's pages as references resolve them, from a site read's `pages` rows and their routes. */
export function pageRefPages(pagesInOrder) {
  return pagesInOrder.map((p) => ({
    id: typeof p.row?.data?.stable_id === 'string' && p.row.data.stable_id ? p.row.data.stable_id : null,
    route: p.route,
    dynamic: p.row?.data?.is_dynamic === true,
  }))
}

// An uploaded asset's address: `/static/asset/dist/<sha-256>/<file>.<ext>`, root-relative or whole.
const ASSET = /\/static\/asset\/dist\/([0-9a-f]{64})\/[^/?#]+\.([a-z0-9]+)(?:[?#].*)?$/i

/**
 * A document's pictures as an agent reads them: an uploaded asset's identity left out, since its
 * address carries it and a write gives it back. Mutates.
 */
export function withoutAssetIdentity(node) {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'image' && typeof node.attrs?.src === 'string' && ASSET.test(node.attrs.src)) {
    delete node.attrs.assetId
    delete node.attrs.assetExt
  }
  if (Array.isArray(node.content)) for (const child of node.content) withoutAssetIdentity(child)
  return node
}

/** A document's pictures, each whose address is an uploaded asset's given its identity back. Mutates. */
export function withAssetIdentity(node) {
  if (!node || typeof node !== 'object') return node
  if (node.type === 'image' && typeof node.attrs?.src === 'string') {
    const m = ASSET.exec(node.attrs.src)
    if (m) {
      node.attrs.src = node.attrs.src.slice(node.attrs.src.indexOf('/static/asset/dist/'))
      node.attrs.assetId ??= m[1]
      node.attrs.assetExt ??= m[2].toLowerCase()
    }
  }
  if (Array.isArray(node.content)) for (const child of node.content) withAssetIdentity(child)
  return node
}
