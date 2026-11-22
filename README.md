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

## A site's pages

```js
import { pagesInOrder } from '@uniweb/agent'

pagesInOrder(site.pages, { language: 'fr', defaultLanguage: 'en' })
// [ { route: '/', title: 'Accueil', … }, { route: '/a-propos', title: 'À propos', … }, … ]
```

Each page has its route in the language asked for, by the rule a site's sync uses, in the order
the site keeps its pages.

## The backend

```js
import { agentClient, cliDoor } from '@uniweb/agent'

const client = agentClient({
  origin: 'https://uniweb.app',
  openSession: cliDoor({ origin: 'https://uniweb.app', token: cliToken, workspace: '@acme' }),
})
const sites = await client.sites()
```

An agent works on a person's sites with a session of its own, in one workspace, as that person. A
door makes the session: `cliDoor` makes it from the CLI's sign-in. The client opens a new session
when the old one ends. When the sign-in itself has ended, its error says the person signs in again
(`signInAgain`).

## The tools

```js
import { agentTools } from '@uniweb/agent'

const tools = agentTools({ client })
const { text, isError } = await tools.find((t) => t.name === 'read_page').run({ site: 'Maple & Rye', route: '/hours' })
```

Each tool has a name, a description a model reads to choose it, its inputs as JSON Schema, and
`run`, which answers in short text. A refusal is text too, and says what to do instead. The tools
so far read: the sites, one site at a glance, the foundation's vocabulary, a page's sections and
the layout areas. In a project, whose files are the site's copy, pass `{ project: true }` and the
tools whose work the files already do are left out.

## Over the Model Context Protocol

```js
import { mcpServer, agentTools, AGENT_INSTRUCTIONS } from '@uniweb/agent'

const server = mcpServer({ name: 'uniweb', version: '1.0.0', tools: agentTools({ client }), instructions: AGENT_INSTRUCTIONS })
const answer = await server.handle(message) // one JSON-RPC message in, its answer out (null for a notification)
```

`mcpServer` has no transport of its own: a process carries the messages over its standard streams,
a service over HTTP. The CLI's `uniweb mcp` is the first: a host such as Claude Desktop or Claude
Code starts it, and it works as the person signed in to the CLI.

## Status

Early. The reads are in place, served by `uniweb mcp`. Writing comes next.

## License

Apache-2.0
