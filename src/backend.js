/**
 * The backend, as `@uniweb/agent` reaches it.
 *
 * An agent's requests carry a session of their own. It acts as one person, in one workspace fixed
 * when the session is made, and it ends within a day. A door makes it: `cliDoor` is the door of a
 * process that runs with the CLI's login, such as `uniweb mcp`. `agentClient` holds the session,
 * opens a new one when the old one has ended, and answers each read with the backend's own body.
 *
 * Every refusal comes back as an `AgentError` with the backend's status and reason. What to tell
 * the person is for the tools to say.
 */

/** A refusal from the backend, or a session that could not be opened. */
export class AgentError extends Error {
  constructor(message, { status = null, reason = null, problem = null, signInAgain = false } = {}) {
    super(message)
    this.name = 'AgentError'
    this.status = status
    this.reason = reason
    this.problem = problem
    this.signInAgain = signInAgain
  }
}

async function refusal(res, what) {
  const problem = await res.json().catch(() => null)
  const detail = problem?.detail ?? problem?.title ?? res.statusText ?? ''
  return new AgentError(`${what}: ${res.status}${detail ? ` ${detail}` : ''}`, {
    status: res.status,
    reason: problem?.reason ?? null,
    problem,
  })
}

const enc = encodeURIComponent
const trimBase = (origin) => String(origin ?? '').replace(/\/+$/, '')

/**
 * The door of a process that runs with the CLI's login: it trades that login for an agent
 * session, in the workspace the CLI works in.
 *
 * @param {object} options
 * @param {string} options.origin - the backend the CLI is signed in to
 * @param {string} options.token - the CLI's session
 * @param {string|null} [options.workspace] - the CLI's workspace, `@org`; none is the personal one
 * @param {Function} [options.fetch]
 * @returns {() => Promise<{ token: string, expires_at: string, workspace: object|null }>}
 */
export function cliDoor({ origin, token, workspace = null, fetch: doFetch = globalThis.fetch }) {
  const base = trimBase(origin)
  return async function openSession() {
    const headers = { authorization: `Bearer ${token}`, accept: 'application/json' }
    if (workspace) headers['x-uniweb-workspace'] = workspace
    const res = await doFetch(`${base}/dev/auth/agent`, { method: 'POST', headers })
    if (res.status === 401) {
      const problem = await res.json().catch(() => null)
      throw new AgentError('The sign-in to Uniweb on this computer has ended.', {
        status: 401,
        reason: problem?.reason ?? null,
        problem,
        signInAgain: true,
      })
    }
    if (res.status === 404 || res.status === 405) {
      throw new AgentError(`The Uniweb backend at ${base} does not offer agent sessions yet.`, { status: res.status })
    }
    if (!res.ok) throw await refusal(res, 'Could not open an agent session')
    const body = await res.json().catch(() => null)
    if (!body?.token) throw new AgentError('The backend answered with no agent session.', { status: res.status })
    return body
  }
}

/**
 * A client of the agent routes, holding the session a door makes.
 *
 * @param {object} options
 * @param {string} options.origin - the backend
 * @param {() => Promise<{ token: string, expires_at?: string, workspace?: object|null }>} options.openSession
 * @param {Function} [options.fetch]
 * @param {() => number} [options.now] - for tests
 */
export function agentClient({ origin, openSession, fetch: doFetch = globalThis.fetch, now = () => Date.now() }) {
  if (!origin) throw new TypeError('agentClient needs the backend origin')
  if (typeof openSession !== 'function') throw new TypeError('agentClient needs openSession, the door that makes an agent session')
  const base = trimBase(origin)
  let session = null
  let opening = null

  // A session about to end is replaced before it is used, and one door call serves every request
  // that arrives while it is open.
  async function current({ fresh = false } = {}) {
    const ending = session?.expires_at ? Date.parse(session.expires_at) - now() < 60_000 : false
    if (fresh || !session || ending) {
      opening ??= Promise.resolve()
        .then(openSession)
        .finally(() => {
          opening = null
        })
      session = await opening
    }
    return session
  }

  async function call(path, { method = 'GET', query = null, body } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { token } = await current({ fresh: attempt > 0 })
      const url = new URL(base + path)
      for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      const headers = { authorization: `Bearer ${token}`, accept: 'application/json' }
      if (body !== undefined) headers['content-type'] = 'application/json'
      const res = await doFetch(url.href, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
      if (res.status === 401) {
        const problem = await res.clone().json().catch(() => null)
        // An ended session, or any bearer that isn't a live one: open a new session, once. When
        // the new one is refused too, only signing in again helps.
        if (problem?.reason === 'agent_session_ended') {
          session = null
          if (attempt === 0) continue
          throw new AgentError('The agent session ended and a new one was refused.', {
            status: 401,
            reason: problem.reason,
            problem,
            signInAgain: true,
          })
        }
      }
      if (!res.ok) throw await refusal(res, `${method} ${path}`)
      if (res.status === 204) return null
      return res.json()
    }
    throw new AgentError('The agent session ended and a new one was refused.', { status: 401, signInAgain: true })
  }

  async function allSites() {
    const limit = 200
    const out = []
    for (let offset = 0; ; offset += limit) {
      const body = await call('/agent/sites', { query: { limit, offset } })
      const rows = Array.isArray(body?.sites) ? body.sites : []
      out.push(...rows)
      if (rows.length < limit) return out
    }
  }

  return {
    /** The backend, as `https://host[:port]`. */
    origin: base,
    /** The session, opened if none is. */
    session: () => current(),
    /** Who the session acts for, its workspace and when it ends. */
    whoami: () => call('/agent/session'),
    /** End the session early, as a process that is shutting down. */
    async end() {
      if (!session) return
      try {
        await call('/agent/session', { method: 'DELETE' })
      } catch {
        // Ending what has already ended is no failure.
      }
      session = null
    },
    /** The workspace's sites, every page of the list. */
    sites: allSites,
    /** A site: its props, its pages (each with its stored data and its route), and the section ids a new item names. */
    site: (site) => call(`/agent/sites/${enc(site)}`),
    /** A site's state: whether it is published, when, and whether it has changed since. */
    status: (site) => call(`/agent/sites/${enc(site)}/status`),
    /** What a publish of the site is waiting on, a payment among them. */
    pendingRequest: (site) => call(`/agent/sites/${enc(site)}/pending-request`),
    /** A page's sections, each with its stored data and the version a write names. */
    page: (site, page) => call(`/agent/sites/${enc(site)}/pages/${enc(page)}`),
    /** The site's layout areas, its header and footer among them. */
    layouts: (site) => call(`/agent/sites/${enc(site)}/layouts`),
    /**
     * Change a site's content: one operation, or `{ batch: [...] }`, all or nothing. Each
     * update, delete and move names the version it read (`if_unmodified_since`).
     */
    write: (site, body) => call(`/agent/sites/${enc(site)}/content/items`, { method: 'POST', body }),
    /** The templates the person may clone: the looks a site can start from. */
    templates: () => call('/agent/templates'),
    /** A new site wearing a template's look and nothing else: `{ template_uuid, name?, languages?, default_language? }`. */
    siteFromLook: (body) => call('/agent/sites/from-look', { method: 'POST', body }),
    /** Any agent route, for what this client doesn't name yet. */
    call,
  }
}
