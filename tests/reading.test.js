import { describe, it, expect } from 'vitest'
import { readSection } from '../src/section.js'
import { howItReads } from '../src/reading.js'

// As a starter foundation's `meta.js` declares them.
const Footer = {
  area: 'footer',
  description: 'Site footer with navigation, social links, and copyright',
  content: {
    title: 'Site name (optional)',
    paragraphs: { label: 'Copyright line and tagline [0-2]' },
    links: 'Footer links (social + legal)',
  },
}
const Testimonials = {
  description: 'Quotes from customers',
  content: {
    title: 'Heading',
    items: { label: 'Quotes [2-6]', content: { title: 'Who said it', paragraphs: 'The quote' } },
  },
}

describe('howItReads', () => {
  it("says a footer's links in a bulleted list won't show, and how to write them", () => {
    const { section } = readSection('---\ntype: Footer\n---\n© Maple & Rye\n\n- [Instagram](https://instagram.com/maple)\n- [Privacy](/privacy)\n')
    const notes = howItReads(section, Footer)
    expect(notes.join('\n')).toMatch(/links are in a bulleted list, which it doesn't read: put each link alone on a line/)
  })

  it('says nothing when the footer is written as it reads', () => {
    const { section } = readSection('---\ntype: Footer\n---\n© Maple & Rye\n\n[Instagram](https://instagram.com/maple)\n\n[Privacy](/privacy)\n')
    expect(howItReads(section, Footer)).toEqual([])
  })

  it('says when a type needs more entries than were written', () => {
    const { section } = readSection('---\ntype: Testimonials\n---\n# What people say\n\n---\n\n### Ana\n\nBest croissant in town.\n')
    expect(howItReads(section, Testimonials).join('\n')).toMatch(/needs at least 2 of “Quotes”; it has 1/)
  })

  it('reads a registered schema entry as it reads a meta.js', () => {
    const registered = {
      content: [
        { element: 'title', kind: 'heading', label: 'Heading' },
        { element: 'items', kind: 'entries', label: 'Quotes', min: 2, max: 6, content: [] },
      ],
    }
    const { section } = readSection('---\ntype: Testimonials\n---\n# What people say\n\n---\n\n### Ana\n\nBest croissant in town.\n')
    expect(howItReads(section, registered).join('\n')).toMatch(/needs at least 2 of “Quotes”; it has 1/)
  })

  it('gives no notes for a type that says nothing about its content', () => {
    const { section } = readSection('---\ntype: Hero\n---\n# Hi\n')
    expect(howItReads(section, { description: 'A hero' })).toEqual([])
    expect(howItReads(section, null)).toEqual([])
  })
})
