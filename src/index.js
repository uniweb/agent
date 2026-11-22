/**
 * @uniweb/agent — what an AI agent needs to work on a Uniweb site.
 *
 * - `readSection` / `writeSection`: a section as an agent writes it, Markdown with frontmatter, and
 *   as a site stores it, read the way a site's build reads a section file.
 * - `howItReads`: what a section's type will and won't show of what was written.
 * - `vocabularyText`: a foundation's section types, in words a model can reason over.
 * - `pagesInOrder`: a site's pages by route, in their order, in one language.
 * - `agentClient` / `cliDoor`: the backend, with a session of the agent's own.
 * - `agentTools`: the tools an agent calls, answering in short text.
 * - `mcpServer`: those tools over the Model Context Protocol, one message at a time.
 */

export { readSection, writeSection, splitFrontmatter, SectionError } from './section.js'
export { howItReads } from './reading.js'
export { vocabularyText, SECTION_PRIMER } from './vocabulary.js'
export { pick, pickDocument, languagesOf, routeOf, pagesInOrder, changedSince } from './site.js'
export { agentClient, cliDoor, AgentError } from './backend.js'
export { agentTools, ToolRefusal, AGENT_INSTRUCTIONS } from './tools.js'
export { mcpServer, PROTOCOL_VERSIONS } from './mcp.js'
