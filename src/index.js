/**
 * @uniweb/agent — what an AI agent needs to work on a Uniweb site.
 *
 * - `readSection` / `writeSection`: a section as an agent writes it, Markdown with frontmatter, and
 *   as a site stores it, read the way a site's build reads a section file.
 * - `howItReads`: what a section's type will and won't show of what was written.
 * - `vocabularyText`: a foundation's section types, in words a model can reason over.
 */

export { readSection, writeSection, splitFrontmatter, SectionError } from './section.js'
export { howItReads } from './reading.js'
export { vocabularyText, SECTION_PRIMER } from './vocabulary.js'
