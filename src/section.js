/**
 * A section as an agent writes it, and as a site stores it.
 *
 * An agent writes a section as Markdown that starts with frontmatter: its type, then the settings
 * it gives the section, then its content. A site stores the same section as its type, whether it
 * is a draft, its params (the settings, `fetch` among them) and its content as a ProseMirror
 * document. `readSection` and `writeSection` go from one to the other.
 *
 * They read a section the way a site's build reads a section file: the same frontmatter split, the
 * same keys kept out of the params (`@uniweb/schemas/section`), the same Markdown reader. So what an
 * agent writes is what a project's files show once the site is pulled. `tests/same-as-the-build.test.js`
 * holds the two together, file by file, on the starter templates.
 *
 * One language at a time: `content` is the document in the language being written, and a caller
 * that stores languages side by side keeps the others.
 */

import yaml from 'js-yaml'
import { markdownToProseMirror } from '@uniweb/content-reader'
import { serializeSection } from '@uniweb/content-writer'
import { isSectionKey } from '@uniweb/schemas/section'

/** A section that can't be read as written, said in words an agent can act on. */
export class SectionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SectionError'
  }
}

// YAML as a site's build reads it: the core schema with merge keys, and a date kept as the text it
// was written as, so `date: 2026-11-21` stays that string.
const timestampAsWritten = new yaml.Type('tag:yaml.org,2002:timestamp', {
  kind: 'scalar',
  resolve: (data) => yaml.types.timestamp.resolve(data),
  construct: (data) => data,
})
const YAML_SCHEMA = yaml.CORE_SCHEMA.extend({
  implicit: [yaml.types.merge],
  explicit: [timestampAsWritten, yaml.types.binary, yaml.types.omap, yaml.types.pairs, yaml.types.set],
})

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const OPENING = 'A section starts with frontmatter naming its type, then its content:\n---\ntype: Hero\n---\n# Its heading\nIts text.'

/**
 * Split a section's frontmatter from its body, as a site's build does.
 *
 * @param {string} text
 * @returns {{ frontmatter: object, body: string }} no frontmatter gives `{}` and the whole text
 * @throws {SectionError} when a frontmatter block is opened and does not parse
 */
export function splitFrontmatter(text) {
  const src = String(text ?? '').replace(/\r\n/g, '\n')
  if (!src.trimStart().startsWith('---')) return { frontmatter: {}, body: src }
  const parts = src.split('---\n')
  if (parts.length < 3) return { frontmatter: {}, body: src }
  let frontmatter
  try {
    frontmatter = yaml.load(parts[1], { schema: YAML_SCHEMA }) ?? {}
  } catch (err) {
    const reason = String(err?.message ?? err).split('\n')[0]
    throw new SectionError(
      `Its frontmatter is not valid YAML (${reason}). A value holding a colon and a space needs quotes: ` +
        `title: "Bread: baked daily".`,
    )
  }
  if (!isPlainObject(frontmatter)) {
    throw new SectionError(`Its frontmatter must be settings, one \`name: value\` per line. ${OPENING}`)
  }
  return { frontmatter, body: parts.slice(2).join('---\n') }
}

/**
 * A section an agent wrote, as a site stores it.
 *
 * @param {string} markdown - frontmatter naming the section's `type`, then its content in Markdown
 * @param {object} [options]
 * @param {string[]} [options.types] - the foundation's section types; another type is refused
 * @returns {{
 *   section: { type: string, hidden?: true, stable_id?: string, params?: object, content: object },
 *   notes: string[],
 * }} `notes` says what was written and does nothing, as a site's build warns about it
 * @throws {SectionError}
 */
export function readSection(markdown, { types = null } = {}) {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n')
  if (!text.trimStart().startsWith('---') || text.split('---\n').length < 3) throw new SectionError(OPENING)
  const { frontmatter, body } = splitFrontmatter(text)
  const { type, hidden, preset, input, props, fetch, query, data, id } = frontmatter

  if (type === undefined || type === null || type === '') {
    throw new SectionError(`Its frontmatter names no \`type:\`. ${OPENING}`)
  }
  if (typeof type !== 'string') throw new SectionError(`Its \`type:\` must be a section type's name, such as Hero.`)
  if (Array.isArray(types) && !types.includes(type)) {
    throw new SectionError(`The foundation has no section type ${type}. It has: ${types.join(', ')}.`)
  }
  if (data !== undefined) {
    throw new SectionError('`data:` is not a section setting. A section that shows records names them with `fetch:`.')
  }
  // ⚠️ A section's records are named with `fetch:`, in the shape a site stores it, which a section
  // read from the site shows and writing it back keeps. The `query:` shorthand would need the
  // build's normalization of it, which this package doesn't hold yet, so it is refused rather than
  // stored in a shape no build would write.
  if (query !== undefined) {
    throw new SectionError(
      'Name the records a section shows with `fetch:`, as the section showed it when read. `query:` is not taken here.',
    )
  }
  if (hidden !== undefined && typeof hidden !== 'boolean') {
    throw new SectionError('`hidden:` is true for a draft section, or false.')
  }
  if (props !== undefined && !isPlainObject(props)) {
    throw new SectionError('`props:` holds settings as one map: `props: { columns: 3 }`.')
  }

  const notes = []
  for (const [key, value] of [['preset', preset], ['input', input]]) {
    if (value === undefined) continue
    notes.push(
      key === 'preset'
        ? '`preset:` does nothing: write the settings a preset stands for in the frontmatter instead.'
        : '`input:` does nothing, and was left out.',
    )
  }

  const params = Object.fromEntries(
    Object.entries(frontmatter).filter(([key]) => !isSectionKey(key) && key !== 'fetch'),
  )
  Object.assign(params, props ?? {})
  if (fetch !== undefined) params.fetch = fetch

  const content = markdownToProseMirror(body, { onWarning: (message) => notes.push(String(message)) })

  const section = { type }
  const stableId = id === undefined || id === null || id === '' ? null : String(id)
  if (stableId) section.stable_id = stableId
  if (hidden === true) section.hidden = true
  if (Object.keys(params).length > 0) section.params = params
  section.content = content
  return { section, notes }
}

/**
 * A stored section, as an agent reads and writes it: frontmatter, then its content in Markdown.
 * Reading it back with `readSection` gives the same section.
 *
 * @param {{ type: string, hidden?: boolean, stable_id?: string, params?: object, content?: object }} section
 * @returns {string}
 */
export function writeSection(section) {
  const { type, hidden, stable_id: stableId, params, content } = section ?? {}
  if (!type) throw new SectionError('A section needs its type.')
  const front = { type }
  if (stableId) front.id = String(stableId)
  if (hidden === true) front.hidden = true
  const { fetch, ...settings } = isPlainObject(params) ? params : {}
  // A param named like one of the frontmatter's own keys (`type`, `hidden`…) is written under
  // `props:`, which a build merges back into the params.
  const props = {}
  for (const [key, value] of Object.entries(settings)) {
    if (isSectionKey(key)) props[key] = value
    else front[key] = value
  }
  if (Object.keys(props).length > 0) front.props = props
  if (fetch !== undefined) front.fetch = fetch
  return serializeSection(front, content ?? { type: 'doc', content: [] })
}
