/**
 * A foundation's vocabulary, as an agent reads it.
 *
 * A foundation is the vocabulary a kind of site is made with: its section types, what each is for,
 * what content it reads and the settings it takes. Its registered schema holds all of that, in a
 * shape made for an editor. `vocabularyText` says it in short text a model can reason over, about
 * 3 KB for a starter foundation where the schema is many times that, and closes with how a section
 * is written.
 */

import { describeContent } from '@uniweb/schemas/content'

const KIND_WORDS = {
  heading: 'heading',
  prose: 'paragraphs',
  entries: 'entries',
  link: 'links',
  list: 'lists',
  media: 'media',
  image: 'images',
  video: 'videos',
  icon: 'icons',
  inset: 'insets',
  document: 'documents',
  code: 'code',
}

function contentLines(elements, indent = '    ') {
  const lines = []
  for (const e of Array.isArray(elements) ? elements : []) {
    const what = KIND_WORDS[e.kind] ?? e.kind
    const count = e.min != null || e.max != null ? ` ${e.min ?? 0}–${e.max ?? 'any'}` : ''
    lines.push(`${indent}- ${e.element ?? e.key ?? what}: ${what}${count}${e.label ? ` — ${e.label}` : ''}`)
    if (Array.isArray(e.content)) lines.push(...contentLines(e.content, `${indent}  `))
  }
  return lines
}

function settingLines(params) {
  const lines = []
  for (const [name, d] of Object.entries(params ?? {})) {
    const options = Array.isArray(d?.options)
      ? d.options.map((o) => (o && typeof o === 'object' ? o.value : o)).join(' | ')
      : d?.type ?? ''
    lines.push(`    - ${name}: ${options}${d?.default != null ? ` (default ${JSON.stringify(d.default)})` : ''}`)
  }
  return lines
}

/** How a section is written, for an agent that hasn't seen one. */
export const SECTION_PRIMER = `How a section is written: Markdown that starts with frontmatter.
---
type: Testimonials        # the section type
theme: light              # light | medium | dark: the section's colour context
columns: 3                # any setting the type lists
---
# Heading                 → the section's title (## right after it: its subtitle)
A paragraph.              → paragraphs
[Label](/route)           → a link alone on its line: a button
![Alt text](https://…)    → an image

---                       → after the intro, --- starts the repeating entries
### Entry title           → each ### heading starts one entry, with its own paragraphs and links
Entry text.`

/**
 * A foundation's vocabulary in words.
 *
 * @param {object} options
 * @param {string} options.ref - the foundation, as a site names it (`@acme/marketing@1.2.0`)
 * @param {object} options.schema - its section types: name → schema entry (or `meta.js`)
 * @param {object} [options.info] - its own description, if any
 * @returns {string}
 */
export function vocabularyText({ ref, schema, info = null }) {
  if (!schema || typeof schema !== 'object') return `No vocabulary is recorded for ${ref}.`
  const lines = [`Foundation ${ref}${info?.description ? ` — ${info.description}` : ''}`, '']
  for (const [name, t] of Object.entries(schema)) {
    if (name.startsWith('_') || !t || typeof t !== 'object') continue
    const role = t.area
      ? ` (the site's ${t.area}: written once, shown on every page)`
      : t.inset
        ? ' (an inset: placed inside a section as ![alt](@Name), not a section of its own)'
        : ''
    lines.push(`## ${name}${role}`)
    lines.push(`  ${t.description ?? '(no description)'}${t.family ? ` [family: ${t.family}]` : ''}`)
    const { declared, elements } = describeContent(t)
    if (declared) {
      lines.push('  content it reads:')
      lines.push(...contentLines(elements))
    }
    const settings = settingLines(t.params)
    if (settings.length) {
      lines.push('  settings (frontmatter):')
      lines.push(...settings)
    }
    if (t.presets && typeof t.presets === 'object') lines.push(`  presets: ${Object.keys(t.presets).join(', ')}`)
    if (t.data && typeof t.data === 'object') {
      const keys = Object.entries(t.data).map(([k, v]) => `${k} (${typeof v === 'string' ? v : v?.schema ?? '?'})`)
      if (keys.length) lines.push(`  records it shows: ${keys.join(', ')}`)
    }
    lines.push('')
  }
  lines.push(SECTION_PRIMER)
  return lines.join('\n')
}
