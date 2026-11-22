/**
 * How a section type reads what was written.
 *
 * A section is stored as written, and its section type shows what it reads of it. Markdown that
 * misses what a type reads is not an error anywhere: the page simply shows less, and nobody is
 * told. An agent needs to be told, at the moment it writes. Measured on agents writing sites: a
 * footer's links written as a bulleted list, which the footer doesn't read, and a testimonials
 * section given one quote where it shows two or more. Told, the agents fixed both.
 *
 * `howItReads` parses a section's content as its component receives it (`@uniweb/semantic-parser`)
 * and compares it with what its type says it reads (`describeContent`, `@uniweb/schemas/content`),
 * so the notes hold for a `meta.js` and for a registered foundation schema alike. A type that says
 * nothing about its content gets no notes: how it renders is not known.
 */

import { parseContent, lintContent } from '@uniweb/semantic-parser'
import { describeContent, placementsNotOffered } from '@uniweb/schemas/content'

/** How many of one content element a parsed section holds. */
function countOf(parsed, element) {
  if (element === 'media') return Math.max(parsed?.media?.length ?? 0, parsed?.images?.length ?? 0, parsed?.videos?.length ?? 0)
  const value = parsed?.[element]
  return Array.isArray(value) ? value.length : value ? 1 : 0
}

// Content a section can hold, by the name its component receives it under.
const HELD = ['paragraphs', 'links', 'images', 'videos', 'lists', 'items', 'quotes', 'tables']

/** Where parsed content falls short of, or goes past, what a type reads, in words. */
function compareContent(parsed, elements, what) {
  const notes = []
  const read = new Set(elements.map((e) => e.element).filter(Boolean))
  if (read.has('media')) ['images', 'videos'].forEach((k) => read.add(k))

  for (const e of elements) {
    if (!e.element) continue
    const n = countOf(parsed, e.element)
    const name = e.label ? `“${e.label}”` : e.element
    if (e.min != null && n < e.min) notes.push(`${what} needs at least ${e.min} of ${name}; it has ${n}.`)
    if (e.max != null && n > e.max) notes.push(`${what} shows at most ${e.max} of ${name}; it has ${n}, and the rest won't show.`)
    if (e.kind === 'entries' && Array.isArray(e.content) && Array.isArray(parsed?.[e.element])) {
      parsed[e.element].forEach((item, i) => {
        notes.push(...compareContent(item, e.content, `Its entry ${i + 1}${item?.title ? ` (${item.title})` : ''}`))
      })
    }
  }

  for (const key of HELD) {
    if (read.has(key) || !countOf(parsed, key)) continue
    const linksInList = key === 'lists' && (parsed.lists ?? []).flat(Infinity).some((li) => li?.links?.length)
    if (linksInList && read.has('links')) {
      notes.push(`${what}'s links are in a bulleted list, which it doesn't read: put each link alone on a line of its own.`)
    } else if (linksInList && read.has('items')) {
      notes.push(`${what}'s links are in a bulleted list, which it doesn't read: group them as entries, each a ### heading with its links under it.`)
    } else {
      notes.push(`${what} has ${key === 'lists' ? 'a bulleted list' : key}, which it doesn't show.`)
    }
  }
  return notes
}

/**
 * What a section's type will and won't show of what was written, as notes.
 *
 * @param {{ type: string, content: object }} section - as `readSection` gives it
 * @param {object|null} typeEntry - the section type's entry in its foundation's schema, or its `meta.js`
 * @returns {string[]} one sentence per note; none when the type says nothing about its content
 */
export function howItReads(section, typeEntry) {
  if (!section?.content || !typeEntry || typeof typeEntry !== 'object') return []
  const what = section.type ?? 'The section'
  const notes = []

  const described = describeContent(typeEntry)
  if (described.declared) notes.push(...compareContent(parseContent(section.content), described.elements, what))

  for (const finding of lintContent(section.content) ?? []) {
    if (finding?.severity === 'warning' && finding.message) notes.push(String(finding.message))
  }

  for (const p of placementsNotOffered(section.content, typeEntry)) {
    const offered = Array.isArray(p.offered) && p.offered.length ? `it offers ${p.offered.join(', ')}` : 'it offers no placement for one'
    notes.push(`${what} doesn't place a ${p.kind} "${p.placement}": ${offered}.`)
  }

  return [...new Set(notes)]
}
