/**
 * The tools for a site's Promote: what is connected, the posts, and a post's draft.
 *
 * A site's promotion is one entity of items: the networks it is connected to, its posts, each with
 * its parts (the text), and its campaigns. Its Sections are found by name in its Model, never held
 * as numbers, since they are a deployment's. A project's files hold none of it, so these tools are
 * offered in a project too.
 */

import { uuidv7 } from './ids.js'

const MODEL = '@uniweb/site-promotion'

/** @param {object} ctx - the client, and how a site and its language are found */
export function promotionTools(ctx) {
  const { client, siteNamed, siteRead, languageFor, refuse } = ctx
  let model = null

  /** The Model's Sections by name: `posts`, and the `parts` whose parent is `posts`. */
  async function sections() {
    model ??= client.call(`/agent/models/${MODEL}`).catch((err) => {
      model = null
      throw err
    })
    const m = await model
    const all = Array.isArray(m?.sections) ? m.sections : []
    const top = (name) => all.find((s) => s.name === name && !s.parent_section_id)
    const posts = top('posts')
    const parts = posts && all.find((s) => s.name === 'parts' && s.parent_section_id === posts.id)
    const networks = top('networks')
    if (!posts || !parts) refuse("This backend's Promote has no posts to write.")
    return { posts, parts, networks }
  }

  async function promotionOf(site) {
    const body = await client.call(`/agent/sites/${encodeURIComponent(site.uuid)}/promotion`)
    const items = Array.isArray(body?.promotion?.items) ? body.promotion.items : []
    return items
  }

  const siteProp = { type: 'string', description: "The site's name or id" }

  return [
    {
      name: 'read_promotion',
      description: "A site's Promote: the networks it is connected to, and its posts, each with its text, its language and when it goes out.",
      inputSchema: { type: 'object', properties: { site: siteProp }, required: ['site'], additionalProperties: false },
      run: async ({ site: ref }) => {
        const site = await siteNamed(ref)
        const [{ posts, parts, networks }, items, read] = await Promise.all([sections(), promotionOf(site), siteRead(site)])
        const lines = [`Promote for ${site.name}:`]
        const connected = items.filter((i) => i.section_id === networks?.id)
        lines.push(
          connected.length
            ? `Networks: ${connected.map((n) => `${n.data?.network ?? '?'} (${n.data?.use ?? 'posts'}, ${n.data?.connection?.brief?.state ?? 'not connected'})`).join(', ')}.`
            : 'No network is connected yet: the person connects one in Promote, in the app.',
        )
        const postRows = items.filter((i) => i.section_id === posts.id)
        if (!postRows.length) {
          lines.push('No posts yet. draft_post writes one.')
          return lines.join('\n')
        }
        lines.push('', 'Posts:')
        const pageRoute = new Map((read.body.pages ?? []).map((p) => [p.page_uuid, p.route]))
        for (const p of postRows) {
          const text = items
            .filter((i) => i.section_id === parts.id && i.parent_item_id === p.id)
            .map((i) => i.data?.text)
            .filter(Boolean)
            .join('\n')
          const when = p.data?.send_at ? `goes out ${String(p.data.send_at).slice(0, 16).replace('T', ' ')}` : 'not scheduled'
          const about = p.data?.page ? `, about ${pageRoute.get(p.data.page) ?? 'a page'}` : ''
          lines.push(`- post ${p.uuid} · version ${p.updated_at} · ${p.data?.language ?? '?'} · ${when}${about}`)
          lines.push(`  "${text || '(no text)'}"`)
        }
        return lines.join('\n')
      },
    },
    {
      name: 'draft_post',
      description: "Write a draft of a social post for the site's Promote, in one of the site's languages. The person sends it, or schedules it, from Promote.",
      inputSchema: {
        type: 'object',
        properties: {
          site: siteProp,
          text: { type: 'string', description: "The post's text" },
          language: { type: 'string', description: "One of the site's languages; the default one if left out" },
        },
        required: ['site', 'text'],
        additionalProperties: false,
      },
      run: async ({ site: ref, text, language }) => {
        const site = await siteNamed(ref)
        const read = await siteRead(site)
        const lang = languageFor(language, read) ?? 'en'
        if (!String(text ?? '').trim()) refuse('Give the post its text.')
        const { posts, parts } = await sections()
        const post = uuidv7()
        const answer = await client.call(`/agent/sites/${encodeURIComponent(site.uuid)}/promotion/items`, {
          method: 'POST',
          body: {
            batch: [
              { kind: 'create', section_id: posts.id, uuid: post, data: { language: lang } },
              { kind: 'create', section_id: parts.id, parent_item_uuid: post, data: { text } },
            ],
          },
        })
        const r = Array.isArray(answer?.results) ? answer.results[0] : null
        return `Drafted: post ${r?.item_uuid ?? post}, in ${lang}, version ${r?.item_updated_at ?? '(not given)'}. It is a draft: the person sends or schedules it from Promote, in the app. read_promotion shows the site's posts.`
      },
    },
  ]
}
