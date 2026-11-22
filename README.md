# @uniweb/agent

What an AI agent needs to work on a Uniweb site.

An agent that builds or edits a site writes Markdown. A Uniweb site stores each section as a
document that its section type reads. This package goes between the two. It also tells the agent,
as it writes, what the section type will show of what was written and what it won't.

## Sections

```js
import { readSection, writeSection } from '@uniweb/agent'

const { section, notes } = readSection(`---
type: Hero
theme: dark
---
# Fresh bread, every morning

Baked before dawn.
`)
// section: { type: 'Hero', params: { theme: 'dark' }, content: { type: 'doc', content: [ … ] } }
// notes:   what was written and does nothing, such as a `preset:`

writeSection(section) // Markdown that reads back as the same section
```

A section is read the way a site's build reads a section file: the same frontmatter, the same
settings, the same Markdown reader. So what an agent writes is what a project's files show.

A section that can't be read is refused with a `SectionError` whose message says what to write
instead. Examples: no frontmatter, no `type:`, a type the foundation doesn't have (pass
`{ types }`), or YAML that doesn't parse.

## What a section type reads

```js
import { howItReads } from '@uniweb/agent'

howItReads(section, schema.Footer)
// [ "Footer's links are in a bulleted list, which it doesn't read: put each link alone on a line of its own." ]
```

The second argument is the section type's entry in its foundation's schema, or its `meta.js`. A
type that says nothing about its content gets no notes.

## A foundation's vocabulary

```js
import { vocabularyText } from '@uniweb/agent'

vocabularyText({ ref: '@acme/marketing@1.2.0', schema })
```

It lists each section type, what it is for, the content it reads and its settings, in short text
a model can reason over, and ends with how a section is written.

## Status

Early. Sections, how a section type reads them and the vocabulary are in place. The tools an agent
calls come next.

## License

Apache-2.0
