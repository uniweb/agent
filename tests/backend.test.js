import { describe, it, expect } from 'vitest'
import { agentClient, cliDoor, AgentError } from '../src/backend.js'

const ORIGIN = 'http://backend.test'
const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fetch that answers from `routes` (`'METHOD /path'` → a function of the request) and keeps every call. */
function fakeFetch(routes) {
  const calls = []
  const fetch = async (url, init = {}) => {
    const u = new URL(url)
    const key = `${init.method ?? 'GET'} ${u.pathname}`
    const call = { key, url: u, headers: init.headers ?? {}, body: init.body }
    calls.push(call)
    const answer = routes[key]
    if (!answer) return json(404, { reason: 'not_found', detail: `no route ${key}` })
    return answer(call, calls)
  }
  return { fetch, calls }
}

describe('cliDoor', () => {
  it("trades the CLI's login for an agent session, in the CLI's workspace", async () => {
    const { fetch, calls } = fakeFetch({
      'POST /dev/auth/agent': () => json(201, { token: 'agent-1', expires_at: '2026-11-23T03:00:00Z', workspace: { handle: '@acme' } }),
    })
    const session = await cliDoor({ origin: `${ORIGIN}/`, token: 'cli-token', workspace: '@acme', fetch })()
    expect(session.token).toBe('agent-1')
    expect(calls[0].headers.authorization).toBe('Bearer cli-token')
    expect(calls[0].headers['x-uniweb-workspace']).toBe('@acme')
  })

  it('sends no workspace for the personal one', async () => {
    const { fetch, calls } = fakeFetch({ 'POST /dev/auth/agent': () => json(201, { token: 't', workspace: null }) })
    await cliDoor({ origin: ORIGIN, token: 'cli', fetch })()
    expect(calls[0].headers).not.toHaveProperty('x-uniweb-workspace')
  })

  it('says so when the backend offers no agent sessions yet', async () => {
    const { fetch } = fakeFetch({})
    const err = await cliDoor({ origin: ORIGIN, token: 'cli', fetch })().catch((e) => e)
    expect(err).toBeInstanceOf(AgentError)
    expect(err.message).toMatch(/does not offer agent sessions yet/)
  })

  it("says the person signs in again when the CLI's login has ended", async () => {
    const { fetch } = fakeFetch({ 'POST /dev/auth/agent': () => json(401, { reason: 'session_expired' }) })
    const err = await cliDoor({ origin: ORIGIN, token: 'old', fetch })().catch((e) => e)
    expect(err).toBeInstanceOf(AgentError)
    expect(err.signInAgain).toBe(true)
  })
})

describe('agentClient', () => {
  it('opens a session on the first call and sends its token, never a workspace header', async () => {
    let doors = 0
    const { fetch, calls } = fakeFetch({ 'GET /agent/sites/s1/status': () => json(200, { published: true }) })
    const client = agentClient({ origin: ORIGIN, fetch, openSession: async () => ({ token: `agent-${++doors}` }) })
    expect(await client.status('s1')).toEqual({ published: true })
    expect(doors).toBe(1)
    expect(calls[0].headers.authorization).toBe('Bearer agent-1')
    expect(calls[0].headers).not.toHaveProperty('x-uniweb-workspace')
  })

  it('opens a new session once when the backend says the session ended', async () => {
    let doors = 0
    const { fetch, calls } = fakeFetch({
      'GET /agent/sites/s1': (call) =>
        call.headers.authorization === 'Bearer agent-1' ? json(401, { reason: 'agent_session_ended' }) : json(200, { pages: [] }),
    })
    const client = agentClient({ origin: ORIGIN, fetch, openSession: async () => ({ token: `agent-${++doors}` }) })
    expect(await client.site('s1')).toEqual({ pages: [] })
    expect(doors).toBe(2)
    expect(calls.map((c) => c.headers.authorization)).toEqual(['Bearer agent-1', 'Bearer agent-2'])
  })

  it('stops after one new session, saying the person signs in again', async () => {
    const { fetch } = fakeFetch({ 'GET /agent/session': () => json(401, { reason: 'agent_session_ended' }) })
    const client = agentClient({ origin: ORIGIN, fetch, openSession: async () => ({ token: 't' }) })
    const err = await client.whoami().catch((e) => e)
    expect(err).toBeInstanceOf(AgentError)
    expect(err.signInAgain).toBe(true)
  })

  it('replaces a session about to end before using it', async () => {
    let doors = 0
    const now = Date.parse('2026-11-22T00:00:00Z')
    const { fetch } = fakeFetch({ 'GET /agent/session': () => json(200, {}) })
    const client = agentClient({
      origin: ORIGIN,
      fetch,
      now: () => now,
      openSession: async () => ({ token: `t${++doors}`, expires_at: doors === 1 ? '2026-11-22T00:00:30Z' : '2026-11-23T00:00:00Z' }),
    })
    await client.whoami()
    await client.whoami()
    expect(doors).toBe(2)
  })

  it('makes one door call for requests that arrive together', async () => {
    let doors = 0
    const { fetch } = fakeFetch({ 'GET /agent/session': () => json(200, {}) })
    const client = agentClient({ origin: ORIGIN, fetch, openSession: async () => ({ token: `t${++doors}` }) })
    await Promise.all([client.whoami(), client.whoami(), client.whoami()])
    expect(doors).toBe(1)
  })

  it("turns a refusal into an AgentError with the backend's status and reason", async () => {
    const { fetch } = fakeFetch({ 'GET /agent/sites/x/pages/p': () => json(404, { reason: 'not_found', kind: 'site', detail: 'no such site' }) })
    const client = agentClient({ origin: ORIGIN, fetch, openSession: async () => ({ token: 't' }) })
    const err = await client.page('x', 'p').catch((e) => e)
    expect(err).toMatchObject({ name: 'AgentError', status: 404, reason: 'not_found' })
    expect(err.problem.kind).toBe('site')
  })

  it('reads every page of the site list', async () => {
    const rows = Array.from({ length: 450 }, (_, i) => ({ uuid: `s${i}` }))
    const { fetch, calls } = fakeFetch({
      'GET /agent/sites': (call) => {
        const limit = Number(call.url.searchParams.get('limit'))
        const offset = Number(call.url.searchParams.get('offset'))
        return json(200, { sites: rows.slice(offset, offset + limit) })
      },
    })
    const client = agentClient({ origin: ORIGIN, fetch, openSession: async () => ({ token: 't' }) })
    expect((await client.sites()).length).toBe(450)
    expect(calls.length).toBe(3)
  })

  it('ends its session, and ending one already ended is no failure', async () => {
    const { fetch, calls } = fakeFetch({ 'DELETE /agent/session': () => json(401, { reason: 'agent_session_ended' }) })
    const client = agentClient({ origin: ORIGIN, fetch, openSession: async () => ({ token: 't' }) })
    await client.session()
    await expect(client.end()).resolves.toBeUndefined()
    expect(calls.some((c) => c.key === 'DELETE /agent/session')).toBe(true)
  })
})
