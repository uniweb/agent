import { describe, it, expect } from 'vitest'
import { agentTools } from '../src/tools.js'

/** A client answering the promotion routes as the playground did. */
function fakeClient() {
  const calls = []
  const client = {
    calls,
    session: async () => ({ workspace: null }),
    sites: async () => [{ uuid: 'site-1', name: 'Maple' }],
    site: async () => ({ settings_data: { default_language: 'en', languages: ['en', 'fr'] }, pages: [{ page_uuid: 'p-hours', route: '/hours', data: { slug: { en: 'hours' } } }] }),
    call: async (path, init) => {
      calls.push({ path, init })
      if (path === '/agent/models/@uniweb/site-promotion') {
        return {
          sections: [
            { id: 42, name: 'networks', parent_section_id: null },
            { id: 45, name: 'posts', parent_section_id: null },
            { id: 46, name: 'parts', parent_section_id: 45 },
            { id: 51, name: 'ads', parent_section_id: 50 },
            { id: 52, name: 'parts', parent_section_id: 51 },
          ],
        }
      }
      if (path.endsWith('/promotion') && !init) {
        return {
          promotion: {
            items: [
              { id: 1, uuid: 'n-1', section_id: 42, data: { network: 'x', use: 'posts', connection: { brief: { state: 'connected' } } } },
              { id: 2, uuid: 'post-1', section_id: 45, updated_at: 'v1', data: { language: 'en', send_at: '2026-11-23T09:00:00-05:00', page: 'p-hours' } },
              { id: 3, uuid: 'part-1', section_id: 46, parent_item_id: 2, data: { text: 'Open Sunday too.' } },
            ],
          },
        }
      }
      if (path.endsWith('/promotion/items')) {
        return { results: init.body.batch.map((op, i) => ({ item_id: 900 + i, item_uuid: op.uuid ?? `new-${i}`, item_updated_at: 'v-new' })) }
      }
      throw new Error(`no route ${path}`)
    },
  }
  return client
}

const toolsOf = (client) => Object.fromEntries(agentTools({ client }).map((t) => [t.name, t]))

describe('the Promote tools', () => {
  it("drafts a post and its text in one batch, finding the Sections by name in the Model", async () => {
    const client = fakeClient()
    const { text } = await toolsOf(client).draft_post.run({ site: 'Maple', text: 'Fresh bread at dawn.', language: 'fr' })
    const write = client.calls.find((c) => c.path === '/agent/sites/site-1/promotion/items')
    const [post, part] = write.init.body.batch
    expect(post).toMatchObject({ kind: 'create', section_id: 45, data: { language: 'fr' } })
    expect(part).toEqual({ kind: 'create', section_id: 46, parent_item_uuid: post.uuid, data: { text: 'Fresh bread at dawn.' } })
    expect(text).toMatch(/Drafted: post .+, in fr, version v-new\. It is a draft/)
  })

  it('reads the networks and the posts, each with its text and the page it is about', async () => {
    const { text } = await toolsOf(fakeClient()).read_promotion.run({ site: 'Maple' })
    expect(text).toMatch(/Networks: x \(posts, connected\)\./)
    expect(text).toMatch(/- post post-1 · version v1 · en · goes out 2026-11-23 09:00, about \/hours\n {2}"Open Sunday too\."/)
  })

  it('is offered in a project, where the files hold no promotion', () => {
    const names = agentTools({ client: fakeClient(), project: true }).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['read_promotion', 'draft_post']))
    expect(names).not.toContain('write_section')
  })
})
